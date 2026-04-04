"""
update_base_urls.py
-------------------
Fetches the latest commit hashes from GitHub repos and updates baseUrls.json.

Usage:
  python update_base_urls.py              # Update all repos
  python update_base_urls.py --dry-run    # Preview changes without saving

Requires: requests (pip install requests)
"""

import json
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: requests module not found. Install with: pip install requests")
    sys.exit(1)

# Repo configuration: key -> (owner, repo, branch)
REPOS = {
    "html": ("ajtabjs", "wl-main", "main"),
    "ruffle": ("ajtabjs", "wl-ruffle", "main"),
    "webPorts": ("ajtabjs", "wl-ports2", "main"),
}

BASE_URL_TEMPLATE = "https://rawcdn.githack.com/{owner}/{repo}/{commit}/"


def get_latest_commit(owner: str, repo: str, branch: str) -> str | None:
    """Fetch the latest commit SHA from a GitHub repo."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/{branch}"
    headers = {"Accept": "application/vnd.github.v3+json"}
    
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()["sha"]
    except requests.RequestException as e:
        print(f"  [!] Failed to fetch {owner}/{repo}: {e}")
        return None


def main():
    dry_run = "--dry-run" in sys.argv
    
    data_dir = Path(__file__).parent.parent / "_data"
    base_urls_path = data_dir / "baseUrls.json"
    
    if not base_urls_path.exists():
        print(f"Error: {base_urls_path} not found")
        sys.exit(1)
    
    with open(base_urls_path, encoding="utf-8") as f:
        base_urls = json.load(f)
    
    if dry_run:
        print("=== DRY RUN (no changes will be saved) ===\n")
    
    print("Fetching latest commit hashes...\n")
    
    changes = 0
    for key, (owner, repo, branch) in REPOS.items():
        print(f"{key}: {owner}/{repo} ({branch})")
        
        commit = get_latest_commit(owner, repo, branch)
        if not commit:
            continue
        
        new_url = BASE_URL_TEMPLATE.format(owner=owner, repo=repo, commit=commit)
        old_url = base_urls.get(key, "")
        
        if new_url != old_url:
            print(f"  Old: {old_url}")
            print(f"  New: {new_url}")
            changes += 1
            if not dry_run:
                base_urls[key] = new_url
        else:
            print(f"  Already up to date")
        print()
    
    if changes > 0 and not dry_run:
        with open(base_urls_path, "w", encoding="utf-8") as f:
            json.dump(base_urls, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"Updated {base_urls_path}")
    elif changes > 0:
        print(f"{changes} change(s) would be made")
    else:
        print("No changes needed")


if __name__ == "__main__":
    main()
