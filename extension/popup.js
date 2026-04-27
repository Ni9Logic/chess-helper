// ---------------------------------------------------------------------------
// Popup Script — Tabbed UI with settings, stats dashboard, and shortcuts
// ---------------------------------------------------------------------------

const FIELDS = [
  "enabled", "autoAnalyze", "showEvalBadge", "showTopArrows", "showPvLine",
  "arrowAnimation", "showThreatArrow", "showWdlBar", "showOpeningName",
  "showMoveClassification", "timeTroubleAlert", "endgameTablebase",
  "opponentProfiler", "moveComparison", "comparisonOnly", "moveExplanations", "puzzleMode", "patternRecognition",
  "postGameSummary", "blunderSound", "pauseOnPremove", "keyboardShortcuts",
  "positionBookmarks", "darkTheme", "stealthMode", "enableLichess",
];

const $ = (id) => document.getElementById(id);

// ── Tab switching ─────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "stats") loadStats();
  });
});

// ── Config load/save ──────────────────────────────────────────────────

const buildConfig = () => {
  const config = {};
  for (const f of FIELDS) {
    const el = $(f);
    if (!el) continue;
    config[f] = el.type === "checkbox" ? el.checked : el.value;
  }
  const depth = $("depth");
  if (depth) config.depth = Number(depth.value);
  const multipv = $("multipv");
  if (multipv) config.multipv = Number(multipv.value);
  const dotSize = $("stealthDotSize");
  if (dotSize) config.stealthDotSize = Number(dotSize.value);
  const dotOpacity = $("stealthDotOpacity");
  if (dotOpacity) config.stealthDotOpacity = Number(dotOpacity.value);
  const searchTime = $("searchTime");
  if (searchTime) config.searchTime = Number(searchTime.value);
  const searchMode = $("searchMode");
  if (searchMode) config.searchMode = searchMode.value;
  return config;
};

const applyConfig = (config) => {
  for (const f of FIELDS) {
    const el = $(f);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!config[f];
    else if (el.tagName === "SELECT") el.value = String(config[f] ?? "");
  }
  const depth = $("depth");
  if (depth && config.depth) {
    depth.value = config.depth;
    $("depthVal").textContent = config.depth;
  }
  const multipv = $("multipv");
  if (multipv && config.multipv) multipv.value = String(config.multipv);
  const dotSize = $("stealthDotSize");
  if (dotSize && config.stealthDotSize != null) {
    dotSize.value = config.stealthDotSize;
    $("dotSizeVal").textContent = config.stealthDotSize;
  }
  const dotOpacity = $("stealthDotOpacity");
  if (dotOpacity && config.stealthDotOpacity != null) {
    dotOpacity.value = config.stealthDotOpacity;
    $("dotOpacityVal").textContent = config.stealthDotOpacity;
  }
  const searchTime = $("searchTime");
  if (searchTime && config.searchTime != null) {
    searchTime.value = config.searchTime;
    $("searchTimeVal").textContent = config.searchTime;
  }
  const searchMode = $("searchMode");
  if (searchMode && config.searchMode) searchMode.value = config.searchMode;

  // Theme
  document.body.classList.toggle("light", !config.darkTheme);
};

const saveConfig = () => {
  const config = buildConfig();
  chrome.runtime.sendMessage({ type: "saveConfig", config });
};

let saveTimeout;
const debouncedSave = () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveConfig, 300);
};

// ── Event listeners ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
    if (resp?.config) applyConfig({ ...globalThis.defaultConfig, ...resp.config });
  });

  // Auto-save on all inputs
  document.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("change", () => {
      if (el.id === "depth") $("depthVal").textContent = el.value;
      if (el.id === "darkTheme") document.body.classList.toggle("light", !el.checked);
      debouncedSave();
    });
    if (el.type === "range") {
      const labelMap = { depth: "depthVal", stealthDotSize: "dotSizeVal", stealthDotOpacity: "dotOpacityVal", searchTime: "searchTimeVal" };
      el.addEventListener("input", () => { const lbl = labelMap[el.id]; if (lbl) $(lbl).textContent = el.value; debouncedSave(); });
    }
  });
});

// ── PGN export ────────────────────────────────────────────────────────

$("exportPgn")?.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: "getPgnData" }, (resp) => {
      const data = resp?.data;
      if (!data?.fenHistory?.length) { alert("No game data available"); return; }
      const lines = ["[Event \"Live Game\"]", `[Site \"${data.site || "?"}\"]`, `[Date \"${new Date().toISOString().split("T")[0]}\"]`, ""];
      if (data.moveList) lines.push(data.moveList);
      else lines.push(data.fenHistory.join("\n"));
      const blob = new Blob([lines.join("\n")], { type: "application/x-chess-pgn" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `game-${Date.now()}.pgn`; a.click();
      URL.revokeObjectURL(url);
    });
  });
});

// ── Copy FEN ──────────────────────────────────────────────────────────

$("copyFen")?.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: "copyFen" }, () => {
      const btn = $("copyFen");
      btn.textContent = "✅ Copied!";
      setTimeout(() => { btn.textContent = "📋 Copy FEN"; }, 1500);
    });
  });
});

// ── Stats Dashboard ───────────────────────────────────────────────────

const loadStats = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "getStats" }, (resp) => {
      renderStats(resp?.stats);
    });
    chrome.tabs.sendMessage(tabs[0].id, { type: "getBookmarks" }, (resp) => {
      renderBookmarks(resp?.bookmarks);
    });
  });
};

const renderStats = (stats) => {
  const el = $("statsContent");
  if (!stats) {
    el.innerHTML = '<p class="muted">No games recorded yet. Play a game with the extension active!</p>';
    return;
  }
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-val">${stats.avgAccuracy}%</div>
        <div class="stat-label">Avg Accuracy (10g)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.avgCpl}</div>
        <div class="stat-label">Avg CPL (10g)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.gamesPlayed}</div>
        <div class="stat-label">Games Played</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.totalBrilliancies}</div>
        <div class="stat-label">Brilliancies (10g)</div>
      </div>
    </div>
    <div class="section-label">Top Openings</div>
    <div class="opening-list">
      ${stats.topOpenings.map(o => `<div><span>${o.name}</span><span>${o.count}× · ${o.avgAccuracy}%</span></div>`).join("")}
    </div>
  `;
};

const renderBookmarks = (bookmarks) => {
  const el = $("bookmarksList");
  if (!bookmarks?.length) { el.innerHTML = '<span class="muted">No bookmarks yet</span>'; return; }
  el.innerHTML = bookmarks.slice(-10).reverse().map(b =>
    `<div class="bm-item"><span class="bm-fen">${b.fen.split(" ")[0]}</span><span class="muted">${new Date(b.date).toLocaleDateString()}</span></div>`
  ).join("");
};
