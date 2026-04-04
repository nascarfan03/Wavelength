"""
clean_names.py
--------------
Removes unwanted suffixes/prefixes from game names in JSON data files.
Cleans strings like "Unity WebGL Player", "- Play Online", etc.

Usage:
  python clean_names.py                    # Clean all JSON files in _data/
  python clean_names.py <file.json>        # Clean a specific file
  python clean_names.py --dry-run          # Preview changes without saving
"""

import json
import re
import sys
from pathlib import Path

# Patterns to remove from game names (case-insensitive)
PATTERNS_TO_REMOVE = [
    r'\s*[-|]\s*Unity WebGL Player\s*',
    r'\s*Unity WebGL Player\s*[-|]?\s*',
    r'\s*[-|]\s*Play Online\s*',
    r'\s*[-|]\s*Play Now\s*',
    r'\s*[-|]\s*Free Online Game\s*',
    r'\s*[-|]\s*Browser Game\s*',
    r'\s*[-|]\s*HTML5 Game\s*',
    r'\s*[-|]\s*WebGL\s*',
    r'\s*\(Unity\)\s*',
    r'\s*\[Unity\]\s*',
]

# Compile patterns for efficiency
COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in PATTERNS_TO_REMOVE]


def clean_name(name: str) -> str:
    """Remove unwanted patterns from a game name."""
    cleaned = name
    for pattern in COMPILED_PATTERNS:
        cleaned = pattern.sub('', cleaned)
    return cleaned.strip()


def process_file(filepath: Path, dry_run: bool = False) -> int:
    """Process a single JSON file. Returns number of names changed."""
    with open(filepath, encoding='utf-8') as f:
        data = json.load(f)

    if not isinstance(data, list):
        print(f"  Skipping {filepath.name} (not a list)")
        return 0

    changes = 0
    for entry in data:
        if 'name' in entry:
            original = entry['name']
            cleaned = clean_name(original)
            if cleaned != original:
                changes += 1
                print(f"  {original!r} -> {cleaned!r}")
                if not dry_run:
                    entry['name'] = cleaned

    if changes > 0 and not dry_run:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')  # trailing newline

    return changes


def main():
    dry_run = '--dry-run' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--dry-run']

    # Determine which files to process
    if args:
        files = [Path(a) for a in args]
    else:
        data_dir = Path(__file__).parent.parent / '_data'
        files = list(data_dir.glob('*Games.json')) + list(data_dir.glob('*Ports.json'))

    if not files:
        print("No JSON files found to process.")
        sys.exit(1)

    if dry_run:
        print("=== DRY RUN (no changes will be saved) ===\n")

    total_changes = 0
    for filepath in files:
        if not filepath.exists():
            print(f"File not found: {filepath}")
            continue

        print(f"Processing {filepath.name}...")
        changes = process_file(filepath, dry_run)
        total_changes += changes
        if changes == 0:
            print("  No changes needed")

    print(f"\nTotal: {total_changes} name(s) {'would be ' if dry_run else ''}cleaned")


if __name__ == "__main__":
    main()
