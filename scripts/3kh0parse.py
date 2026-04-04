#!/usr/bin/env python3
"""
GitHub HTML Scanner
Scans a GitHub repo for HTML files and splits them into two lists:
  - ruffle_games.txt  : files where the path OR content references "ruffle"
  - other_games.txt   : everything else

New entries are merged into existing files (no duplicates by URL).

Usage:
    python github_html_scanner.py
    python github_html_scanner.py --repo owner/repo --branch main
    python github_html_scanner.py --ruffle ruffle_games.txt --other other_games.txt
    python github_html_scanner.py --token YOUR_GITHUB_TOKEN
"""

import argparse
import re
import sys
import time
import urllib.request
import urllib.error
import json
import os


# ── Config defaults ────────────────────────────────────────────────────────────
DEFAULT_REPO          = "ajtabjs/wl-main"
DEFAULT_BRANCH        = "master"
DEFAULT_RUFFLE_OUTPUT = "ruffle_games.txt"
DEFAULT_OTHER_OUTPUT  = "other_games.txt"
RAW_CDN_BASE          = "https://rawcdn.githack.com/{repo}/{commit}"
RAW_BASE              = "https://raw.githubusercontent.com/{repo}/{branch}"
# ──────────────────────────────────────────────────────────────────────────────


def github_get(url: str, token: str | None = None) -> dict | list:
    """Fetch a GitHub API URL and return parsed JSON."""
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "github-html-scanner/1.0")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def fetch_text(url: str) -> str | None:
    """Fetch raw text content from a URL, return None on failure."""
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "github-html-scanner/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def extract_title(html: str) -> str | None:
    """Extract the <title> text from an HTML string."""
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if match:
        title = match.group(1).strip()
        title = re.sub(r"\s+", " ", title)
        return title if title else None
    return None


def path_to_title(path: str) -> str:
    """
    Convert a file path like 'my-cool-game/index.html'
    into a human-readable title like 'My Cool Game'.
    Used as a fallback when no <title> tag is found.
    """
    no_ext = re.sub(r"\.html?$", "", path, flags=re.IGNORECASE)
    parts  = re.split(r"[/\-_]", no_ext)
    # Drop generic trailing parts like "index" or "play"
    filtered = [w for w in parts if w.lower() not in ("index", "play", "game")]
    words = filtered if filtered else parts
    return " ".join(w.capitalize() for w in words if w)


def is_ruffle(path: str, html_content: str | None) -> bool:
    """
    Return True if either:
      - the file path contains "ruffle" (case-insensitive), OR
      - the HTML content references ruffle (e.g. ruffle.js, ruffle.wasm, ruffle.min.js)
    """
    if "ruffle" in path.lower():
        return True
    if html_content and re.search(r"ruffle", html_content, re.IGNORECASE):
        return True
    return False


def load_existing(filepath: str) -> dict[str, str]:
    """
    Load an existing url | title list into a dict keyed by URL.
    Returns an empty dict if the file doesn't exist.
    """
    entries = {}
    if not os.path.exists(filepath):
        return entries
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if " | " in line:
                url, title = line.split(" | ", 1)
                entries[url.strip()] = title.strip()
    return entries


def get_latest_commit(repo: str, branch: str, token: str | None) -> str:
    """Return the full SHA of the latest commit on the given branch."""
    url  = f"https://api.github.com/repos/{repo}/commits/{branch}?per_page=1"
    data = github_get(url, token)
    sha  = data.get("sha")
    if not sha:
        sys.exit(f"ERROR: could not retrieve latest commit SHA — {data.get('message', data)}")
    print(f"  Latest commit : {sha}")
    return sha


def get_all_tree_items(repo: str, branch: str, token: str | None) -> list[dict]:
    """Return every item in the repo tree (recursive) via the Git Trees API."""
    url = f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1"
    print(f"  Fetching repo tree from GitHub API ...")
    data = github_get(url, token)
    if "tree" not in data:
        sys.exit(f"ERROR: unexpected API response — {data.get('message', data)}")
    if data.get("truncated"):
        print("  WARNING: Tree was truncated by GitHub (very large repo). Some files may be missing.")
    return data["tree"]


def scan_repo(
    repo: str,
    branch: str,
    token: str | None,
    existing_ruffle: dict[str, str],
    existing_other: dict[str, str],
) -> tuple[dict[str, str], dict[str, str], int, int]:
    """
    Walk the repo tree and split index.html files into ruffle vs. other.
    Merges with existing dicts, skipping URLs already present.
    Returns (ruffle_dict, other_dict, new_ruffle_count, new_other_count).
    """
    commit   = get_latest_commit(repo, branch, token)
    cdn_base = RAW_CDN_BASE.format(repo=repo, commit=commit)
    raw_base = RAW_BASE.format(repo=repo, branch=branch)

    tree_items = get_all_tree_items(repo, branch, token)

    html_files = [
        item["path"] for item in tree_items
        if item["type"] == "blob"
        and item["path"].lower().endswith("index.html")
    ]

    print(f"  Found {len(html_files)} index.html file(s). Scanning ...\n")

    ruffle_dict = dict(existing_ruffle)
    other_dict  = dict(existing_other)
    new_ruffle  = 0
    new_other   = 0

    all_known_urls = set(existing_ruffle) | set(existing_other)

    for i, path in enumerate(html_files, 1):
        cdn_url = f"{cdn_base}/{path}"
        raw_url = f"{raw_base}/{path}"

        # Skip URLs we already have in either list
        if cdn_url in all_known_urls:
            print(f"  [{i}/{len(html_files)}] (already listed) {path}")
            time.sleep(0.05)
            continue

        html_content = fetch_text(raw_url)
        title = (extract_title(html_content) if html_content else None) or path_to_title(path)

        if is_ruffle(path, html_content):
            ruffle_dict[cdn_url] = title
            new_ruffle += 1
            tag = "[RUFFLE]"
        else:
            other_dict[cdn_url] = title
            new_other += 1
            tag = "[other ]"

        print(f"  [{i}/{len(html_files)}] {tag} {title}")
        time.sleep(0.15)

    return ruffle_dict, other_dict, new_ruffle, new_other


def write_list(entries: dict[str, str], filepath: str) -> None:
    """Write a url | title list to disk, sorted by title."""
    with open(filepath, "w", encoding="utf-8") as f:
        for url, title in sorted(entries.items(), key=lambda kv: kv[1].lower()):
            f.write(f"{url} | {title}\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan a GitHub repo for HTML files, split into ruffle vs. other."
    )
    parser.add_argument("--repo",   default=DEFAULT_REPO,
                        help=f"GitHub repo in owner/name format (default: {DEFAULT_REPO})")
    parser.add_argument("--branch", default=DEFAULT_BRANCH,
                        help=f"Branch name (default: {DEFAULT_BRANCH})")
    parser.add_argument("--ruffle", default=DEFAULT_RUFFLE_OUTPUT,
                        help=f"Ruffle games list file (default: {DEFAULT_RUFFLE_OUTPUT})")
    parser.add_argument("--other",  default=DEFAULT_OTHER_OUTPUT,
                        help=f"Other games list file (default: {DEFAULT_OTHER_OUTPUT})")
    parser.add_argument("--token",  default=None,
                        help="GitHub personal access token (optional, increases rate limit)")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  GitHub HTML Scanner")
    print(f"{'='*60}")
    print(f"  Repo         : {args.repo}")
    print(f"  Branch       : {args.branch}")
    print(f"  Ruffle list  : {args.ruffle}")
    print(f"  Other list   : {args.other}")
    print(f"{'='*60}\n")

    # Load any pre-existing lists so we can merge without duplicates
    existing_ruffle = load_existing(args.ruffle)
    existing_other  = load_existing(args.other)
    print(f"  Loaded {len(existing_ruffle)} existing ruffle entries, "
          f"{len(existing_other)} other entries.\n")

    try:
        ruffle_dict, other_dict, new_ruffle, new_other = scan_repo(
            args.repo, args.branch, args.token,
            existing_ruffle, existing_other,
        )
    except urllib.error.HTTPError as e:
        if e.code == 403:
            sys.exit(
                "ERROR: GitHub API rate limit hit (60 req/hr for unauthenticated).\n"
                "Pass --token YOUR_GITHUB_TOKEN to get 5,000 req/hr."
            )
        elif e.code == 404:
            sys.exit("ERROR: Repo or branch not found — check --repo and --branch.")
        else:
            sys.exit(f"ERROR: HTTP {e.code} — {e.reason}")

    write_list(ruffle_dict, args.ruffle)
    write_list(other_dict,  args.other)

    print(f"\n{'='*60}")
    print(f"  Done!")
    print(f"  New ruffle entries : {new_ruffle}  (total: {len(ruffle_dict)})")
    print(f"  New other entries  : {new_other}   (total: {len(other_dict)})")
    print(f"  Ruffle list → {args.ruffle}")
    print(f"  Other list  → {args.other}")
    print(f"{'='*60}\n")

    # Preview
    if ruffle_dict:
        print("Ruffle preview (first 5):")
        for url, title in list(ruffle_dict.items())[:5]:
            print(f"  {url} | {title}")
    if other_dict:
        print("\nOther preview (first 5):")
        for url, title in list(other_dict.items())[:5]:
            print(f"  {url} | {title}")


if __name__ == "__main__":
    main()