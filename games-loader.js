/**
 * games-loader.js
 * Loads games from Eleventy-injected data and renders them in the Wavelength UI.
 * * APPROACH: Fetches the HTML source and injects it into the iframe/window.
 * This bypasses jsDelivr "text/plain" security headers and ensures all
 * relative assets load from the correct CDN directory.
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

    if (!window.__GAMES_DATA__ || !window.__BASE_URLS__) {
      console.error("games-loader: Data not found. Ensure Eleventy build completed.");
      grid.innerHTML = '<div class="games-error">Game data not found.</div>';
      return;
    }

    baseUrls = window.__BASE_URLS__;
    allGames = window.__GAMES_DATA__;

    applyFilters();

    searchEl?.addEventListener("input", debounce(applyFilters, 200));
    sortEl?.addEventListener("change", applyFilters);

    document.querySelectorAll(".games-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".games-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) loadNextChunk();
      });
    }, { root: grid, rootMargin: "200px" });
    observer.observe(sentinel);

    window.onGamesTabVisible = function() {
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    };
  }

  function applyFilters() {
    const query = (searchEl?.value || "").trim().toLowerCase();
    const sortValue = sortEl?.value || "alpha-asc";

    let result = currentFilter === "all"
      ? allGames.slice()
      : allGames.filter(g => g.type === currentFilter);

    if (query) {
      result = result.filter(g => g.name.toLowerCase().includes(query));
    }

    result.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortValue === "alpha-desc" ? -cmp : cmp;
    });

    filteredGames = result;
    loadedCount = 0;
    while (grid.firstChild && grid.firstChild !== sentinel) {
      grid.removeChild(grid.firstChild);
    }
    loadNextChunk();
  }

  function loadNextChunk() {
    if (loading || loadedCount >= filteredGames.length) {
      setStatus(filteredGames.length === 0 ? "No games found." : `${filteredGames.length} games`);
      return;
    }

    loading = true;
    const slice = filteredGames.slice(loadedCount, loadedCount + CHUNK_SIZE);
    const frag = document.createDocumentFragment();

    slice.forEach(game => frag.appendChild(buildCard(game)));

    grid.insertBefore(frag, sentinel);
    loadedCount += slice.length;
    loading = false;

    const remaining = filteredGames.length - loadedCount;
    setStatus(remaining > 0 
      ? `Showing ${loadedCount} of ${filteredGames.length} games` 
      : `${filteredGames.length} games`);
  }

  function buildCard(game) {
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

  /**
   * UNIVERSAL INJECTION LOADER
   * Works for all types (html, ruffle, webPorts) that serve an index.html
   */
  async function playGame(slug, type) {
    const game = allGames.find(g => g.slug === slug && g.type === type);
    if (!game) return;

    const cdn = game.cdn || type;
    const baseUrl = baseUrls[cdn] || "";
    const gameUrl = `${baseUrl}${game.path}`;

    window.__CURRENT_GAME__ = game;
    window.__CURRENT_GAME_URL__ = gameUrl;

    document.getElementById("games-list-view").style.display = "none";
    document.getElementById("games-play-view").style.display = "block";
    
    const iframe = document.getElementById("game-iframe");
    iframe.style.display = "block";

    try {
      // 1. Fetch the HTML
      const response = await fetch(gameUrl + "?t=" + Date.now());
      if (!response.ok) throw new Error("Fetch failed from CDN");
      const html = await response.text();

      // 2. Identify the folder directory for the <base> tag
      const baseDir = gameUrl.substring(0, gameUrl.lastIndexOf('/') + 1);
      
      // 3. Inject into the local iframe
      const iframeDoc = iframe.contentWindow.document;
      iframeDoc.open();
      // We prepend the <base> tag so internal scripts load from the CDN folder
      iframeDoc.write(`<base href="${baseDir}">${html}`);
      iframeDoc.close();

    } catch (err) {
      console.error("Injection failed, falling back to standard src:", err);
      iframe.src = gameUrl;
    }
    
    const messageEl = document.getElementById("cloaked-message");
    if (messageEl) messageEl.style.display = "none";
  }

  window.playGame = playGame;

  window.closeGame = function() {
    document.getElementById("games-play-view").style.display = "none";
    document.getElementById("games-list-view").style.display = "block";
    
    const iframe = document.getElementById("game-iframe");
    
    try {
      const iframeDoc = iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(""); // Clear memory
      iframeDoc.close();
    } catch(e) {}
    
    iframe.src = "";
    
    const messageEl = document.getElementById("cloaked-message");
    if (messageEl) messageEl.style.display = "none";
    
    window.__CURRENT_GAME_URL__ = null;
    window.__CURRENT_GAME__ = null;
  };

  window.toggleFullscreen = function() {
    const iframe = document.getElementById("game-iframe");
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
    else if (iframe.msRequestFullscreen) iframe.msRequestFullscreen();
  };

  /**
   * OPEN CLOAKED (about:blank)
   */
  window.openCloaked = async function() {
    const gameUrl = window.__CURRENT_GAME_URL__;
    const game = window.__CURRENT_GAME__;
    if (!gameUrl || !game) return;

    const win = window.open();
    if (win) {
      win.document.body.style.margin = "0";
      win.document.body.style.overflow = "hidden";
      win.document.title = game.name || "Game";

      try {
        const response = await fetch(gameUrl + "?t=" + Date.now());
        const html = await response.text();
        const baseDir = gameUrl.substring(0, gameUrl.lastIndexOf('/') + 1);

        win.document.open();
        win.document.write(`<base href="${baseDir}">${html}`);
        win.document.close();
      } catch (err) {
        // Ultimate fallback
        const iframe = win.document.createElement('iframe');
        iframe.style.cssText = "width:100%;height:100%;border:none;position:fixed;top:0;left:0;";
        iframe.src = gameUrl;
        win.document.body.appendChild(iframe);
      }

      // Cleanup local view
      const localIframe = document.getElementById("game-iframe");
      const container = document.querySelector(".iframe-container");
      
      try {
          const localDoc = localIframe.contentWindow.document;
          localDoc.open(); localDoc.write(""); localDoc.close();
      } catch(e) {}
      
      localIframe.src = "";
      localIframe.style.display = "none";
      
      let messageEl = document.getElementById("cloaked-message");
      if (!messageEl) {
        messageEl = document.createElement("div");
        messageEl.id = "cloaked-message";
        messageEl.style.cssText = "display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 20px; font-size: 14px; color: #000080; font-weight: bold; letter-spacing: 0.5px;";
        container.appendChild(messageEl);
      }
      messageEl.style.display = "flex";
      messageEl.textContent = "Game opened in new tab (cloaked).";
    }
  };

  window.credits = async function() {
    const game = window.__CURRENT_GAME__;
    if (!game) return;

    if (typeof switchTab === 'function') switchTab('games', null);

    const contentEl = document.getElementById('game-credits-content');
    
    if (game.type === 'webPorts') {
      try {
        const creditsMapping = window.__CREDITS_MAPPING__ || {};
        const creditsFolder = creditsMapping[game.slug];
        
        if (!creditsFolder) {
          showDefaultCredits(contentEl);
        } else {
          const creditsUrl = `credits/ports/${creditsFolder}/credits.txt`;
          const response = await fetch(creditsUrl);
          if (response.ok) {
            const text = await response.text();
            contentEl.innerHTML = text.split('\n').map(line => 
              line.trim() ? `<p style="margin:4px 0;">${escHtml(line)}</p>` : '<br>'
            ).join('');
          } else {
            showDefaultCredits(contentEl);
          }
        }
      } catch (err) {
        showDefaultCredits(contentEl);
      }
    } else {
      showDefaultCredits(contentEl);
    }
    document.getElementById('game-credits-modal').style.display = 'flex';
  };

  function showDefaultCredits(contentEl) {
    contentEl.innerHTML = `
      <p><strong>Game Sources:</strong></p>
      <p>3kh0<br>Armor Games<br>Kongregate<br>Radon Games<br>National Porting Association<br>wasm.com</p>
    `;
  }

  window.closeCreditsModal = function() {
    document.getElementById('game-credits-modal').style.display = 'none';
  };

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
