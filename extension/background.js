importScripts("config.js");

// ---------------------------------------------------------------------------
// Background Service Worker
// Creates an offscreen document to run Stockfish locally via WASM.
// No external server required!
// ---------------------------------------------------------------------------

let offscreenReady = false;
let pendingRequests = {};

const ensureOffscreen = async () => {
  if (offscreenReady) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run Stockfish WASM engine in a Web Worker",
    });
    offscreenReady = true;
  } catch (e) {
    // Document might already exist (e.g., after service worker restart)
    if (e.message?.includes("already exists")) {
      offscreenReady = true;
    } else {
      console.error("Failed to create offscreen document:", e);
    }
  }
};

const loadConfig = async () => {
  const stored = await chrome.storage.local.get("trainerConfig");
  return { ...globalThis.defaultConfig, ...(stored.trainerConfig || {}) };
};

const saveConfig = async (config) => {
  await chrome.storage.local.set({ trainerConfig: config });
  return config;
};

const pushConfigToTab = async (config, tabId) => {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "config", config });
  } catch { /* tab may not have content script yet */ }
};

// Push config to all chess tabs on storage change
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.trainerConfig) return;
  const config = changes.trainerConfig.newValue;
  if (!config) return;
  chrome.tabs.query({ url: ["https://www.chess.com/*", "https://lichess.org/*"] }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) pushConfigToTab(config, tab.id);
    }
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  await saveConfig(globalThis.defaultConfig);
  await ensureOffscreen();

  // Context menus
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ct-copy-fen", title: "Copy FEN", contexts: ["page"], documentUrlPatterns: ["https://www.chess.com/*", "https://lichess.org/*"] });
    chrome.contextMenus.create({ id: "ct-bookmark", title: "📌 Bookmark Position", contexts: ["page"], documentUrlPatterns: ["https://www.chess.com/*", "https://lichess.org/*"] });
    chrome.contextMenus.create({ id: "ct-screenshot", title: "📸 Screenshot Arrows", contexts: ["page"], documentUrlPatterns: ["https://www.chess.com/*", "https://lichess.org/*"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const actionMap = { "ct-copy-fen": "copyFen", "ct-bookmark": "bookmark", "ct-screenshot": "screenshot" };
  const action = actionMap[info.menuItemId];
  if (action) chrome.tabs.sendMessage(tab.id, { type: "contextAction", action });
});

// Handle messages from content scripts and offscreen document
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "fen") {
    handleFen(msg.fen, sender?.tab?.id);
    return;
  }
  if (msg?.type === "getConfig") {
    loadConfig().then((config) => sendResponse({ config }));
    return true;
  }
  if (msg?.type === "saveConfig") {
    const merged = { ...globalThis.defaultConfig, ...(msg.config || {}) };
    saveConfig(merged).then(() => {
      if (sender.tab?.id) pushConfigToTab(merged, sender.tab.id);
      sendResponse({ ok: true, config: merged });
    });
    return true;
  }
  // Engine result from offscreen document (partial or final)
  if (msg?.type === "engineResult") {
    const { id, bestMoves, aborted, partial, currentDepth, targetDepth } = msg;

    // Progressive (partial) results: forward immediately to the tab
    if (partial && id === latestRequestId && latestTabId && bestMoves?.length) {
      const payload = {
        type: "analysis",
        source: "local",
        fen: latestFen,
        generatedAt: Date.now(),
        id,
        bestMoves,
        partial: true,
        currentDepth,
        targetDepth,
      };
      loadConfig().then(config => {
        chrome.tabs.sendMessage(latestTabId, { ...payload, config });
      });
      return;
    }

    // Final result
    const pending = pendingRequests[id];
    if (pending && !aborted) {
      delete pendingRequests[id];
      pending.resolve({ bestMoves });
    } else if (pending && aborted) {
      delete pendingRequests[id];
      // Send best-so-far even on abort instead of empty
      pending.resolve({ bestMoves: bestMoves?.length ? bestMoves : [] });
    }
    return;
  }
});

let latestRequestId = null;
let latestTabId = null;
let latestFen = null;
let lastFenTime = 0;

// ── Position Cache (LRU, 30 entries) ──────────────────────────────────

const CACHE_MAX = 30;
const positionCache = new Map(); // key: "fen|depth|multipv" → { bestMoves, timestamp }

const cacheKey = (fen, depth, multipv) => `${fen.split(" ").slice(0, 4).join(" ")}|${depth}|${multipv}`;

const cacheGet = (fen, depth, multipv) => {
  // Check for exact or higher-depth match
  for (let d = 20; d >= depth; d--) {
    const key = cacheKey(fen, d, multipv);
    if (positionCache.has(key)) {
      const entry = positionCache.get(key);
      // LRU: move to end
      positionCache.delete(key);
      positionCache.set(key, entry);
      return entry;
    }
  }
  return null;
};

const cacheSet = (fen, depth, multipv, bestMoves) => {
  const key = cacheKey(fen, depth, multipv);
  positionCache.set(key, { bestMoves, timestamp: Date.now() });
  // Evict oldest if over limit
  if (positionCache.size > CACHE_MAX) {
    const oldest = positionCache.keys().next().value;
    positionCache.delete(oldest);
  }
};

// ── Smart Depth Scaling ───────────────────────────────────────────────

const smartDepth = (fen, configuredDepth) => {
  const parts = fen.split(" ");
  const board = parts[0] || "";
  const moveNum = parseInt(parts[5] || "1", 10);
  const pieceCount = (board.match(/[pnbrqkPNBRQK]/g) || []).length;

  // Endgame: fewer pieces = faster search, keep configured depth
  if (pieceCount <= 10) return configuredDepth;

  // Early opening (moves 1-6): book territory, cap at 10
  if (moveNum <= 6 && configuredDepth > 10) return 10;

  // Early middlegame (moves 7-12): cap at configured - 2
  if (moveNum <= 12 && configuredDepth > 14) return configuredDepth - 2;

  return configuredDepth;
};

// ── Analysis Handler ──────────────────────────────────────────────────

const handleFen = async (fen, tabId) => {
  const config = await loadConfig();
  if (!config.enabled || !config.autoAnalyze) return;

  const effectiveDepth = smartDepth(fen, config.depth);
  const isTimeMode = config.searchMode === "time";

  // Rapid-move debounce: skip if last request was < 400ms ago (unless cached)
  const now = Date.now();
  if (lastFenTime && now - lastFenTime < 400) {
    const cached = cacheGet(fen, effectiveDepth, config.multipv);
    if (cached) {
      const payload = { type: "analysis", source: "cache", fen, generatedAt: now, bestMoves: cached.bestMoves };
      if (tabId) chrome.tabs.sendMessage(tabId, { ...payload, config });
      return;
    }
    // Too fast, skip this position
    return;
  }
  lastFenTime = now;

  // Check cache first — instant result if available
  const cached = cacheGet(fen, effectiveDepth, config.multipv);
  if (cached) {
    const payload = {
      type: "analysis",
      source: "cache",
      fen,
      generatedAt: Date.now(),
      bestMoves: cached.bestMoves,
    };
    if (tabId) chrome.tabs.sendMessage(tabId, { ...payload, config });
    chrome.action.setBadgeText({ text: "⚡" });
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    return;
  }

  await ensureOffscreen();

  const id = crypto.randomUUID();
  latestRequestId = id;
  latestTabId = tabId;
  latestFen = fen;

  try {
    const resultPromise = new Promise((resolve, reject) => {
      pendingRequests[id] = { resolve, reject };
      const timeout = isTimeMode
        ? (config.searchTime || 3000) + 8000
        : Math.min(130000, Math.max(25000, effectiveDepth * 3500));
      setTimeout(() => {
        if (pendingRequests[id]) {
          delete pendingRequests[id];
          reject(new Error("timeout"));
        }
      }, timeout);
    });

    chrome.runtime.sendMessage({
      type: "engineAnalyze",
      id,
      fen,
      depth: effectiveDepth,
      multipv: config.multipv,
      skillLevel: config.skillLevel,
      searchMode: config.searchMode || "depth",
      searchTime: config.searchTime || 3000,
    });

    const result = await resultPromise;

    // Discard stale results
    if (id !== latestRequestId) return;

    if (result.bestMoves?.length) {
      // Store in cache
      cacheSet(fen, effectiveDepth, config.multipv, result.bestMoves);

      if (tabId) {
        const payload = {
          type: "analysis",
          source: "local",
          fen,
          generatedAt: Date.now(),
          id,
          bestMoves: result.bestMoves,
        };
        chrome.tabs.sendMessage(tabId, { ...payload, config });
      }
    }

    chrome.action.setBadgeText({ text: config.enabled ? "ON" : "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
  } catch (err) {
    console.error("analyze error", err);
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  }
};

// Keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  const config = await loadConfig();
  if (command === "toggle-enabled") {
    config.enabled = !config.enabled;
  } else if (command === "toggle-eval") {
    config.showEvalBadge = !config.showEvalBadge;
  }
  await saveConfig(config);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const tab of tabs) {
    if (tab.id) pushConfigToTab(config, tab.id);
  }
});
