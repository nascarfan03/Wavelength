"""
parse_games.py
--------------
Parses a game list .txt file (one entry per line in the format:
  https://cdn.../folder-name-hexid/index.html | Game Name HexId
) and outputs a games JSON file ready to drop into _data/.

Usage:
  python parse_games.py <input.txt> <output.json> <base_url>

Example:
  python parse_games.py ruffle.txt _data/ruffleGames.json \
    "https://rawcdn.githack.com/ajtabjs/wl-ruffle/7dd884f9c0d163fc4b2f8c87dae7471606a2c6a2"
"""

import json
import re
import sys
from pathlib import Path


def clean_name(raw: str) -> str:
    """Strip the trailing hex ID suffix from a display name.
    e.g. '1 Screen Hero 17692Cbcc' -> '1 Screen Hero'
    """
    return re.sub(r'\s+[0-9A-Fa-f]{6,}$', '', raw).strip()


def parse(input_path: str, base_url: str) -> list[dict]:
    base_url = base_url.rstrip("/")
    games = []

    with open(input_path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue

            parts = line.split(" | ", 1)
            if len(parts) != 2:
                print(f"  [!] Line {lineno} skipped (unexpected format): {line[:80]}")
                continue

            url, raw_name = parts[0].strip(), parts[1].strip()

            # Derive the relative path by stripping the base URL
            if not url.startswith(base_url):
                print(f"  [!] Line {lineno} skipped (URL doesn't match base): {url[:80]}")
                continue

            path = url[len(base_url):].lstrip("/")  # e.g. "folder-name/index.html"
            slug = path.replace("/index.html", "")   # e.g. "folder-name"
            name = clean_name(raw_name)

            games.append({
                "name": name,
                "slug": slug,
                "path": path,
                "thumbnail": f"{slug}/thumbnail.jpg",  # update when thumbnails are available
                "description": ""
            })

    return games


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2]
    base_url    = sys.argv[3]

    if not Path(input_path).exists():
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    print(f"Parsing {input_path} ...")
    games = parse(input_path, base_url)
    print(f"  {len(games)} games parsed")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=2, ensure_ascii=False)

    print(f"Written to {output_path}")


if __name__ == "__main__":
    main()