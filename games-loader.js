/**
 * games-loader.js
 * Loads games from Eleventy-injected data and renders them in the Wavelength UI.
 * 
 * To add games: edit the JSON files in /_data/ folder:
 *   - htmlGames.json   → HTML5 games
 *   - ruffleGames.json → Flash/Ruffle games
 *   - webPorts.json    → Web ports
 *
 * Then run: npm run build (or npm start for dev server)
 *
 * Each game entry format:
 * {
 *   "name": "Game Name",
 *   "slug": "game-slug",        // unique ID for URL
 *   "path": "GameFolder/index.html",
 *   "thumbnail": "GameFolder/thumbnail.jpg",
 *   "description": "Game description."
 * }
 */

(function () {
  "use strict";

  const CHUNK_SIZE = 50;
  const TYPE_LABELS = {
    html: "html5",
    ruffle: "flash",
    webPorts: "web port"
  };

  let baseUrls = {};
  let allGames = [];
  let filteredGames = [];
  let loadedCount = 0;
  let loading = false;
  let currentFilter = "all";

  // DOM refs
  let grid, sentinel, statusEl, searchEl, sortEl;

  function init() {
    grid = document.getElementById("games-grid");
    sentinel = document.getElementById("games-sentinel");
    statusEl = document.getElementById("games-status");
    searchEl = document.getElementById("games-search");
    sortEl = document.getElementById("games-sort");

    if (!grid) return;

    // Use Eleventy-injected data (set in index.njk at build time)
    if (!window.__GAMES_DATA__ || !window.__BASE_URLS__) {
      console.error("games-loader: __GAMES_DATA__ or __BASE_URLS__ not found. Did Eleventy build?");
      grid.innerHTML = '<div class="games-error">Game data not found. Run npm run build.</div>';
      return;
    }

    baseUrls = window.__BASE_URLS__;
    allGames = window.__GAMES_DATA__;

    applyFilters();

    // Event listeners
    searchEl?.addEventListener("input", debounce(applyFilters, 200));
    sortEl?.addEventListener("change", applyFilters);

    // Filter buttons
    document.querySelectorAll(".games-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".games-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    // Infinite scroll
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) loadNextChunk();
      });
    }, { rootMargin: "200px" });
    observer.observe(sentinel);
  }

  function applyFilters() {
    const query = (searchEl?.value || "").trim().toLowerCase();
    const sortValue = sortEl?.value || "alpha-asc";

    // Filter by type
    let result = currentFilter === "all"
      ? allGames.slice()
      : allGames.filter(g => g.type === currentFilter);

    // Filter by search
    if (query) {
      result = result.filter(g => g.name.toLowerCase().includes(query));
    }

    // Sort
    result.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortValue === "alpha-desc" ? -cmp : cmp;
    });

    filteredGames = result;
    loadedCount = 0;
    grid.innerHTML = "";
    loadNextChunk();
  }

  function loadNextChunk() {
    if (loading || loadedCount >= filteredGames.length) {
      setStatus(filteredGames.length === 0 ? "No games found." : `${filteredGames.length} game${filteredGames.length !== 1 ? "s" : ""}`);
      return;
    }

    loading = true;
    const slice = filteredGames.slice(loadedCount, loadedCount + CHUNK_SIZE);
    const frag = document.createDocumentFragment();

    slice.forEach(game => frag.appendChild(buildCard(game)));

    grid.appendChild(frag);
    loadedCount += slice.length;
    loading = false;

    const remaining = filteredGames.length - loadedCount;
    setStatus(remaining > 0 
      ? `Showing ${loadedCount} of ${filteredGames.length} games` 
      : `${filteredGames.length} game${filteredGames.length !== 1 ? "s" : ""}`);
  }

  function buildCard(game) {
    const baseUrl = baseUrls[game.type] || "";
    // Thumbnails are stored locally in assets/games/
    const thumbUrl = `assets/games/${game.thumbnail}`;
    const typeLabel = TYPE_LABELS[game.type] || game.type;

    const card = document.createElement("div");
    card.className = "game-card";
    card.setAttribute("data-slug", game.slug);
    card.setAttribute("data-type", game.type);
    card.onclick = () => playGame(game.slug, game.type);

    card.innerHTML = `
      <div class="game-card-thumb">
        <img data-src="${escHtml(thumbUrl)}" alt="${escHtml(game.name)}" class="lazy" />
      </div>
      <div class="game-card-info">
        <div class="game-card-title">${escHtml(game.name)}</div>
        <div class="game-card-type game-card-type--${game.type}">${escHtml(typeLabel)}</div>
      </div>
    `;

    // Lazy load image
    const img = card.querySelector("img.lazy");
    lazyLoadImg(img);

    return card;
  }

  const imgObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.classList.remove("lazy");
        imgObserver.unobserve(img);
      }
    });
  }, { rootMargin: "100px" });

  function lazyLoadImg(img) {
    imgObserver.observe(img);
  }

  function playGame(slug, type) {
    // Find game data
    const game = allGames.find(g => g.slug === slug && g.type === type);
    if (!game) return;

    const baseUrl = baseUrls[type] || "";
    const gameUrl = `${baseUrl}${game.path}`;

    // Store current game URL for fullscreen/cloak functions
    window.__CURRENT_GAME_URL__ = gameUrl;

    // Switch to iframe view
    document.getElementById("games-list-view").style.display = "none";
    document.getElementById("games-play-view").style.display = "block";
    
    const iframe = document.getElementById("game-iframe");
    iframe.src = gameUrl;
  }

  window.playGame = playGame;

  window.closeGame = function() {
    document.getElementById("games-play-view").style.display = "none";
    document.getElementById("games-list-view").style.display = "block";
    document.getElementById("game-iframe").src = "";
    window.__CURRENT_GAME_URL__ = null;
  };

  window.toggleFullscreen = function() {
    const iframe = document.getElementById("game-iframe");
    if (iframe.requestFullscreen) {
      iframe.requestFullscreen();
    } else if (iframe.webkitRequestFullscreen) {
      iframe.webkitRequestFullscreen();
    } else if (iframe.msRequestFullscreen) {
      iframe.msRequestFullscreen();
    }
  };

  window.openCloaked = function() {
    const gameUrl = window.__CURRENT_GAME_URL__;
    if (!gameUrl) return;

    // Open about:blank and inject iframe (cloaked URL)
    const win = window.open();
    if (win) {
      const iframe = win.document.createElement('iframe');
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "none";
      iframe.style.position = "fixed";
      iframe.style.top = "0";
      iframe.style.left = "0";
      iframe.src = gameUrl;
      win.document.body.style.margin = "0";
      win.document.body.style.overflow = "hidden";
      win.document.body.appendChild(iframe);
    }
  };

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
