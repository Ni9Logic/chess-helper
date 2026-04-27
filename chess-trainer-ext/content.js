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
let lastEngineRec = null;     // { uci, score, fen } — engine's pick before user moved
let comparisonBadge = null;

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

    // Move comparison badge
    comparisonBadge = document.createElement("div");
    comparisonBadge.id = "chess-trainer-comparison";
    comparisonBadge.style.display = "none";
    boardEl.appendChild(comparisonBadge);
  }
  syncOverlayTransform(boardEl);
  return boardOverlay;
};

const clearArrows = () => {
  const svg = document.getElementById("chess-trainer-svg");
  if (svg) svg.innerHTML = "";
};

// ── Arrow drawing (curved bezier) ─────────────────────────────────────────

const ARROW_COLORS = ["#10b981", "#14b8a6", "#38bdf8", "#818cf8", "#a78bfa"];
const markerIdForColor = (color) => `arrowhead-${color.replace("#", "")}`;

// curvature: 0 = straight, positive = curve left, negative = curve right
// strokeWidth: thicker = more important
const drawArrow = (fromSq, toSq, label = "", color = "#10b981", curvature = 0, opacity = 0.74, strokeWidth = 0.9) => {
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

  // ── Stealth dot mode: tiny near-invisible dots instead of arrows ──
  if (currentConfig.stealthMode) {
    const dotR = currentConfig.stealthDotSize ?? 0.7;
    const dotAlpha = currentConfig.stealthDotOpacity ?? 0.18;
    const dotColor = "#000";
    const dot1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot1.setAttribute("cx", x1); dot1.setAttribute("cy", y1);
    dot1.setAttribute("r", dotR);
    dot1.setAttribute("fill", dotColor); dot1.setAttribute("fill-opacity", String(dotAlpha));
    svg.appendChild(dot1);
    const dot2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot2.setAttribute("cx", x2); dot2.setAttribute("cy", y2);
    dot2.setAttribute("r", dotR);
    dot2.setAttribute("fill", dotColor); dot2.setAttribute("fill-opacity", String(dotAlpha));
    svg.appendChild(dot2);
    return; // skip arrow + label entirely
  }

  // Compute control point for quadratic bezier curve
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular offset for the control point
  const cx = mx + (-dy / len) * curvature;
  const cy = my + (dx / len) * curvature;

  const markerId = markerIdForColor(color);

  // Ensure defs + marker
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

  // Draw curved path instead of straight line
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  if (Math.abs(curvature) < 0.5) {
    // Straight line for zero curvature
    path.setAttribute("d", `M${x1},${y1} L${x2},${y2}`);
  } else {
    // Quadratic bezier curve
    path.setAttribute("d", `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`);
  }
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", String(strokeWidth));
  path.setAttribute("stroke-opacity", String(opacity));
  path.setAttribute("fill", "none");
  path.setAttribute("marker-end", `url(#${markerId})`);
  svg.appendChild(path);

  // Label at the curve midpoint
  if (label) {
    // For quadratic bezier, midpoint at t=0.5: P = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const lx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
    const ly = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", lx); text.setAttribute("y", ly - 1.5);
    text.setAttribute("fill", "#fff"); text.setAttribute("font-size", "4.5");
    text.setAttribute("font-weight", "700"); text.setAttribute("text-anchor", "middle");
    text.setAttribute("paint-order", "stroke"); text.setAttribute("stroke", "#0f172a");
    text.setAttribute("stroke-width", "1.5");
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

// PV line visualization
const drawPvLine = (pv) => {
  if (!currentConfig.showPvLine || !pv || pv.length < 2) return;
  const colors = ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0"];
  for (let i = 1; i < Math.min(pv.length, 5); i++) {
    const move = pv[i];
    if (!move || move.length < 4) continue;
    drawArrow(move.slice(0, 2), move.slice(2, 4), "", colors[i] || "#d1fae5", 0, 0.5 - i * 0.08);
  }
};

// Arrow fade-in animation
const animateOverlay = () => {
  if (!currentConfig.arrowAnimation || !boardOverlay) return;
  boardOverlay.classList.remove("ct-fade-in");
  void boardOverlay.offsetWidth;
  boardOverlay.classList.add("ct-fade-in");
};

// Time trouble
let timeTroubleActive = false;
let timeTroubleInterval = null;

const parseClockText = (text) => {
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  const s = parseFloat(text);
  return isNaN(s) ? null : s;
};

const checkTimeTrouble = () => {
  if (!currentConfig.timeTroubleAlert) return;
  const boardEl = findBoard();
  if (!boardEl) return;
  const clockEl = document.querySelector(
    ".clock-player-bottom .clock-time, [data-cy='clock-player-bottom'] .clock-time-monospace, .rclock-bottom .time"
  );
  if (!clockEl) return;
  const seconds = parseClockText(clockEl.textContent?.trim());
  if (seconds !== null && seconds <= (currentConfig.timeTroubleThreshold || 30) && seconds > 0) {
    if (!timeTroubleActive) { timeTroubleActive = true; boardEl.classList.add("ct-time-trouble"); }
  } else if (timeTroubleActive) {
    timeTroubleActive = false; boardEl.classList.remove("ct-time-trouble");
  }
};

// Endgame tablebase
let lastTablebaseFen = null;
let tablebasePill = null;

const checkTablebase = async (fen) => {
  if (!currentConfig.endgameTablebase || !fen) return;
  const pieceCount = fen.split(" ")[0].replace(/[^a-zA-Z]/g, "").length;
  if (pieceCount > 7) return;
  if (fen === lastTablebaseFen) return;
  lastTablebaseFen = fen;
  try {
    const resp = await fetch(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!tablebasePill || !tablebasePill.isConnected) {
      const boardEl = findBoard();
      if (!boardEl) return;
      tablebasePill = document.createElement("div");
      tablebasePill.id = "chess-trainer-tablebase";
      boardEl.appendChild(tablebasePill);
    }
    if (data.category?.includes("win")) {
      tablebasePill.textContent = `TB: Win in ${Math.abs(data.dtm || data.dtz || "?")}`;
      tablebasePill.style.background = "rgba(16,185,129,0.85)";
    } else if (data.category?.includes("loss")) {
      tablebasePill.textContent = `TB: Loss in ${Math.abs(data.dtm || data.dtz || "?")}`;
      tablebasePill.style.background = "rgba(239,68,68,0.85)";
    } else {
      tablebasePill.textContent = "TB: Draw";
      tablebasePill.style.background = "rgba(100,116,139,0.85)";
    }
    tablebasePill.style.display = "block";
    if (data.moves?.[0]?.uci) {
      const m = data.moves[0].uci;
      drawArrow(m.slice(0, 2), m.slice(2, 4), "TB", "#8b5cf6", 0, 0.8);
    }
  } catch { }
};

// Puzzle detection
let lastPuzzleShown = 0;
let puzzleBadge = null;

const parseEvalNum = (s) => {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  if (s.startsWith("Mate")) return s.includes("-") ? -100 : 100;
  return parseFloat(s) || null;
};

const checkPuzzle = (prevScore, bestScore) => {
  if (!currentConfig.puzzleMode) return;
  const p = parseEvalNum(prevScore), b = parseEvalNum(bestScore);
  if (p === null || b === null) return;
  if (Math.abs(b - p) > 2 && Date.now() - lastPuzzleShown > 5000) {
    lastPuzzleShown = Date.now();
    if (!puzzleBadge || !puzzleBadge.isConnected) {
      const boardEl = findBoard(); if (!boardEl) return;
      puzzleBadge = document.createElement("div");
      puzzleBadge.id = "chess-trainer-puzzle";
      puzzleBadge.textContent = "⚡ Tactic!";
      boardEl.appendChild(puzzleBadge);
    }
    puzzleBadge.style.display = "flex";
    puzzleBadge.style.opacity = "1";
    setTimeout(() => { puzzleBadge.style.opacity = "0"; setTimeout(() => { puzzleBadge.style.display = "none"; }, 500); }, 3000);
  }
};

// Pattern recognition
const showPatterns = (fen, moveUci) => {
  if (!currentConfig.patternRecognition || !globalThis.tacticsEngine) return;
  const patterns = globalThis.tacticsEngine.detectPatterns(fen, moveUci);
  for (const p of patterns) {
    if (p.type === "fork" && p.targets) {
      for (const target of p.targets) drawArrow(p.square, target, "⚔", "#f59e0b", 0, 0.6);
    }
    if (p.type === "back_rank_weakness") showTempBadge(p.label, "chess-trainer-pattern");
  }
};

// Move explanation
const showExplanation = (fen, moveUci) => {
  if (!currentConfig.moveExplanations || !globalThis.tacticsEngine) return;
  const text = globalThis.tacticsEngine.explainMove(fen, moveUci);
  if (text) showTempBadge(text, "chess-trainer-explanation");
};

// Reusable temp badge helper
const showTempBadge = (text, id, duration = 3000) => {
  let el = document.getElementById(id);
  if (!el) {
    const boardEl = findBoard(); if (!boardEl) return;
    el = document.createElement("div");
    el.id = id;
    el.className = `ct-temp-badge ${id}`;
    boardEl.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  el.style.opacity = "1";
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => { el.style.display = "none"; }, 400); }, duration);
};

// Opponent profile
const updateOpponentProfile = () => {
  if (!currentConfig.opponentProfiler || !globalThis.analytics) return;
  const mh = globalThis.moveHistory?.exportData();
  if (!mh) return;
  const profile = globalThis.analytics.profileOpponent(mh);
  if (!profile) return;
  let el = document.getElementById("chess-trainer-profile");
  if (!el) {
    const boardEl = findBoard(); if (!boardEl) return;
    el = document.createElement("div"); el.id = "chess-trainer-profile"; boardEl.appendChild(el);
  }
  el.innerHTML = `<div class="ct-profile-style">${profile.style}</div><div class="ct-profile-stat">Acc: ${profile.accuracy}%</div>`;
  el.style.display = "block";
};

// Post-game summary
let gameEnded = false;
let summaryOverlay = null;

const checkGameEnd = () => {
  if (!currentConfig.postGameSummary || gameEnded) return;
  const over = document.querySelector(".game-over-modal, .result-message, .game-result, [class*='game-over'], .rclock.expired");
  if (!over) return;
  gameEnded = true;
  setTimeout(showPostGameSummary, 1000);
};

const showPostGameSummary = async () => {
  const mh = globalThis.moveHistory?.exportData();
  if (!mh?.fenHistory?.length) return;
  let gs = null;
  if (globalThis.analytics) gs = await globalThis.analytics.recordGame(mh);
  const boardEl = findBoard(); if (!boardEl) return;
  summaryOverlay = document.createElement("div");
  summaryOverlay.id = "chess-trainer-summary";
  summaryOverlay.innerHTML = `
    <div class="ct-summary-card">
      <div class="ct-summary-header">📊 Game Summary</div>
      <div class="ct-summary-body">
        <div class="ct-row"><span>Accuracy</span><span class="ct-val">${gs?.accuracy ?? "—"}%</span></div>
        <div class="ct-row"><span>Avg CPL</span><span class="ct-val">${gs?.avgCpl ?? "—"}</span></div>
        <div class="ct-row"><span>Opening</span><span class="ct-val">${mh.openingName || "—"}</span></div>
        <div class="ct-row"><span>Moves</span><span class="ct-val">${mh.fenHistory?.length || 0}</span></div>
        <div class="ct-row"><span>Brilliancies</span><span class="ct-val ct-brilliant">${gs?.brilliancies ?? 0}</span></div>
        <div class="ct-row"><span>Blunders</span><span class="ct-val ct-blunder">${gs?.blunders ?? 0}</span></div>
        <div class="ct-row"><span>Mistakes</span><span class="ct-val ct-mistake">${gs?.mistakes ?? 0}</span></div>
      </div>
      <button class="ct-summary-close" onclick="this.closest('#chess-trainer-summary').remove()">✕ Close</button>
    </div>`;
  boardEl.appendChild(summaryOverlay);
};

// Streamer mode
let streamerHidden = false;
const toggleStreamerMode = () => {
  streamerHidden = !streamerHidden;
  const boardEl = findBoard(); if (!boardEl) return;
  boardEl.querySelectorAll("[id^='chess-trainer-']").forEach(el => {
    el.style.visibility = streamerHidden ? "hidden" : "visible";
  });
};

// Screenshot
const takeScreenshot = () => {
  const svg = document.getElementById("chess-trainer-svg");
  if (!svg) return;
  const content = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([content], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `chess-arrows-${Date.now()}.svg`;
  a.click(); URL.revokeObjectURL(url);
};

// Bookmark
const bookmarkPosition = async () => {
  if (!globalThis.analytics || !lastFen) return;
  await globalThis.analytics.addBookmark(lastFen);
  showTempBadge("📌 Bookmarked!", "chess-trainer-pattern");
};

// ── Move Comparison ───────────────────────────────────────────────────────

let comparisonTimeout = null;

const parseEval = (scoreStr) => {
  if (!scoreStr) return 0;
  if (typeof scoreStr === "number") return scoreStr;
  const s = String(scoreStr);
  if (s.startsWith("Mate")) return s.includes("-") ? -100 : 100;
  return parseFloat(s) || 0;
};

const formatUci = (uci) => {
  if (!uci || uci.length < 4) return uci || "?";
  const from = uci.slice(0, 2).toUpperCase();
  const to = uci.slice(2, 4).toUpperCase();
  return `${from}→${to}`;
};

const showMoveComparison = (engineRec, currentPayload) => {
  if (!comparisonBadge || currentConfig.stealthMode) return;

  const currentBest = currentPayload.bestMoves?.[0];
  if (!currentBest) return;

  const prevEval = parseEval(engineRec.score);
  const currEval = parseEval(currentBest.score);

  // Flip sign: if it was white's turn, a drop in eval means white played worse
  // After the move, it's the opponent's turn, so the eval is from their perspective
  const evalLoss = Math.abs(prevEval + currEval); // prev was from mover's view, curr is from opponent's

  const engineMove = formatUci(engineRec.uci);

  let emoji, color, text;
  if (evalLoss < 0.1) {
    emoji = "✅"; color = "#10b981"; text = `Best move! ${engineMove}`;
  } else if (evalLoss < 0.5) {
    emoji = "👍"; color = "#22d3ee"; text = `Good · Engine: ${engineMove} (−${evalLoss.toFixed(1)})`;
  } else if (evalLoss < 1.5) {
    emoji = "⚠️"; color = "#f59e0b"; text = `Inaccuracy · Engine: ${engineMove} (−${evalLoss.toFixed(1)})`;
  } else if (evalLoss < 3.0) {
    emoji = "❌"; color = "#f97316"; text = `Mistake · Engine: ${engineMove} (−${evalLoss.toFixed(1)})`;
  } else {
    emoji = "💀"; color = "#ef4444"; text = `Blunder · Engine: ${engineMove} (−${evalLoss.toFixed(1)})`;
  }

  comparisonBadge.textContent = `${emoji} ${text}`;
  comparisonBadge.style.display = "block";
  comparisonBadge.style.background = color;
  comparisonBadge.style.color = evalLoss < 0.5 ? "#0f172a" : "#fff";

  // In comparisonOnly mode: draw the engine's recommended arrow temporarily
  if (currentConfig.comparisonOnly && engineRec.uci?.length >= 4) {
    ensureOverlay(); clearArrows();
    const from = engineRec.uci.slice(0, 2), to = engineRec.uci.slice(2, 4);
    drawArrow(from, to, "", color, 0, 0.8, 1.1);
  }

  if (comparisonTimeout) clearTimeout(comparisonTimeout);
  comparisonTimeout = setTimeout(() => {
    if (comparisonBadge) comparisonBadge.style.display = "none";
    if (currentConfig.comparisonOnly) clearArrows();
  }, 2000);
};

// Enhanced analysis handler
const handleAnalysis = (payload) => {
  if (!currentConfig.enabled || streamerHidden) return;
  lastAnalysisPayload = payload;

  // Record eval + classify
  if (globalThis.moveHistory && payload?.fen) {
    const prevEval = globalThis.moveHistory.evalHistory?.length
      ? globalThis.moveHistory.evalHistory[globalThis.moveHistory.evalHistory.length - 1]?.score : null;
    globalThis.moveHistory.recordEval(payload.fen, payload);
    const classification = globalThis.moveHistory.classifyLastMove();
    if (classification) { showClassification(classification); playBlunderSound(classification); }
    checkPuzzle(prevEval, payload.bestMoves?.[0]?.score);
    if (payload.bestMoves?.[0]?.uci) {
      showPatterns(payload.fen, payload.bestMoves[0].uci);
      showExplanation(payload.fen, payload.bestMoves[0].uci);
    }
    if ((globalThis.moveHistory.fenHistory?.length || 0) % 10 === 0) updateOpponentProfile();
  }

  // ── Comparison-Only Mode: hide everything, only show comparison ──
  if (currentConfig.comparisonOnly) {
    if (payload.partial) return; // skip partials

    ensureOverlay();
    // Hide all persistent overlays
    if (evalBadge) evalBadge.style.display = "none";
    if (wdlBar) wdlBar.style.display = "none";
    if (openingPill) openingPill.style.display = "none";
    if (classificationBadge) classificationBadge.style.display = "none";
    if (tablebasePill) tablebasePill.style.display = "none";
    if (puzzleBadge) puzzleBadge.style.display = "none";

    const moves = payload?.bestMoves || [];

    // Run move comparison
    if (currentConfig.moveComparison && lastEngineRec && payload?.fen) {
      const fenHistory = globalThis.moveHistory?.fenHistory || [];
      if (fenHistory.length >= 2) {
        const prevFen = fenHistory[fenHistory.length - 2];
        if (lastEngineRec.fen && lastEngineRec.fen.split(" ").slice(0, 4).join(" ") === prevFen?.split(" ").slice(0, 4).join(" ")) {
          showMoveComparison(lastEngineRec, payload);
        }
      }
    }

    // Store engine rec for next comparison
    if (moves.length && payload?.fen) {
      lastEngineRec = { uci: moves[0].uci, score: moves[0].score, fen: payload.fen };
    }
    return;
  }

  // Player-side filter
  if (currentConfig.playerSide && currentConfig.playerSide !== "auto" && payload?.fen) {
    const active = payload.fen.split(" ")[1];
    if ((active === "w" && currentConfig.playerSide === "black") ||
      (active === "b" && currentConfig.playerSide === "white")) {
      clearArrows();
      if (evalBadge && currentConfig.showEvalBadge) evalBadge.textContent = "⏸";
      renderWdlBar(null); return;
    }
  }

  ensureOverlay(); clearArrows();
  const moves = payload?.bestMoves || [];
  if (!moves.length) {
    if (evalBadge && currentConfig.showEvalBadge && !currentConfig.hintMode) evalBadge.textContent = "–";
    renderWdlBar(null); return;
  }

  // ── Hint Mode: single arrow for 2 seconds, no persistent UI ──
  if (currentConfig.hintMode) {
    // Skip partial/progressive results in hint mode to avoid flicker
    if (payload.partial) return;

    // Hide all persistent overlays
    if (evalBadge) evalBadge.style.display = "none";
    if (wdlBar) wdlBar.style.display = "none";
    if (openingPill) openingPill.style.display = "none";
    if (classificationBadge) classificationBadge.style.display = "none";
    if (tablebasePill) tablebasePill.style.display = "none";
    if (puzzleBadge) puzzleBadge.style.display = "none";

    // Draw one best-move arrow
    const mv = moves[0];
    if (mv?.uci?.length >= 4) {
      const from = mv.uci.slice(0, 2), to = mv.uci.slice(2, 4);
      drawArrow(from, to, "", "#10b981", 0, 0.7, 1.1);
    }

    // Auto-clear after 2 seconds
    if (hintTimeout) clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => clearArrows(), 2000);

    // Still record engine rec for move comparison
    if (moves.length && payload?.fen) {
      lastEngineRec = { uci: moves[0].uci, score: moves[0].score, fen: payload.fen };
    }

    // Still do move comparison if enabled
    if (currentConfig.moveComparison && lastEngineRec && payload?.fen) {
      const fenHistory = globalThis.moveHistory?.fenHistory || [];
      if (fenHistory.length >= 2) {
        const prevFen = fenHistory[fenHistory.length - 2];
        if (lastEngineRec.fen && lastEngineRec.fen.split(" ").slice(0, 4).join(" ") === prevFen?.split(" ").slice(0, 4).join(" ")) {
          showMoveComparison(lastEngineRec, payload);
        }
      }
    }

    // Record eval for history
    if (globalThis.moveHistory && payload?.fen) {
      globalThis.moveHistory.recordEval(payload.fen, payload);
    }

    return;
  }

  // Best-move arrows — distinct colors + curves so they don't overlap
  const maxArrows = currentConfig.showTopArrows ? Math.min(currentConfig.topArrows || 1, moves.length) : 1;
  for (let i = 0; i < maxArrows; i++) {
    const mv = moves[i];
    if (!mv?.uci || mv.uci.length < 4) continue;
    const from = mv.uci.slice(0, 2), to = mv.uci.slice(2, 4);
    const label = i === 0 ? mv.score || "" : `#${i + 1}`;
    const arrowColor = ARROW_COLORS[i] || ARROW_COLORS[ARROW_COLORS.length - 1];
    // Alternate curvature direction: 0, +4, -4, +7, -7...
    const curve = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * (3 + Math.floor(i / 2) * 2);
    const width = Math.max(0.5, 1.2 - i * 0.15);
    const alpha = Math.max(0.45, 0.85 - i * 0.1);
    drawArrow(from, to, label, arrowColor, curve, alpha, width);
    if (i === 0 && evalBadge && currentConfig.showEvalBadge) {
      const depthTag = payload.partial ? ` d${payload.currentDepth || "?"}` : "";
      evalBadge.textContent = (mv.score || "0.0") + depthTag;
    }
  }

  // PV line
  if (moves[0]?.pv) drawPvLine(moves[0].pv);

  // Threat arrow
  if (currentConfig.showThreatArrow && moves[0]?.pv?.length >= 2) {
    const t = moves[0].pv[1];
    if (t?.length >= 4) drawArrow(t.slice(0, 2), t.slice(2, 4), "⚠", "#f59e0b", 0, 0.55);
  }

  // Blunder arrow
  if (currentConfig.showBlunderArrow && payload?.blunderMove?.uci?.length >= 4) {
    const u = payload.blunderMove.uci;
    drawArrow(u.slice(0, 2), u.slice(2, 4), "??", "#ef4444");
  }

  renderWdlBar(moves[0]?.wdl ?? null);
  renderOpeningName(payload?.fen);
  animateOverlay();
  checkTablebase(payload?.fen);
  checkGameEnd();
  checkTimeTrouble();

  // ── Move Comparison: compare user's move vs engine's recommendation ──
  if (currentConfig.moveComparison && lastEngineRec && payload?.fen && !payload.partial) {
    const fenHistory = globalThis.moveHistory?.fenHistory || [];
    if (fenHistory.length >= 2) {
      const prevFen = fenHistory[fenHistory.length - 2];
      // Only compare if the engine recommendation was for the previous position
      if (lastEngineRec.fen && lastEngineRec.fen.split(" ").slice(0, 4).join(" ") === prevFen?.split(" ").slice(0, 4).join(" ")) {
        showMoveComparison(lastEngineRec, payload);
      }
    }
  }

  // Store current engine recommendation for next comparison
  if (!payload.partial && moves.length && payload?.fen) {
    lastEngineRec = {
      uci: moves[0].uci,
      score: moves[0].score,
      fen: payload.fen,
    };
  }
};

// ── State sending ─────────────────────────────────────────────────────────

const sendState = () => {
  if (!isContextValid()) { if (pollingId) { clearInterval(pollingId); pollingId = null; } return; }
  const now = Date.now();
  if (now - lastSent < THROTTLE_MS) return;
  if (isPremoveActive()) return;
  const fen = readFen();
  if (!fen || fen === lastFen) return;
  lastSent = now; lastFen = fen;
  if (globalThis.moveHistory) globalThis.moveHistory.recordPosition(fen);
  try { chrome.runtime.sendMessage({ type: "fen", fen }); } catch { }
};

// Force immediate re-analysis — bypasses throttle and FEN dedup
const forceAnalyze = () => {
  if (!isContextValid()) return;
  const fen = readFen();
  if (!fen) return;
  lastFen = fen;
  lastSent = Date.now();
  try { chrome.runtime.sendMessage({ type: "fen", fen }); } catch { }
};

// ── Config ────────────────────────────────────────────────────────────────

const applyConfig = (config) => {
  currentConfig = { ...currentConfig, ...config };
  if (!currentConfig.enabled) {
    clearArrows();
    if (evalBadge) evalBadge.textContent = "⏸";
    if (wdlBar) wdlBar.style.display = "none";
  }
  // Stealth mode: hide everything except the SVG overlay (dots only)
  if (currentConfig.stealthMode) {
    if (evalBadge) evalBadge.style.display = "none";
    if (wdlBar) wdlBar.style.display = "none";
    if (openingPill) openingPill.style.display = "none";
    if (classificationBadge) classificationBadge.style.display = "none";
    if (tablebasePill) tablebasePill.style.display = "none";
    if (puzzleBadge) puzzleBadge.style.display = "none";
    if (comparisonBadge) comparisonBadge.style.display = "none";
    return;
  }
  if (!currentConfig.showWdlBar && wdlBar) wdlBar.style.display = "none";
  if (!currentConfig.showOpeningName && openingPill) openingPill.style.display = "none";
  if (!currentConfig.showEvalBadge && evalBadge) evalBadge.style.display = "none";
  else if (currentConfig.showEvalBadge && evalBadge) evalBadge.style.display = "";
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────

const handleKeyboard = (e) => {
  if (!currentConfig.keyboardShortcuts || !e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "t") { e.preventDefault(); currentConfig.enabled = !currentConfig.enabled; applyConfig(currentConfig); try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch { } }
  if (k === "e") { e.preventDefault(); currentConfig.showEvalBadge = !currentConfig.showEvalBadge; applyConfig(currentConfig); try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch { } }
  if (k === "a") {
    e.preventDefault();
    if (!currentConfig.showTopArrows) { currentConfig.showTopArrows = true; currentConfig.topArrows = 2; }
    else if (currentConfig.topArrows < 5) currentConfig.topArrows++;
    else { currentConfig.showTopArrows = false; currentConfig.topArrows = 1; }
    applyConfig(currentConfig); try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch { }
    if (lastAnalysisPayload) handleAnalysis(lastAnalysisPayload);
  }
  if (k === "h") { e.preventDefault(); toggleStreamerMode(); if (!streamerHidden) forceAnalyze(); }
  if (k === "d") { e.preventDefault(); currentConfig.stealthMode = !currentConfig.stealthMode; applyConfig(currentConfig); try { chrome.runtime.sendMessage({ type: "saveConfig", config: currentConfig }); } catch {} if (lastAnalysisPayload) handleAnalysis(lastAnalysisPayload); }
  if (k === "b") { e.preventDefault(); bookmarkPosition(); }
  if (k === "s") { e.preventDefault(); takeScreenshot(); }
};

// ── Message handler ───────────────────────────────────────────────────────

const handleMessage = (msg, _sender, sendResponse) => {
  if (msg?.type === "analysis") handleAnalysis(msg);
  if (msg?.type === "config") applyConfig(msg.config);
  if (msg?.type === "getPgnData") { sendResponse({ data: globalThis.moveHistory?.exportData() ?? null }); return true; }
  if (msg?.type === "getStats") { globalThis.analytics?.getStats().then(s => sendResponse({ stats: s })); return true; }
  if (msg?.type === "getBookmarks") { globalThis.analytics?.getBookmarks().then(b => sendResponse({ bookmarks: b })); return true; }
  if (msg?.type === "copyFen") { if (lastFen) navigator.clipboard.writeText(lastFen).catch(() => { }); sendResponse({ ok: true }); return true; }
  if (msg?.type === "contextAction") {
    if (msg.action === "copyFen" && lastFen) navigator.clipboard.writeText(lastFen).catch(() => { });
    if (msg.action === "bookmark") bookmarkPosition();
    if (msg.action === "screenshot") takeScreenshot();
  }
};

// ── Init ──────────────────────────────────────────────────────────────────

const init = async () => {
  if (IS_LICHESS && !currentConfig.enableLichess) return;
  await loadOpeningsDb();
  ensureOverlay();
  pollingId = setInterval(sendState, THROTTLE_MS);
  timeTroubleInterval = setInterval(() => {
    if (isContextValid()) { checkTimeTrouble(); checkGameEnd(); }
    else if (timeTroubleInterval) clearInterval(timeTroubleInterval);
  }, 1000);
  chrome.runtime.onMessage.addListener(handleMessage);
  document.addEventListener("keydown", handleKeyboard);
  document.addEventListener("game:moveClassified", (e) => {
    const { classification } = e.detail || {};
    if (classification) { showClassification(classification); playBlunderSound(classification); }
  });
  document.addEventListener("game:newGame", () => {
    gameEnded = false; lastTablebaseFen = null;
    if (summaryOverlay) { summaryOverlay.remove(); summaryOverlay = null; }
  });
  try { chrome.runtime.sendMessage({ type: "getConfig" }, (r) => { if (r?.config) applyConfig(r.config); }); } catch { }
};

if (document.readyState === "complete" || document.readyState === "interactive") init();
else window.addEventListener("DOMContentLoaded", init, { once: true });
