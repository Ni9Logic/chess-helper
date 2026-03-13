// ---------------------------------------------------------------------------
// Chess Trainer — Content Script
// Reads chess board from chess.com or lichess.org, sends FEN for analysis,
// and renders arrows, eval badge, WDL bar, opening name, and move
// classification badges on the board.
// ---------------------------------------------------------------------------

const THROTTLE_MS = 500;
const IS_LICHESS = location.hostname.includes("lichess");

// Guard: returns false after extension reload so old intervals self-destruct
let pollingId = null;
const isContextValid = () => {
  try { return !!chrome.runtime?.id; } catch { return false; }
};

let lastSent = 0;
let lastFen = "";
let boardOverlay = null;
let evalBadge = null;
let wdlBar = null;
let openingPill = null;
let classificationBadge = null;
let currentConfig = { ...globalThis.defaultConfig };
let openingsDb = null;
let blunderAudio = null;
let lastAnalysisPayload = null;

// ── chess.com helpers (Lichess uses lichess.js) ───────────────────────────

const readColor = (el) => {
  if (!el) return null;
  const cls = el.className || "";
  if (cls.match(/black/)) return "black";
  if (cls.match(/white/)) return "white";
  const dataColor = el.getAttribute?.("data-color");
  if (dataColor === "black" || dataColor === "white") return dataColor;
  const iconBlack = el.querySelector?.(".icon-black, .board-clock-black, .clock-icon-black");
  const iconWhite = el.querySelector?.(".icon-white, .board-clock-white, .clock-icon-white");
  if (iconBlack) return "black";
  if (iconWhite) return "white";
  return null;
};

const isClockRunning = (el) => {
  if (!el) return false;
  const cls = el.className || "";
  if (cls.match(/clock-player-turn|player-clock--active|running|active/)) return true;
  const dataState = el.getAttribute?.("data-state") || "";
  return /running|active/i.test(dataState);
};

const pieceMap = {
  wp: "P", wn: "N", wb: "B", wr: "R", wq: "Q", wk: "K",
  bp: "p", bn: "n", bb: "b", br: "r", bq: "q", bk: "k",
};
const PIECE_REGEX = /\b(wp|wn|wb|wr|wq|wk|bp|bn|bb|br|bq|bk)\b/;

const squareToIndex = (sq) => {
  const match = sq.match(/square-(\d)(\d)/);
  if (!match) return null;
  return (8 - Number(match[2])) * 8 + (Number(match[1]) - 1);
};

const findBoard = () =>
  IS_LICHESS
    ? globalThis.lichessHelpers?.findBoard()
    : document.querySelector('[data-board-id], .board, .chess-board');

// ── Orientation detection ─────────────────────────────────────────────────

const detectFlipFromLayout = () => {
  const bottomClock =
    document.querySelector('[data-cy="clock-player-bottom"], .clock-player-bottom, .clock-player-bottom-component') ||
    document.querySelector('.board-player-bottom, .player-bottom');
  const topClock =
    document.querySelector('[data-cy="clock-player-top"], .clock-player-top, .clock-player-top-component') ||
    document.querySelector('.board-player-top, .player-top');
  const bottom = readColor(bottomClock);
  const top = readColor(topClock);
  if (bottom === "black" || top === "white") return true;
  if (bottom === "white" || top === "black") return false;
  return null;
};

function getBoardRotationDeg() {
  const board = findBoard();
  if (!board) return 0;
  let node = board;
  for (let i = 0; i < 3 && node; i += 1) {
    const computed = window.getComputedStyle(node);
    const transform = computed?.transform || "";
    if (transform && transform !== "none") {
      const rotateMatch = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
      if (rotateMatch) return (Number(rotateMatch[1]) + 360) % 360;
      const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
      if (matrixMatch) {
        const values = matrixMatch[1].split(",").map((v) => Number(v.trim()));
        if (values.length >= 4) {
          const [a, b] = values;
          return (Math.round(Math.atan2(b, a) * (180 / Math.PI)) + 360) % 360;
        }
      }
    }
    node = node.parentElement;
  }
  return 0;
}

const detectFlipFromSquares = () => {
  const board = findBoard();
  if (!board) return false;
  const pieces = board.querySelectorAll('[class*="square-"]');
  if (!pieces.length) return false;
  const boardRect = board.getBoundingClientRect();
  let errWhite = 0, errBlack = 0, samples = 0;
  pieces.forEach((el) => {
    const match = el.className.match(/square-(\d)(\d)/);
    if (!match) return;
    const file = Number(match[1]) - 1;
    const rank = Number(match[2]);
    const row = 8 - rank, col = file;
    const rect = el.getBoundingClientRect();
    const rx = (rect.left + rect.width / 2 - boardRect.left) / boardRect.width;
    const ry = (rect.top + rect.height / 2 - boardRect.top) / boardRect.height;
    errWhite += (rx - (col + 0.5) / 8) ** 2 + (ry - (row + 0.5) / 8) ** 2;
    errBlack += (rx - (7 - col + 0.5) / 8) ** 2 + (ry - (7 - row + 0.5) / 8) ** 2;
    samples += 1;
  });
  if (samples === 0) return false;
  return errBlack * 0.98 < errWhite;
};

const isFlipped = () => {
  if (IS_LICHESS) return globalThis.lichessHelpers?.isFlipped() ?? false;
  const pref = (currentConfig.orientation || "auto").toLowerCase();
  if (pref === "white") return false;
  if (pref === "black") return true;
  const layoutGuess = detectFlipFromLayout();
  if (layoutGuess !== null) return layoutGuess;
  const board = findBoard();
  if (!board) return false;
  const cls = board.className || "";
  const style = board.getAttribute("style") || "";
  const orientationFlag = cls.includes("flipped") || cls.includes("orientation-black") || style.includes("rotate(180deg)");
  const rotation = getBoardRotationDeg();
  if (Math.abs(rotation - 180) < 30) return false;
  if (orientationFlag) return true;
  return detectFlipFromSquares();
};

// ── Turn-aware analysis ───────────────────────────────────────────────────

const detectWhoseTurnByClocks = () => {
  const bottomClock = document.querySelector(
    '[data-cy="clock-player-bottom"], .clock-player-bottom, .clock-player-bottom-component, .board-player-bottom, .player-bottom'
  );
  const topClock = document.querySelector(
    '[data-cy="clock-player-top"], .clock-player-top, .clock-player-top-component, .board-player-top, .player-top'
  );
  const bottomRunning = isClockRunning(bottomClock);
  const topRunning = isClockRunning(topClock);
  if (!bottomRunning && !topRunning) return null;
  // Bottom is the user's clock
  if (bottomRunning) return "user";  // user's clock running = user needs to move
  if (topRunning) return "opponent"; // opponent thinking
  return null;
};

// ── FEN reading ───────────────────────────────────────────────────────────

const readFen = () => {
  if (IS_LICHESS) return globalThis.lichessHelpers?.readFen() ?? null;

  const boardEl = findBoard();
  if (!boardEl) return null;
  const pieceEls = boardEl.querySelectorAll(".piece");
  const board = Array(64).fill(null);
  pieceEls.forEach((el) => {
    const cls = el.className;
    const pieceMatch = cls.match(PIECE_REGEX);
    const squareMatch = cls.match(/square-\d{2}/);
    if (!pieceMatch || !squareMatch) return;
    const idx = squareToIndex(squareMatch[0]);
    if (idx === null) return;
    board[idx] = pieceMap[pieceMatch[1]];
  });

  const fenRows = [];
  for (let r = 0; r < 8; r += 1) {
    let row = "", empty = 0;
    for (let c = 0; c < 8; c += 1) {
      const piece = board[r * 8 + c];
      if (!piece) { empty += 1; } else {
        if (empty > 0) { row += empty; empty = 0; }
        row += piece;
      }
    }
    if (empty > 0) row += empty;
    fenRows.push(row || "8");
  }

  const playerColor = isFlipped() ? "b" : "w";
  let active = playerColor;
  if (currentConfig.playerSide && currentConfig.playerSide !== "auto") {
    active = currentConfig.playerSide === "black" ? "b" : "w";
  }
  if (!active) active = "w";

  const castling = inferCastlingRights(board);
  return `${fenRows.join("/")} ${active} ${castling} - 0 1`;
};

const inferCastlingRights = (board) => {
  let rights = "";
  if (board[60] === "K") {
    if (board[63] === "R") rights += "K";
    if (board[56] === "R") rights += "Q";
  }
  if (board[4] === "k") {
    if (board[7] === "r") rights += "k";
    if (board[0] === "r") rights += "q";
  }
  return rights || "-";
};

// ── Premove detection ─────────────────────────────────────────────────────

const isPremoveActive = () => {
  if (!currentConfig.pauseOnPremove) return false;
  // chess.com highlights premove squares
  const premoveSquare = document.querySelector(".premove, .square-premove, [class*='premove']");
  return !!premoveSquare;
};

// ── Opening book lookup ───────────────────────────────────────────────────

const loadOpeningsDb = async () => {
  if (openingsDb) return;
  try {
    const url = chrome.runtime.getURL("openings.json");
    const resp = await fetch(url);
    openingsDb = await resp.json();
  } catch { openingsDb = {}; }
};

const lookupOpening = (fen) => {
  if (!openingsDb || !fen) return null;
  const boardPart = fen.split(" ")[0];
  return openingsDb[boardPart] ?? null;
};

// ── Overlay elements ──────────────────────────────────────────────────────

const syncOverlayTransform = (boardEl) => {
  if (!boardOverlay) return;
  const style = window.getComputedStyle(boardEl);
  boardOverlay.style.transform = style.transform || "";
  boardOverlay.style.transformOrigin = style.transformOrigin || "center center";
};

const ensureOverlay = () => {
  const boardEl = findBoard();
  if (!boardEl) return null;
  if (!boardOverlay || !boardOverlay.isConnected) {
    boardOverlay = document.createElement("div");
    boardOverlay.id = "chess-trainer-overlay";
    boardOverlay.innerHTML = '<svg id="chess-trainer-svg" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>';
    boardEl.style.position = "relative";
    boardEl.appendChild(boardOverlay);

    evalBadge = document.createElement("div");
    evalBadge.id = "chess-trainer-eval";
    evalBadge.textContent = "…";
    boardEl.appendChild(evalBadge);

    // WDL bar
    wdlBar = document.createElement("div");
    wdlBar.id = "chess-trainer-wdl";
    wdlBar.innerHTML = '<span class="wdl-w"></span><span class="wdl-d"></span><span class="wdl-l"></span>';
    wdlBar.style.display = "none";
    boardEl.appendChild(wdlBar);

    // Opening name pill
    openingPill = document.createElement("div");
    openingPill.id = "chess-trainer-opening";
    openingPill.style.display = "none";
    boardEl.appendChild(openingPill);

    // Classification badge
    classificationBadge = document.createElement("div");
    classificationBadge.id = "chess-trainer-classification";
    classificationBadge.style.display = "none";
    boardEl.appendChild(classificationBadge);
  }
  syncOverlayTransform(boardEl);
  return boardOverlay;
};

const clearArrows = () => {
  const svg = document.getElementById("chess-trainer-svg");
  if (svg) svg.innerHTML = "";
};

// ── Arrow drawing ─────────────────────────────────────────────────────────

const markerIdForColor = (color) => `arrowhead-${color.replace("#", "")}`;

const drawArrow = (fromSq, toSq, label = "", color = "#10b981", labelOffset = 0, opacity = 0.74) => {
  const svg = document.getElementById("chess-trainer-svg");
  if (!svg) return;
  const squareOk = (sq) => typeof sq === "string" && /^[a-h][1-8]$/i.test(sq);
  if (!squareOk(fromSq) || !squareOk(toSq)) return;
  const normFrom = fromSq.toLowerCase();
  const normTo = toSq.toLowerCase();
  const file = (ch) => ch.charCodeAt(0) - 97;
  const rank = (r) => Number(r) - 1;
  const flipped = isFlipped();
  const fromFile = file(normFrom[0]), fromRank = rank(normFrom[1]);
  const toFile = file(normTo[0]), toRank = rank(normTo[1]);
  if ([fromFile, toFile].some((v) => isNaN(v) || v < 0 || v > 7) ||
    [fromRank, toRank].some((v) => isNaN(v) || v < 0 || v > 7)) return;

  const dispFile = (f) => (flipped ? 7 - f : f);
  const dispRank = (r) => (flipped ? r : 7 - r);
  const x1 = (dispFile(fromFile) + 0.5) * (100 / 8);
  const y1 = (dispRank(fromRank) + 0.5) * (100 / 8);
  const x2 = (dispFile(toFile) + 0.5) * (100 / 8);
  const y2 = (dispRank(toRank) + 0.5) * (100 / 8);

  const markerId = markerIdForColor(color);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "0.9");
  line.setAttribute("stroke-opacity", String(opacity));
  line.setAttribute("marker-end", `url(#${markerId})`);

  const defs = svg.querySelector("defs") || (() => {
    const d = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(d); return d;
  })();
  if (!svg.querySelector(`#${markerId}`)) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("markerWidth", "4"); marker.setAttribute("markerHeight", "4");
    marker.setAttribute("refX", "2"); marker.setAttribute("refY", "2");
    marker.setAttribute("orient", "auto");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", "0 0, 4 2, 0 4");
    poly.setAttribute("fill", color);
    marker.appendChild(poly); defs.appendChild(marker);
  }
  svg.appendChild(line);

  if (label) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = (-dy / len) * labelOffset, py = (dx / len) * labelOffset;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", ((x1 + x2) / 2 + px)); text.setAttribute("y", ((y1 + y2) / 2 - 2 + py));
    text.setAttribute("fill", "#0f172a"); text.setAttribute("font-size", "6");
    text.setAttribute("font-weight", "600"); text.setAttribute("text-anchor", "middle");
    text.textContent = label;
    svg.appendChild(text);
  }
};

// ── WDL Bar rendering ─────────────────────────────────────────────────────

const renderWdlBar = (wdl) => {
  if (!wdlBar || !currentConfig.showWdlBar) {
    if (wdlBar) wdlBar.style.display = "none";
    return;
  }
  if (!wdl) { wdlBar.style.display = "none"; return; }
  wdlBar.style.display = "flex";
  const total = wdl.win + wdl.draw + wdl.loss || 1;
  wdlBar.querySelector(".wdl-w").style.width = `${(wdl.win / total) * 100}%`;
  wdlBar.querySelector(".wdl-d").style.width = `${(wdl.draw / total) * 100}%`;
  wdlBar.querySelector(".wdl-l").style.width = `${(wdl.loss / total) * 100}%`;
};

// ── Opening name rendering ────────────────────────────────────────────────

const renderOpeningName = (fen) => {
  if (!openingPill || !currentConfig.showOpeningName) {
    if (openingPill) openingPill.style.display = "none";
    return;
  }
  const opening = lookupOpening(fen);
  if (opening) {
    openingPill.textContent = `${opening.eco} ${opening.name}`;
    openingPill.style.display = "block";
    // Store on move history
    if (globalThis.moveHistory) globalThis.moveHistory.openingName = opening.name;
  }
};

// ── Classification badge rendering ────────────────────────────────────────

const CLASSIFICATION_DISPLAY = {
  brilliant: { symbol: "!!", color: "#26bfa5", bg: "rgba(38,191,165,0.2)" },
  great: { symbol: "!", color: "#5c9ee6", bg: "rgba(92,158,230,0.2)" },
  good: { symbol: "✓", color: "#97b853", bg: "rgba(151,184,83,0.2)" },
  inaccuracy: { symbol: "?!", color: "#f7c631", bg: "rgba(247,198,49,0.2)" },
  mistake: { symbol: "?", color: "#e68a32", bg: "rgba(230,138,50,0.2)" },
  blunder: { symbol: "??", color: "#ca3431", bg: "rgba(202,52,49,0.2)" },
};

let classificationTimeout = null;
const showClassification = (classification) => {
  if (!classificationBadge || !currentConfig.showMoveClassification) return;
  const display = CLASSIFICATION_DISPLAY[classification];
  if (!display) return;

  classificationBadge.textContent = display.symbol;
  classificationBadge.style.color = display.color;
  classificationBadge.style.background = display.bg;
  classificationBadge.style.borderColor = display.color;
  classificationBadge.style.display = "flex";
  classificationBadge.style.opacity = "1";

  if (classificationTimeout) clearTimeout(classificationTimeout);
  classificationTimeout = setTimeout(() => {
    classificationBadge.style.opacity = "0";
    setTimeout(() => { classificationBadge.style.display = "none"; }, 400);
  }, 2500);
};

// ── Blunder sound ─────────────────────────────────────────────────────────

const playBlunderSound = (classification) => {
  if (!currentConfig.blunderSound) return;
  if (classification !== "blunder" && classification !== "mistake") return;
  try {
    if (!blunderAudio) {
      blunderAudio = new Audio(chrome.runtime.getURL("sounds/blunder.wav"));
      blunderAudio.volume = 0.4;
    }
    blunderAudio.currentTime = 0;
    blunderAudio.play().catch(() => { });
  } catch { /* ignore audio errors */ }
};

// ── Analysis handler ──────────────────────────────────────────────────────

const handleAnalysis = (payload) => {
  if (!currentConfig.enabled) return;
  lastAnalysisPayload = payload;

  // Record eval in move history
  if (globalThis.moveHistory && payload?.fen) {
    globalThis.moveHistory.recordEval(payload.fen, payload);
    // Attempt classification after eval arrives
    const classification = globalThis.moveHistory.classifyLastMove();
    if (classification) {
      showClassification(classification);
      playBlunderSound(classification);
    }
  }

  // Respect player-side filter
  if (currentConfig.playerSide && currentConfig.playerSide !== "auto" && payload?.fen) {
    const active = payload.fen.split(" ")[1];
    if ((active === "w" && currentConfig.playerSide === "black") ||
      (active === "b" && currentConfig.playerSide === "white")) {
      clearArrows();
      if (evalBadge && currentConfig.showEvalBadge) evalBadge.textContent = "⏸";
      renderWdlBar(null);
      return;
    }
  }

  ensureOverlay();
  clearArrows();
  const moves = payload?.bestMoves || [];
  if (!moves.length) {
    if (evalBadge && currentConfig.showEvalBadge) evalBadge.textContent = "–";
    renderWdlBar(null);
    return;
  }

  // Draw best-move arrows
  const maxArrows = currentConfig.showTopArrows ? Math.min(currentConfig.topArrows || 1, moves.length) : 1;
  for (let i = 0; i < maxArrows; i += 1) {
    const mv = moves[i];
    if (!mv?.uci || mv.uci.length < 4) continue;
    const from = mv.uci.slice(0, 2);
    const to = mv.uci.slice(2, 4);
    const label = i === 0 ? mv.score || "" : `#${i + 1}`;
    const offset = (i - (maxArrows - 1) / 2) * 2.2;
    drawArrow(from, to, label, "#10b981", offset);
    if (i === 0 && evalBadge && currentConfig.showEvalBadge) {
      evalBadge.textContent = mv.score || "0.0";
    }
  }

  // Draw threat arrow (opponent's best reply from PV)
  if (currentConfig.showThreatArrow && moves[0]?.pv?.length >= 2) {
    const threatUci = moves[0].pv[1];
    if (threatUci && threatUci.length >= 4) {
      drawArrow(threatUci.slice(0, 2), threatUci.slice(2, 4), "⚠", "#f59e0b", 0, 0.55);
    }
  }

  // Draw blunder arrow
  if (currentConfig.showBlunderArrow && payload?.blunderMove?.uci) {
    const uci = payload.blunderMove.uci;
    if (uci.length >= 4) {
      drawArrow(uci.slice(0, 2), uci.slice(2, 4), "??", "#ef4444");
    }
  }

  // WDL bar
  renderWdlBar(moves[0]?.wdl ?? null);

  // Opening name
  renderOpeningName(payload?.fen);
};

// ── State sending ─────────────────────────────────────────────────────────

const sendState = () => {
  // Self-destruct if extension was reloaded
  if (!isContextValid()) {
    if (pollingId) { clearInterval(pollingId); pollingId = null; }
    return;
  }

  const now = Date.now();
  if (now - lastSent < THROTTLE_MS) return;
  if (isPremoveActive()) return; // pause during premoves

  const fen = readFen();
  if (!fen || fen === lastFen) return;
  lastSent = now;
  lastFen = fen;

  // Record position in move history
  if (globalThis.moveHistory) {
    globalThis.moveHistory.recordPosition(fen);
  }

  try { chrome.runtime.sendMessage({ type: "fen", fen }); } catch { /* context invalidated */ }
};

// ── Config ────────────────────────────────────────────────────────────────

const applyConfig = (config) => {
  currentConfig = { ...currentConfig, ...config };
  if (!currentConfig.enabled) {
    clearArrows();
    if (evalBadge) evalBadge.textContent = "⏸";
    if (wdlBar) wdlBar.style.display = "none";
  }
  if (!currentConfig.showWdlBar && wdlBar) wdlBar.style.display = "none";
  if (!currentConfig.showOpeningName && openingPill) openingPill.style.display = "none";
  if (!currentConfig.showEvalBadge && evalBadge) evalBadge.style.display = "none";
  else if (currentConfig.showEvalBadge && evalBadge) evalBadge.style.display = "";
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────

const handleKeyboard = (e) => {
  if (!currentConfig.keyboardShortcuts) return;
  if (!e.altKey) return;

  if (e.key === "t" || e.key === "T") {
    e.preventDefault();
    currentConfig.enabled = !currentConfig.enabled;
    applyConfig(currentConfig);
    try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch { }
  }
  if (e.key === "e" || e.key === "E") {
    e.preventDefault();
    currentConfig.showEvalBadge = !currentConfig.showEvalBadge;
    applyConfig(currentConfig);
    try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch { }
  }
  if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    // Cycle through arrows: toggle showTopArrows, then increase count
    if (!currentConfig.showTopArrows) {
      currentConfig.showTopArrows = true;
      currentConfig.topArrows = 2;
    } else if (currentConfig.topArrows < 5) {
      currentConfig.topArrows += 1;
    } else {
      currentConfig.showTopArrows = false;
      currentConfig.topArrows = 1;
    }
    applyConfig(currentConfig);
    try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch { }
    // Re-render with current payload
    if (lastAnalysisPayload) handleAnalysis(lastAnalysisPayload);
  }
};

// ── PGN export support (for popup.js messages) ────────────────────────────

const handleMessage = (msg, _sender, sendResponse) => {
  if (msg?.type === "analysis") handleAnalysis(msg);
  if (msg?.type === "config") applyConfig(msg.config);
  if (msg?.type === "getPgnData") {
    const data = globalThis.moveHistory?.exportData() ?? null;
    sendResponse({ data });
    return true;
  }
};

// ── Init ──────────────────────────────────────────────────────────────────

const init = async () => {
  // Skip Lichess if disabled
  if (IS_LICHESS && !currentConfig.enableLichess) return;

  await loadOpeningsDb();
  ensureOverlay();
  pollingId = setInterval(sendState, THROTTLE_MS);

  chrome.runtime.onMessage.addListener(handleMessage);
  document.addEventListener("keydown", handleKeyboard);

  // Listen for move classification events
  document.addEventListener("game:moveClassified", (e) => {
    const { classification } = e.detail || {};
    if (classification) {
      showClassification(classification);
      playBlunderSound(classification);
    }
  });

  try {
    chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
      if (resp?.config) applyConfig(resp.config);
    });
  } catch { /* context invalidated */ }
};

if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  window.addEventListener("DOMContentLoaded", init, { once: true });
}
