# Wavelength

A games website that just happens to be UBG

## Quick Start

```bash
npm install        # Install dependencies (first time only)
npm start          # Dev server at http://localhost:8000
npm run build      # Build for production → _site/
```

## Adding Games

Edit the JSON files in `_data/`:

| File | Game Type |
|------|-----------|
| `htmlGames.json` | HTML5 games |
| `ruffleGames.json` | Flash/Ruffle games |
| `webPorts.json` | Web ports |

### Game entry format:

```json
{
  "name": "Game Name",
  "slug": "game-slug",
  "path": "GameFolder/index.html",
  "thumbnail": "GameFolder/thumbnail.jpg",
  "description": "Short description of the game."
}
```

- **`slug`** — Unique identifier (used in URLs)
- **`path`** — Path to game file (appended to base URL)
- **`thumbnail`** — Path to thumbnail image (appended to base URL)

### CDN Base URLs

Edit `_data/baseUrls.json` to change where games are hosted:

```json
{
  "html": "https://your-cdn.com/html-games/",
  "ruffle": "https://your-cdn.com/flash-games/",
  "webPorts": "https://your-cdn.com/web-ports/"
}
```

## Project Structure

```
_data/              ← Game JSON files (edit these!)
  ├── htmlGames.json
  ├── ruffleGames.json
  ├── webPorts.json
  └── baseUrls.json
src/
  └── index.njk     ← Main page template
_site/              ← Built output (deploy this)
assets/             ← Images, logo, etc.
styles.css          ← Site styles
games-loader.js     ← Games grid logic
.eleventy.js        ← Eleventy config
```

## Deployment

Run `npm run build` and deploy the `_site/` folder to your host.
