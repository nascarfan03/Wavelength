#!/usr/bin/env python3
"""
GitHub HTML Scanner
Scans a GitHub repo for HTML files and outputs formatted links with page titles.
Uses the latest commit hash in the rawcdn.githack.com URL (branch names 404).

Usage:
    python github_html_scanner.py
    python github_html_scanner.py --repo owner/repo --branch main --output links.txt
    python github_html_scanner.py --token YOUR_GITHUB_TOKEN  # for private repos or higher rate limits
"""

import argparse
import re
import sys
import time
import urllib.request
import urllib.error
import json


# ── Config defaults ────────────────────────────────────────────────────────────
DEFAULT_REPO   = "ajtabjs/wl-ruffle"
DEFAULT_BRANCH = "master"
DEFAULT_OUTPUT = "game_links.txt"
RAW_CDN_BASE   = "https://rawcdn.githack.com/{repo}/{commit}"
RAW_BASE       = "https://raw.githubusercontent.com/{repo}/{branch}"
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
    Convert a file path like 'my-cool-game/play.html' or 'arcade/snake.html'
    into a human-readable title like 'My Cool Game Play' or 'Arcade Snake'.
    Used as a fallback when no <title> tag is found.
    """
    no_ext = re.sub(r"\.html?$", "", path, flags=re.IGNORECASE)
    parts  = re.split(r"[/\-_]", no_ext)
    return " ".join(w.capitalize() for w in parts if w)


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


def scan_repo(repo: str, branch: str, token: str | None) -> list[tuple[str, str]]:
    """
    Walk the repo tree and return a list of (rawcdn_url, title) pairs
    for every HTML file found (any name, any folder depth).
    """
    # Get the latest commit hash first so the CDN URL is stable and won't 404
    commit   = get_latest_commit(repo, branch, token)
    cdn_base = RAW_CDN_BASE.format(repo=repo, commit=commit)
    raw_base = RAW_BASE.format(repo=repo, branch=branch)

    tree_items = get_all_tree_items(repo, branch, token)

    # Match only index.html files (at any folder depth)
    html_files = [
        item["path"] for item in tree_items
        if item["type"] == "blob"
        and item["path"].lower().endswith("index.html")
    ]

    print(f"  Found {len(html_files)} HTML file(s). Fetching titles ...\n")

    results = []
    for i, path in enumerate(html_files, 1):
        cdn_url = f"{cdn_base}/{path}"
        raw_url = f"{raw_base}/{path}"

        # Try to get the page title from the raw HTML
        html_content = fetch_text(raw_url)
        if html_content:
            title = extract_title(html_content) or path_to_title(path)
        else:
            title = path_to_title(path)

        results.append((cdn_url, title))
        print(f"  [{i}/{len(html_files)}] {title}")

        time.sleep(0.15)

    return results


def write_output(results: list[tuple[str, str]], output_path: str) -> None:
    """Write the URL | Title pairs to a text file."""
    with open(output_path, "w", encoding="utf-8") as f:
        for url, title in results:
            f.write(f"{url} | {title}\n")
    print(f"\n  Wrote {len(results)} entries to: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan a GitHub repo for HTML files and output CDN links with titles."
    )
    parser.add_argument("--repo",   default=DEFAULT_REPO,
                        help=f"GitHub repo in owner/name format (default: {DEFAULT_REPO})")
    parser.add_argument("--branch", default=DEFAULT_BRANCH,
                        help=f"Branch name (default: {DEFAULT_BRANCH})")
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help=f"Output text file path (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--token",  default=None,
                        help="GitHub personal access token (optional, increases rate limit)")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  GitHub HTML Scanner")
    print(f"{'='*60}")
    print(f"  Repo       : {args.repo}")
    print(f"  Branch     : {args.branch}")
    print(f"  Output     : {args.output}")
    print(f"{'='*60}\n")

    try:
        results = scan_repo(args.repo, args.branch, args.token)
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

    if not results:
        print("No HTML files found.")
        return

    write_output(results, args.output)

    # Preview first 5
    print("\nPreview (first 5 entries):")
    print("-" * 60)
    for url, title in results[:5]:
        print(f"  {url} | {title}")
    if len(results) > 5:
        print(f"  ... and {len(results) - 5} more.")


if __name__ == "__main__":
    main()