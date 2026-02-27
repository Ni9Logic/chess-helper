const API_URL = "https://chess-helper-phi.vercel.app/api/analyze";

const defaultConfig = {
  enabled: true,
  autoAnalyze: true,
  showEvalBadge: true,
  showTopArrows: false,
  topArrows: 1,
  depth: 12,
  multipv: 3,
  showBlunderArrow: false,
  skillLevel: 20,
};

const loadConfig = async () => {
  const stored = await chrome.storage.local.get("trainerConfig");
  return { ...defaultConfig, ...(stored.trainerConfig || {}) };
};

const saveConfig = async (config) => {
  await chrome.storage.local.set({ trainerConfig: config });
  return config;
};

const pushConfigToTab = async (config, tabId) => {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "config", config });
  } catch {
    // ignore (tab may not have content script yet)
  }
};

chrome.runtime.onInstalled.addListener(async () => {
  await saveConfig(defaultConfig);
});

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
    const merged = { ...defaultConfig, ...(msg.config || {}) };
    saveConfig(merged).then(() => {
      if (sender.tab?.id) pushConfigToTab(merged, sender.tab.id);
      sendResponse({ ok: true, config: merged });
    });
    return true;
  }
});

const handleFen = async (fen, tabId) => {
  const config = await loadConfig();
  if (!config.enabled || !config.autoAnalyze) return;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fen,
        tabId,
        source: "extension",
        depth: config.depth,
        multipv: config.multipv,
        skillLevel: config.skillLevel,
      }),
    });
    const data = await res.json();
    if (data?.type === "analysis" && tabId) {
      chrome.tabs.sendMessage(tabId, { ...data, config });
    }
    chrome.action.setBadgeText({ text: config.enabled ? "ON" : "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
  } catch (err) {
    console.error("analyze error", err);
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  }
};
