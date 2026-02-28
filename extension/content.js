const THROTTLE_MS = 500; // ~2 Hz

let lastSent = 0;
let lastFen = "";
let boardOverlay = null;
let evalBadge = null;
let currentConfig = {
  enabled: true,
  showEvalBadge: true,
  showTopArrows: false,
  topArrows: 1,
  showBlunderArrow: false,
  orientation: "auto", // auto | white | black
  playerSide: "auto", // auto | white | black (who to show moves for)
};

const pieceMap = {
  wp: "P",
  wn: "N",
  wb: "B",
  wr: "R",
  wq: "Q",
  wk: "K",
  bp: "p",
  bn: "n",
  bb: "b",
  br: "r",
  bq: "q",
  bk: "k",
};

const squareToIndex = (sq) => {
  // chess.com uses square-11 for a1, square-18 for a8
  const match = sq.match(/square-(\d)(\d)/);
  if (!match) return null;
  const file = Number(match[1]) - 1; // 0-7
  const rank = Number(match[2]); // 1-8
  const row = 8 - rank;
  return row * 8 + file;
};

const findBoard = () => document.querySelector('[data-board-id], .board, .chess-board');

function getBoardRotationDeg() {
  const board = findBoard();
  if (!board) return 0;

  // walk up a few ancestors to catch transforms applied to wrappers
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
          const angle = Math.atan2(b, a) * (180 / Math.PI);
          return (Math.round(angle) + 360) % 360;
        }
      }
    }
    node = node.parentElement;
  }

  return 0;
}

// Infer orientation using square positions if class flags are missing.
const detectFlipFromSquares = () => {
  const board = findBoard();
  if (!board) return false;
  const pieces = board.querySelectorAll('[class*="square-"]');
  if (!pieces.length) return false;

  const boardRect = board.getBoundingClientRect();
  let errWhite = 0;
  let errBlack = 0;
  let samples = 0;

  pieces.forEach((el) => {
    const cls = el.className;
    const match = cls.match(/square-(\d)(\d)/);
    if (!match) return;
    const file = Number(match[1]) - 1;
    const rank = Number(match[2]); // 1..8
    const row = 8 - rank;
    const col = file;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rx = (cx - boardRect.left) / boardRect.width;
    const ry = (cy - boardRect.top) / boardRect.height;

    const expectedWhiteX = (col + 0.5) / 8;
    const expectedWhiteY = (row + 0.5) / 8;
    const expectedBlackX = (7 - col + 0.5) / 8;
    const expectedBlackY = (7 - row + 0.5) / 8;

    errWhite += (rx - expectedWhiteX) ** 2 + (ry - expectedWhiteY) ** 2;
    errBlack += (rx - expectedBlackX) ** 2 + (ry - expectedBlackY) ** 2;
    samples += 1;
  });

  if (samples === 0) return false;
  // prefer the orientation with lower error; add small bias toward detected black to avoid flapping
  return errBlack * 0.98 < errWhite;
};

const isFlipped = () => {
  const orientationPref = (currentConfig.orientation || "auto").toLowerCase();
  if (orientationPref === "white") return false;
  if (orientationPref === "black") return true;

  const board = findBoard();
  if (!board) return false;
  const cls = board.className || "";
  const style = board.getAttribute("style") || "";
  const orientationFlag = cls.includes("flipped") || cls.includes("orientation-black") || style.includes("rotate(180deg)");

  const rotation = getBoardRotationDeg();
  const visuallyRotated = Math.abs(rotation - 180) < 30; // board already rotated, overlay rotates with it

  if (visuallyRotated) return false; // overlay is rotated with board, keep coordinates natural
  if (orientationFlag) return true;
  return detectFlipFromSquares();
};

const readFen = () => {
  const boardEl = findBoard();
  if (!boardEl) return null;
  const pieceEls = boardEl.querySelectorAll(".piece");
  const board = Array(64).fill(null);
  pieceEls.forEach((el) => {
    const cls = el.className;
    const pieceKey = Object.keys(pieceMap).find((k) => cls.includes(k));
    const squareMatch = cls.match(/square-\d{2}/);
    if (!pieceKey || !squareMatch) return;
    const idx = squareToIndex(squareMatch[0]);
    if (idx === null) return;
    board[idx] = pieceMap[pieceKey];
  });

  const fenRows = [];
  for (let r = 0; r < 8; r += 1) {
    let row = "";
    let empty = 0;
    for (let c = 0; c < 8; c += 1) {
      const piece = board[r * 8 + c];
      if (!piece) {
        empty += 1;
      } else {
        if (empty > 0) {
          row += empty.toString();
          empty = 0;
        }
        row += piece;
      }
    }
    if (empty > 0) row += empty.toString();
    fenRows.push(row || "8");
  }

  let active = document.querySelector(".clock-component.turn")?.classList.contains("black") ? "b" : null;
  // New UI fallback: look for data-state on clocks
  if (!active) {
    const activeClock = document.querySelector('[data-cy="clock-player-bottom"].clock-player-turn,[data-cy="clock-player-top"].clock-player-turn');
    if (activeClock) {
      if (activeClock.getAttribute("data-cy")?.includes("top")) active = "b";
      else active = "w";
    }
  }
  // Force side if user chose a side
  if (currentConfig.playerSide && currentConfig.playerSide !== "auto") {
    active = currentConfig.playerSide === "black" ? "b" : "w";
  }
  if (!active) active = "w";

  const castling = "-"; // unknown; acceptable for analysis
  const enPassant = "-";
  return `${fenRows.join("/")} ${active} ${castling} ${enPassant} 0 1`;
};

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
  }
  syncOverlayTransform(boardEl);
  return boardOverlay;
};

const clearArrows = () => {
  const svg = document.getElementById("chess-trainer-svg");
  if (svg) svg.innerHTML = "";
};

const drawArrow = (
  fromSq,
  toSq,
  label = "",
  color = "#10b981",
  markerId = "arrowhead",
  labelOffset = 0,
) => {
  const svg = document.getElementById("chess-trainer-svg");
  if (!svg) return;
  const file = (ch) => ch.charCodeAt(0) - 97;
  const rank = (r) => Number(r) - 1;
  const flipped = isFlipped();
  const fromFile = file(fromSq[0]);
  const fromRank = rank(fromSq[1]);
  const toFile = file(toSq[0]);
  const toRank = rank(toSq[1]);
  const dispFile = (f) => (flipped ? 7 - f : f);
  const dispRank = (r) => (flipped ? r : 7 - r);
  const x1 = (dispFile(fromFile) + 0.5) * (100 / 8);
  const y1 = (dispRank(fromRank) + 0.5) * (100 / 8);
  const x2 = (dispFile(toFile) + 0.5) * (100 / 8);
  const y2 = (dispRank(toRank) + 0.5) * (100 / 8);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1.toString());
  line.setAttribute("y1", y1.toString());
  line.setAttribute("x2", x2.toString());
  line.setAttribute("y2", y2.toString());
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "0.9");
  line.setAttribute("stroke-opacity", "0.74");
  line.setAttribute("marker-end", `url(#${markerId})`);

  const defs = svg.querySelector("defs") || (() => {
    const d = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(d);
    return d;
  })();
  if (!svg.querySelector(`#${markerId}`)) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("markerWidth", "4");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("refX", "2");
    marker.setAttribute("refY", "2");
    marker.setAttribute("orient", "auto");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", "0 0, 4 2, 0 4");
    poly.setAttribute("fill", color);
    marker.appendChild(poly);
    defs.appendChild(marker);
  }
  svg.appendChild(line);

  if (label) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = (-dy / len) * labelOffset;
    const py = (dx / len) * labelOffset;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", (((x1 + x2) / 2) + px).toString());
    text.setAttribute("y", (((y1 + y2) / 2 - 2) + py).toString());
    text.setAttribute("fill", "#0f172a");
    text.setAttribute("font-size", "6");
    text.setAttribute("font-weight", "600");
    text.setAttribute("text-anchor", "middle");
    text.textContent = label;
    svg.appendChild(text);
  }
};

const handleAnalysis = (payload) => {
  if (!currentConfig.enabled) return;

  // Respect player-side filter: only draw when it's our move, unless auto.
  if (currentConfig.playerSide && currentConfig.playerSide !== "auto" && payload?.fen) {
    const fenParts = payload.fen.split(" ");
    const active = fenParts[1];
    if (active === "w" && currentConfig.playerSide === "black") {
      clearArrows();
      if (evalBadge && currentConfig.showEvalBadge) evalBadge.textContent = "⏸";
      return;
    }
    if (active === "b" && currentConfig.playerSide === "white") {
      clearArrows();
      if (evalBadge && currentConfig.showEvalBadge) evalBadge.textContent = "⏸";
      return;
    }
  }

  ensureOverlay();
  clearArrows();
  const moves = payload?.bestMoves || [];
  if (!moves.length) {
    if (evalBadge && currentConfig.showEvalBadge) evalBadge.textContent = "–";
    return;
  }
  const maxArrows = currentConfig.showTopArrows ? Math.min(currentConfig.topArrows || 1, moves.length) : 1;
  for (let i = 0; i < maxArrows; i += 1) {
    const mv = moves[i];
    if (!mv?.uci || mv.uci.length < 4) continue;
    const from = mv.uci.slice(0, 2);
    const to = mv.uci.slice(2, 4);
    const label = i === 0 ? mv.score || "" : `#${i + 1}`;
    const offset = (i - (maxArrows - 1) / 2) * 2.2; // spread labels more to avoid overlap
    drawArrow(from, to, label, "#10b981", "arrowhead", offset);
    if (i === 0 && evalBadge && currentConfig.showEvalBadge) {
      evalBadge.textContent = mv.score || "0.0";
    }
  }

  if (currentConfig.showBlunderArrow && payload?.blunderMove?.uci) {
    const uci = payload.blunderMove.uci;
    if (uci.length >= 4) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      drawArrow(from, to, "??", "#ef4444", "arrowhead-blunder");
    }
  }
};

const sendState = () => {
  const now = Date.now();
  if (now - lastSent < THROTTLE_MS) return;
  const fen = readFen();
  if (!fen || fen === lastFen) return;
  lastSent = now;
  lastFen = fen;
  chrome.runtime.sendMessage({ type: "fen", fen });
};

const applyConfig = (config) => {
  currentConfig = { ...currentConfig, ...config };
  if (!currentConfig.enabled) {
    clearArrows();
    if (evalBadge) evalBadge.textContent = "⏸";
  }
};

const init = () => {
  ensureOverlay();
  setInterval(sendState, THROTTLE_MS);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "analysis") handleAnalysis(msg);
    if (msg?.type === "config") applyConfig(msg.config);
  });

  chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
    if (resp?.config) applyConfig(resp.config);
  });
};

if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  window.addEventListener("DOMContentLoaded", init, { once: true });
}
