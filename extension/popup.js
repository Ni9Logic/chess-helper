const fields = [
  "enabled",
  "autoAnalyze",
  "showEvalBadge",
  "showTopArrows",
  "showBlunderArrow",
  "topArrows",
  "depth",
  "multipv",
  "skillLevel",
];

const setStatus = (state) => {
  const dot = document.getElementById("status-dot");
  dot.className = "dot " + (state === "ok" ? "green" : state === "err" ? "red" : "gray");
};

const load = () => {
  chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
    const cfg = resp?.config;
    if (!cfg) {
      setStatus("err");
      return;
    }
    fields.forEach((f) => {
      const el = document.getElementById(f);
      if (!el) return;
      if (el.type === "checkbox") el.checked = Boolean(cfg[f]);
      else el.value = cfg[f];
    });
    syncLabels();
    setStatus(cfg.enabled ? "ok" : "gray");
  });
};

const syncLabels = () => {
  document.getElementById("topArrowsLabel").textContent = `${document.getElementById("topArrows").value} arrows`;
  document.getElementById("depthLabel").textContent = `Depth ${document.getElementById("depth").value}`;
  document.getElementById("multipvLabel").textContent = `Lines ${document.getElementById("multipv").value}`;
  document.getElementById("skillLabel").textContent = `Skill ${document.getElementById("skillLevel").value} / 20`;
};

document.addEventListener("DOMContentLoaded", () => {
  load();
  ["topArrows", "depth", "multipv", "skillLevel"].forEach((id) => {
    document.getElementById(id).addEventListener("input", syncLabels);
  });

  document.getElementById("save").addEventListener("click", () => {
    const cfg = {};
    fields.forEach((f) => {
      const el = document.getElementById(f);
      if (!el) return;
      cfg[f] = el.type === "checkbox" ? el.checked : Number(el.value);
    });
    chrome.runtime.sendMessage({ type: "saveConfig", config: cfg }, (resp) => {
      if (resp?.ok) setStatus(cfg.enabled ? "ok" : "gray");
      else setStatus("err");
    });
  });
});
