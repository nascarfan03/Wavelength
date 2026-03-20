#!/usr/bin/env python3
"""
Duplicate Image Finder
Scans a directory for duplicate images using perceptual hashing.
When a group contains both .webp and .png files, the .png duplicates
are automatically queued for deletion (keeping the .webp).
For all other groups you confirm interactively.
"""

import os
import sys
import hashlib
import argparse
from pathlib import Path
from collections import defaultdict

# ── Optional dependency check ──────────────────────────────────────────────────
try:
    from PIL import Image
except ImportError:
    print("Pillow is required.  Install it with:  pip install Pillow")
    sys.exit(1)

try:
    import imagehash
    PHASH_AVAILABLE = True
except ImportError:
    PHASH_AVAILABLE = False
    print("⚠  imagehash not found – falling back to exact-hash comparison only.")
    print("   For near-duplicate detection install it:  pip install imagehash\n")


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"}


# ── Hashing helpers ────────────────────────────────────────────────────────────

def md5_hash(path: Path) -> str:
    """Exact byte-for-byte hash."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def perceptual_hash(path: Path, hash_size: int = 8):
    """Perceptual hash – tolerates minor edits, compression, resizing."""
    try:
        img = Image.open(path)
        return imagehash.phash(img, hash_size=hash_size)
    except Exception:
        return None


# ── Scanning ──────────────────────────────────────────────────────────────────

def collect_images(directory: Path, recursive: bool) -> list[Path]:
    pattern = "**/*" if recursive else "*"
    return [
        p for p in directory.glob(pattern)
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]


def find_duplicates(images: list[Path], use_phash: bool, threshold: int) -> list[list[Path]]:
    """Return groups of duplicate images (each group has ≥ 2 members)."""
    groups: list[list[Path]] = []

    if not use_phash:
        # ── Exact duplicates via MD5 ───────────────────────────────────────
        buckets: dict[str, list[Path]] = defaultdict(list)
        total = len(images)
        for i, img in enumerate(images, 1):
            print(f"\r  Hashing {i}/{total} …", end="", flush=True)
            buckets[md5_hash(img)].append(img)
        print()
        groups = [v for v in buckets.values() if len(v) > 1]

    else:
        # ── Near-duplicates via perceptual hash ───────────────────────────
        hashes: list[tuple[Path, object]] = []
        total = len(images)
        for i, img in enumerate(images, 1):
            print(f"\r  Hashing {i}/{total} …", end="", flush=True)
            h = perceptual_hash(img)
            if h is not None:
                hashes.append((img, h))
        print()

        used = set()
        for i, (path_a, hash_a) in enumerate(hashes):
            if i in used:
                continue
            cluster = [path_a]
            for j, (path_b, hash_b) in enumerate(hashes[i + 1:], i + 1):
                if j in used:
                    continue
                if (hash_a - hash_b) <= threshold:
                    cluster.append(path_b)
                    used.add(j)
            if len(cluster) > 1:
                used.add(i)
                groups.append(cluster)

    return groups


# ── Interactive UI ────────────────────────────────────────────────────────────

def human_size(path: Path) -> str:
    b = path.stat().st_size
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


# Format preference: earlier = higher priority (kept over later entries)
FORMAT_PREFERENCE = [".webp", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif"]


def preferred_format_rank(path: Path) -> int:
    """Lower rank = higher priority (prefer to keep)."""
    try:
        return FORMAT_PREFERENCE.index(path.suffix.lower())
    except ValueError:
        return len(FORMAT_PREFERENCE)


def resolve_by_format(group: list[Path]) -> tuple[list[Path], list[Path]] | None:
    """
    If the group contains files of different formats and there is a clear
    format winner (e.g. a .webp alongside .png copies), return
    (to_keep, to_delete).  Returns None if all formats are the same.
    """
    formats = {p.suffix.lower() for p in group}
    if len(formats) == 1:
        return None  # same format – needs manual choice

    best_rank = min(preferred_format_rank(p) for p in group)
    to_keep   = [p for p in group if preferred_format_rank(p) == best_rank]
    to_delete = [p for p in group if preferred_format_rank(p) != best_rank]
    return to_keep, to_delete


def prompt_group(idx: int, total: int, group: list[Path]) -> list[Path]:
    """
    Show one duplicate group and return the paths the user wants to delete.
    """
    print(f"\n{'─'*60}")
    print(f"  Duplicate group {idx}/{total}  ({len(group)} files)")
    print(f"{'─'*60}")

    for n, p in enumerate(group, 1):
        size = human_size(p)
        print(f"  [{n}]  {p}  ({size})")

    print()
    print("  Enter numbers to DELETE (e.g. 2,3), 'a' to skip all, 'q' to quit.")
    print("  Tip: keep the file you want and delete the rest.")

    while True:
        raw = input("  Your choice: ").strip().lower()

        if raw in ("", "a", "skip"):
            return []

        if raw == "q":
            print("\n  Quitting – no further deletions.")
            sys.exit(0)

        try:
            indices = [int(x.strip()) for x in raw.split(",")]
            to_delete = []
            valid = True
            for i in indices:
                if 1 <= i <= len(group):
                    to_delete.append(group[i - 1])
                else:
                    print(f"  ✗ Invalid number: {i}")
                    valid = False
                    break
            if not valid:
                continue
            if len(to_delete) == len(group):
                confirm = input("  ⚠  You selected ALL files in this group – are you sure? (yes/no): ").strip().lower()
                if confirm not in ("yes", "y"):
                    print("  Skipping.")
                    return []
            return to_delete
        except ValueError:
            print("  ✗ Please enter comma-separated numbers, 'a', or 'q'.")


def run_interactive(groups: list[list[Path]], dry_run: bool):
    deleted_count = 0
    freed_bytes = 0
    total = len(groups)

    for idx, group in enumerate(groups, 1):
        resolved = resolve_by_format(group)
        if resolved is not None:
            to_keep, auto_delete = resolved
            print(f"\n{'─'*60}")
            print(f"  Duplicate group {idx}/{total}  ({len(group)} files)  – auto-resolved by format")
            print(f"{'─'*60}")
            for p in to_keep:
                print(f"  ✔ KEEP    {p}  ({human_size(p)})")
            for p in auto_delete:
                print(f"  🗑 DELETE  {p}  ({human_size(p)})")
            confirm = input("\n  Proceed with auto-deletion? (yes/no/q): ").strip().lower()
            if confirm == "q":
                print("\n  Quitting – no further deletions.")
                sys.exit(0)
            to_delete = auto_delete if confirm in ("yes", "y") else []
        else:
            to_delete = prompt_group(idx, total, group)

        for path in to_delete:
            size = path.stat().st_size
            if dry_run:
                print(f"  [DRY RUN] Would delete: {path}")
            else:
                try:
                    path.unlink()
                    print(f"  🗑  Deleted: {path}")
                    deleted_count += 1
                    freed_bytes += size
                except OSError as e:
                    print(f"  ✗ Could not delete {path}: {e}")

    print(f"\n{'═'*60}")
    if dry_run:
        print("  DRY RUN complete – no files were actually deleted.")
    else:
        freed_mb = freed_bytes / (1024 * 1024)
        print(f"  Done.  Deleted {deleted_count} file(s), freed {freed_mb:.2f} MB.")
    print(f"{'═'*60}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Find duplicate images and interactively delete them.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python find_duplicate_images.py ~/Pictures
  python find_duplicate_images.py ~/Pictures --recursive
  python find_duplicate_images.py ~/Pictures --method phash --threshold 5
  python find_duplicate_images.py ~/Pictures --dry-run
        """,
    )
    parser.add_argument("directory", help="Directory to scan")
    parser.add_argument("-r", "--recursive", action="store_true", help="Scan subdirectories")
    parser.add_argument(
        "--method",
        choices=["exact", "phash"],
        default="phash" if PHASH_AVAILABLE else "exact",
        help="'exact' = identical bytes only  |  'phash' = near-duplicates (default if imagehash installed)",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=10,
        help="Max perceptual-hash distance to consider near-duplicate (0=identical, higher=looser). Default: 10",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would be deleted without deleting")

    args = parser.parse_args()

    directory = Path(args.directory).expanduser().resolve()
    if not directory.is_dir():
        print(f"✗ Not a directory: {directory}")
        sys.exit(1)

    use_phash = args.method == "phash"
    if use_phash and not PHASH_AVAILABLE:
        print("✗ imagehash is not installed; cannot use phash method.  Run: pip install imagehash")
        sys.exit(1)

    print(f"\n{'═'*60}")
    print(f"  Duplicate Image Finder")
    print(f"{'═'*60}")
    print(f"  Directory : {directory}")
    print(f"  Recursive : {args.recursive}")
    print(f"  Method    : {'perceptual hash (near-duplicates)' if use_phash else 'exact (MD5)'}")
    if use_phash:
        print(f"  Threshold : {args.threshold}")
    if args.dry_run:
        print(f"  Mode      : DRY RUN (nothing will be deleted)")
    print()

    print("  Collecting images …")
    images = collect_images(directory, args.recursive)
    print(f"  Found {len(images)} image(s).\n")

    if not images:
        print("  No images found. Exiting.")
        sys.exit(0)

    print("  Scanning for duplicates …")
    groups = find_duplicates(images, use_phash, args.threshold)

    if not groups:
        print("\n  ✓ No duplicates found!")
        sys.exit(0)

    total_dupes = sum(len(g) - 1 for g in groups)
    print(f"\n  Found {len(groups)} duplicate group(s) ({total_dupes} redundant file(s)).")

    run_interactive(groups, args.dry_run)


if __name__ == "__main__":
    main()
