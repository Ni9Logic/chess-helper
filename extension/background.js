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
  // Engine result from offscreen document
  if (msg?.type === "engineResult") {
    const { id, bestMoves, aborted } = msg;
    const pending = pendingRequests[id];
    if (pending && !aborted) {
      delete pendingRequests[id];
      pending.resolve({ bestMoves });
    } else if (pending && aborted) {
      delete pendingRequests[id];
      pending.resolve({ bestMoves: [] });
    }
    return;
  }
});

let latestRequestId = null;

const handleFen = async (fen, tabId) => {
  const config = await loadConfig();
  if (!config.enabled || !config.autoAnalyze) return;

  await ensureOffscreen();

  const id = crypto.randomUUID();
  latestRequestId = id;

  try {
    // Send analysis request to offscreen document
    const resultPromise = new Promise((resolve, reject) => {
      pendingRequests[id] = { resolve, reject };
      // Timeout safety
      setTimeout(() => {
        if (pendingRequests[id]) {
          delete pendingRequests[id];
          reject(new Error("timeout"));
        }
      }, 30000);
    });

    chrome.runtime.sendMessage({
      type: "engineAnalyze",
      id,
      fen,
      depth: config.depth,
      multipv: config.multipv,
      skillLevel: config.skillLevel,
    });

    const result = await resultPromise;

    // Discard stale results
    if (id !== latestRequestId) return;

    if (result.bestMoves?.length && tabId) {
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
