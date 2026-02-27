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

  const turn = document.querySelector(".clock-component.turn")?.classList.contains("black") ? "b" : "w";
  const active = turn || "w";

  const castling = "-"; // unknown; acceptable for analysis
  const enPassant = "-";
  return `${fenRows.join("/")} ${active} ${castling} ${enPassant} 0 1`;
};

const ensureOverlay = () => {
  const boardEl = findBoard();
  if (!boardEl) return null;
  if (boardOverlay && boardOverlay.isConnected) return boardOverlay;
  boardOverlay = document.createElement("div");
  boardOverlay.id = "chess-trainer-overlay";
  boardOverlay.innerHTML = '<svg id="chess-trainer-svg" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>';
  boardEl.style.position = "relative";
  boardEl.appendChild(boardOverlay);

  evalBadge = document.createElement("div");
  evalBadge.id = "chess-trainer-eval";
  evalBadge.textContent = "…";
  boardEl.appendChild(evalBadge);
  return boardOverlay;
};

const clearArrows = () => {
  const svg = document.getElementById("chess-trainer-svg");
  if (svg) svg.innerHTML = "";
};

const drawArrow = (fromSq, toSq, label = "") => {
  const svg = document.getElementById("chess-trainer-svg");
  if (!svg) return;
  const file = (ch) => ch.charCodeAt(0) - 97;
  const rank = (r) => Number(r) - 1;
  const fromFile = file(fromSq[0]);
  const fromRank = rank(fromSq[1]);
  const toFile = file(toSq[0]);
  const toRank = rank(toSq[1]);
  const x1 = (fromFile + 0.5) * (100 / 8);
  const y1 = (7 - fromRank + 0.5) * (100 / 8);
  const x2 = (toFile + 0.5) * (100 / 8);
  const y2 = (7 - toRank + 0.5) * (100 / 8);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1.toString());
  line.setAttribute("y1", y1.toString());
  line.setAttribute("x2", x2.toString());
  line.setAttribute("y2", y2.toString());
  line.setAttribute("stroke", "#10b981");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("marker-end", "url(#arrowhead)");

  const defs = svg.querySelector("defs") || (() => {
    const d = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(d);
    return d;
  })();
  if (!svg.querySelector("#arrowhead")) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "3");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", "0 0, 6 3, 0 6");
    poly.setAttribute("fill", "#10b981");
    marker.appendChild(poly);
    defs.appendChild(marker);
  }
  svg.appendChild(line);

  if (label) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", ((x1 + x2) / 2).toString());
    text.setAttribute("y", ((y1 + y2) / 2 - 2).toString());
    text.setAttribute("fill", "#0f172a");
    text.setAttribute("font-size", "10");
    text.setAttribute("font-weight", "700");
    text.setAttribute("text-anchor", "middle");
    text.textContent = label;
    svg.appendChild(text);
  }
};

const handleAnalysis = (payload) => {
  if (!currentConfig.enabled) return;
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
    drawArrow(from, to, label);
    if (i === 0 && evalBadge && currentConfig.showEvalBadge) {
      evalBadge.textContent = mv.score || "0.0";
    }
  }

  if (currentConfig.showBlunderArrow && payload?.blunderMove?.uci) {
    const uci = payload.blunderMove.uci;
    if (uci.length >= 4) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const label = "??";
      const svg = document.getElementById("chess-trainer-svg");
      if (svg) {
        const file = (ch) => ch.charCodeAt(0) - 97;
        const rank = (r) => Number(r) - 1;
        const fromFile = file(from[0]);
        const fromRank = rank(from[1]);
        const toFile = file(to[0]);
        const toRank = rank(to[1]);
        const x1 = (fromFile + 0.5) * (100 / 8);
        const y1 = (7 - fromRank + 0.5) * (100 / 8);
        const x2 = (toFile + 0.5) * (100 / 8);
        const y2 = (7 - toRank + 0.5) * (100 / 8);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1.toString());
        line.setAttribute("y1", y1.toString());
        line.setAttribute("x2", x2.toString());
        line.setAttribute("y2", y2.toString());
        line.setAttribute("stroke", "#ef4444");
        line.setAttribute("stroke-width", "2");
        line.setAttribute("marker-end", "url(#arrowhead-blunder)");

        const defs = svg.querySelector("defs") || (() => {
          const d = document.createElementNS("http://www.w3.org/2000/svg", "defs");
          svg.appendChild(d);
          return d;
        })();
        if (!svg.querySelector("#arrowhead-blunder")) {
          const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
          marker.setAttribute("id", "arrowhead-blunder");
          marker.setAttribute("markerWidth", "6");
          marker.setAttribute("markerHeight", "6");
          marker.setAttribute("refX", "3");
          marker.setAttribute("refY", "3");
          marker.setAttribute("orient", "auto");
          const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          poly.setAttribute("points", "0 0, 6 3, 0 6");
          poly.setAttribute("fill", "#ef4444");
          marker.appendChild(poly);
          defs.appendChild(marker);
        }
        svg.appendChild(line);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", ((x1 + x2) / 2).toString());
        text.setAttribute("y", ((y1 + y2) / 2 - 2).toString());
        text.setAttribute("fill", "#ef4444");
        text.setAttribute("font-size", "10");
        text.setAttribute("font-weight", "700");
        text.setAttribute("text-anchor", "middle");
        text.textContent = label;
        svg.appendChild(text);
      }
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
