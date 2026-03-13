const fields = [
  "enabled", "autoAnalyze",
  "showEvalBadge", "showTopArrows", "showBlunderArrow", "showThreatArrow",
  "showWdlBar", "showOpeningName", "showMoveClassification",
  "blunderSound", "keyboardShortcuts", "pauseOnPremove", "enableLichess",
  "topArrows", "depth", "multipv", "skillLevel",
  "orientation", "playerSide",
  "darkTheme",
];

const checkboxFields = [
  "enabled", "autoAnalyze",
  "showEvalBadge", "showTopArrows", "showBlunderArrow", "showThreatArrow",
  "showWdlBar", "showOpeningName", "showMoveClassification",
  "blunderSound", "keyboardShortcuts", "pauseOnPremove", "enableLichess",
  "darkTheme",
];

const sliderFields = ["topArrows", "depth", "multipv", "skillLevel"];
const selectFields = ["orientation", "playerSide"];

const setStatus = (state, message = "") => {
  const dot = document.getElementById("status-dot");
  dot.className = "dot " + (state === "ok" ? "green" : state === "err" ? "red" : "gray");
  const statusMsg = document.getElementById("status-msg");
  if (statusMsg) statusMsg.textContent = message;
};

const buildConfig = () => {
  const cfg = {};
  fields.forEach((f) => {
    const el = document.getElementById(f);
    if (!el) return;
    if (el.type === "checkbox") cfg[f] = el.checked;
    else if (el.tagName === "SELECT") cfg[f] = el.value;
    else cfg[f] = Number(el.value);
  });
  return cfg;
};

const applyTheme = (dark) => {
  document.body.classList.toggle("light-theme", !dark);
};

const load = () => {
  chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
    const cfg = resp?.config;
    if (!cfg) {
      setStatus("err", "Cannot reach background");
      return;
    }
    fields.forEach((f) => {
      const el = document.getElementById(f);
      if (!el) return;
      if (el.type === "checkbox") el.checked = Boolean(cfg[f]);
      else el.value = cfg[f];
    });
    syncLabels();
    applyTheme(cfg.darkTheme !== false);
    setStatus(cfg.enabled ? "ok" : "gray");
  });
};

const syncLabels = () => {
  document.getElementById("topArrowsLabel").textContent = `${document.getElementById("topArrows").value} arrows`;
  document.getElementById("depthLabel").textContent = `Depth ${document.getElementById("depth").value}`;
  document.getElementById("multipvLabel").textContent = `Lines ${document.getElementById("multipv").value}`;
  document.getElementById("skillLabel").textContent = `Skill ${document.getElementById("skillLevel").value} / 20`;
};

// Debounced auto-save
let saveTimer = null;
const debouncedSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cfg = buildConfig();
    chrome.runtime.sendMessage({ type: "saveConfig", config: cfg }, (resp) => {
      if (resp?.ok) setStatus(cfg.enabled ? "ok" : "gray", "Saved");
      else setStatus("err", "Save failed");
    });
  }, 400);
};

// PGN export
const exportPgn = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "getPgnData" }, (resp) => {
      const data = resp?.data;
      if (!data || !data.fenHistory?.length) {
        setStatus("err", "No game data");
        return;
      }

      let pgn = "";
      pgn += `[Event "Chess Trainer Analysis"]\n`;
      pgn += `[Site "${location.href}"]\n`;
      pgn += `[Date "${new Date(data.startedAt).toISOString().slice(0, 10)}"]\n`;
      if (data.openingName) pgn += `[Opening "${data.openingName}"]\n`;
      pgn += `[Annotator "Chess Trainer Extension"]\n\n`;

      // Build simplified PGN from FEN history with eval comments
      const moveTexts = [];
      for (let i = 1; i < data.fenHistory.length; i++) {
        const moveNum = Math.ceil(i / 2);
        const isWhite = i % 2 === 1;
        const prefix = isWhite ? `${moveNum}. ` : "";

        let moveText = `${prefix}...`; // placeholder since we don't have SAN
        const evalInfo = data.evalHistory[i];
        const classify = data.classifications[i - 1];

        if (evalInfo?.score) {
          moveText += ` {${evalInfo.score}`;
          if (classify) moveText += ` [${classify}]`;
          moveText += "}";
        }
        moveTexts.push(moveText);
      }
      pgn += moveTexts.join(" ") + " *\n";

      // Add FEN history as comments
      pgn += `\n{ FEN History: ${data.fenHistory.length} positions }\n`;

      // Download
      const blob = new Blob([pgn], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chess-trainer-${Date.now()}.pgn`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("ok", "PGN exported");
    });
  });
};

document.addEventListener("DOMContentLoaded", () => {
  load();

  // Slider labels
  sliderFields.forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      syncLabels();
      debouncedSave();
    });
  });

  // Checkbox auto-save
  checkboxFields.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if (id === "darkTheme") applyTheme(el.checked);
      debouncedSave();
    });
  });

  // Select auto-save
  selectFields.forEach((id) => {
    document.getElementById(id).addEventListener("change", debouncedSave);
  });

  // Manual save
  document.getElementById("save").addEventListener("click", () => {
    if (saveTimer) clearTimeout(saveTimer);
    const cfg = buildConfig();
    chrome.runtime.sendMessage({ type: "saveConfig", config: cfg }, (resp) => {
      if (resp?.ok) setStatus(cfg.enabled ? "ok" : "gray", "Saved ✓");
      else setStatus("err", "Save failed");
    });
  });

  // PGN export
  document.getElementById("exportPgn").addEventListener("click", exportPgn);
});
