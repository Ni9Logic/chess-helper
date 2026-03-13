// Shared default configuration for the Chess Trainer extension.
// Imported by background.js, content.js, and popup.js to avoid drift.

const defaultConfig = {
    // Core
    enabled: true,
    autoAnalyze: true,
    depth: 12,
    multipv: 3,
    skillLevel: 12,
    orientation: "auto",
    playerSide: "auto",

    // Overlays
    showEvalBadge: true,
    showTopArrows: true,
    topArrows: 3,
    showBlunderArrow: false,
    showThreatArrow: false,
    showWdlBar: false,
    showOpeningName: true,
    showMoveClassification: true,

    // Alerts
    blunderSound: true,

    // Behaviour
    pauseOnPremove: true,
    keyboardShortcuts: true,

    // Appearance
    darkTheme: true,

    // Multi-site
    enableLichess: true,
};

if (typeof globalThis !== "undefined") {
    globalThis.defaultConfig = defaultConfig;
}
