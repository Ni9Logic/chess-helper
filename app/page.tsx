"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatMove,
  gameStatus,
  generateLegalMoves,
  initialState,
  makeMove,
  moveKey,
  squareLabel,
  scoreMoves,
  toFen,
  type GameState,
  type Move,
  type Piece,
  type PieceType,
  type Color,
  type ScoredMove,
} from "@/lib/chessEngine";
import { fenToState } from "@/lib/fen";

type SidebarTab = "guide" | "engine" | "history";

const pieceName: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const pieceTypes: PieceType[] = ["p", "n", "b", "r", "q", "k"];

const PieceIcon = ({ color, type }: { color: Color; type: PieceType }) => {
  const colorName = color === "w" ? "white" : "black";
  const name = pieceName[type] ?? "pawn";
  const src = `/${colorName}-${name}.svg`;

  return (
    <img
      src={src}
      alt={`${colorName} ${name}`}
      className="h-12 w-12 select-none object-contain drop-shadow"
      draggable={false}
    />
  );
};

const squareColor = (row: number, col: number) =>
  (row + col) % 2 === 0 ? "bg-white" : "bg-[#B7C0D8]";

const labelColor = (row: number, col: number) =>
  (row + col) % 2 === 0 ? "text-slate-700" : "text-slate-900";

const pieceColor = (color: "w" | "b") => (color === "w" ? "text-slate-900" : "text-black");

const Board = ({
  state,
  onMove,
  onFreeMove,
  onPlacePiece,
  perspective,
  freeMode,
  placementMode = false,
  arrows = [],
  lastMove,
}: {
  state: GameState;
  onMove: (move: Move) => void;
  onFreeMove: (from: number, to: number) => void;
  onPlacePiece?: (idx: number, piece?: Piece) => void;
  perspective: "w" | "b";
  freeMode: boolean;
  placementMode?: boolean;
  arrows?: { from: number; to: number; color: Color; label: string }[];
  lastMove?: { from: number; to: number } | null;
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const allMoves = useMemo(() => generateLegalMoves(state), [state]);
  const movesFromActive = useMemo(() => {
    const from = selected ?? dragFrom;
    if (from === null) return [];
    if (freeMode) {
      return Array.from({ length: 64 }, (_, to) => ({ from, to }));
    }
    return allMoves.filter((m) => m.from === from);
  }, [selected, dragFrom, allMoves, freeMode]);

  const order = useMemo(() => {
    const indices = Array.from({ length: 64 }, (_, i) => i);
    return perspective === "w" ? indices : indices.reverse();
  }, [perspective]);

  const handleSquare = (idx: number) => {
    if (freeMode && placementMode && onPlacePiece) {
      onPlacePiece(idx);
      setSelected(null);
      setDragFrom(null);
      return;
    }

    const asDestination = movesFromActive.find((m) => m.to === idx);
    if (asDestination) {
      onMove(asDestination);
      setSelected(null);
      setDragFrom(null);
      return;
    }

    const piece = state.board[idx];
    if (piece && piece.color === state.turn) {
      setSelected(idx);
    } else {
      setSelected(null);
    }
  };

  const renderSquare = (idx: number) => {
    const piece = state.board[idx];
    const { row, col } = { row: Math.floor(idx / 8), col: idx % 8 };
    const isSelected = selected === idx;
    const isTarget = movesFromActive.some((m) => m.to === idx);
    const isLastMove = lastMove ? lastMove.from === idx || lastMove.to === idx : false;
    const highlight =
      isSelected || isTarget
        ? "ring-2 ring-purple-400 shadow-[0_0_0_3px] shadow-purple-200/40"
        : "";

    return (
      <button
        key={idx}
        onClick={() => handleSquare(idx)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (freeMode && onPlacePiece) {
            const pieceData = e.dataTransfer.getData("application/x-chess-piece");
            if (pieceData) {
              try {
                const piece: Piece = JSON.parse(pieceData);
                onPlacePiece(idx, piece);
                setSelected(null);
                setDragFrom(null);
                return;
              } catch {
                // ignore malformed payloads
              }
            }
          }
          const fromIdx = Number(e.dataTransfer.getData("text/plain"));
          if (Number.isNaN(fromIdx)) return;
          if (freeMode) {
            onFreeMove(fromIdx, idx);
            setSelected(null);
            setDragFrom(null);
            return;
          }
          const move = allMoves.find((m) => m.from === fromIdx && m.to === idx);
          if (move) {
            onMove(move);
            setSelected(null);
            setDragFrom(null);
          }
        }}
        className={`relative flex aspect-square w-full items-center justify-center text-3xl font-semibold transition duration-150 ${squareColor(row, col)} ${highlight}`}
      >
        {isLastMove && (
          <span className="pointer-events-none absolute inset-1 rounded-lg bg-purple-300/50 ring-2 ring-purple-500/80 mix-blend-multiply" />
        )}
        {piece ? (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", idx.toString());
              e.dataTransfer.effectAllowed = "move";
              setSelected(idx);
              setDragFrom(idx);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setSelected(null);
            }}
            className={`select-none ${piece ? pieceColor(piece.color) : ""}`}
          >
            <PieceIcon color={piece.color} type={piece.type} />
          </span>
        ) : null}
        {isTarget && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="h-4 w-4 rounded-full bg-purple-300/90 shadow shadow-purple-500/50" />
          </span>
        )}
        {col === 0 && (
          <span className={`absolute left-1 top-1 text-xs ${labelColor(row, col)}`}>
            {8 - row}
          </span>
        )}
        {row === 7 && (
          <span className={`absolute bottom-1 right-1 text-xs ${labelColor(row, col)}`}>
            {String.fromCharCode(97 + col)}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="relative">
      <div className="grid grid-cols-8 overflow-hidden rounded-2xl border border-slate-800/50 shadow-2xl shadow-emerald-500/10 backdrop-blur">
        {order.map((idx) => renderSquare(idx))}
      </div>
      {arrows.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <marker id="arrowhead-white" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <polygon points="0 0, 6 3, 0 6" fill="#10b981" />
            </marker>
            <marker id="arrowhead-black" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <polygon points="0 0, 6 3, 0 6" fill="#f43f5e" />
            </marker>
          </defs>
          {arrows.map((a, i) => {
            const { row: fromRow, col: fromCol } = { row: Math.floor(a.from / 8), col: a.from % 8 };
            const { row: toRow, col: toCol } = { row: Math.floor(a.to / 8), col: a.to % 8 };
            const orient = perspective === "w";
            const displayFromRow = orient ? fromRow : 7 - fromRow;
            const displayFromCol = orient ? fromCol : 7 - fromCol;
            const displayToRow = orient ? toRow : 7 - toRow;
            const displayToCol = orient ? toCol : 7 - toCol;
            const x1 = (displayFromCol + 0.5) * (100 / 8);
            const y1 = (displayFromRow + 0.5) * (100 / 8);
            const x2 = (displayToCol + 0.5) * (100 / 8);
            const y2 = (displayToRow + 0.5) * (100 / 8);
            // Shorten line so arrowhead sits nicely inside squares
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const offset = 2; // percentage units
            const nx1 = x1 + (dx / len) * offset;
            const ny1 = y1 + (dy / len) * offset;
            const nx2 = x2 - (dx / len) * offset;
            const ny2 = y2 - (dy / len) * offset;
            const color = a.color === "w" ? "#10b981" : "#f43f5e";
            const marker = a.color === "w" ? "url(#arrowhead-white)" : "url(#arrowhead-black)";
            return (
              <g key={`${a.from}-${a.to}-${i}`}>
                <line
                  x1={nx1}
                  y1={ny1}
                  x2={nx2}
                  y2={ny2}
                  stroke={color}
                  strokeWidth={1.6}
                  markerEnd={marker}
                  opacity={0.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <text
                  x={(nx1 + nx2) / 2}
                  y={(ny1 + ny2) / 2 - 1.5}
                  textAnchor="middle"
                  fontSize="3.2"
                  fill="#0f172a"
                  stroke="white"
                  strokeWidth="0.6"
                  paintOrder="stroke"
                >
                  {a.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

export default function Home() {
  const [states, setStates] = useState<GameState[]>(() => [initialState()]);
  const [cursor, setCursor] = useState(0);
  const state = states[cursor];
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [movePanel, setMovePanel] = useState<"best" | "blunder">("best");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("guide");
  const [history, setHistory] = useState<string[]>([]);
  const [freeMode, setFreeMode] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selectedPiece, setSelectedPiece] = useState<Piece>({ color: "w", type: "p" });
  const [engineReady, setEngineReady] = useState(false);
  const [engineThinking, setEngineThinking] = useState(false);
  const [engineLine, setEngineLine] = useState<{
    bestmove: string;
    depth: number;
    score: string;
    pv: string[];
  } | null>(null);
  const [enginePvList, setEnginePvList] = useState<
    { multipv: number; move: string; score: string; depth: number; pv: string[] }[]
  >([]);
  const [engineOptionsSent, setEngineOptionsSent] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineWorkerRef = useRef<Worker | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [lastAnalyzedFen, setLastAnalyzedFen] = useState<string | null>(null);
  const [accuracyTarget, setAccuracyTarget] = useState(90); // 50-100 scale for user intent
  const [moves, setMoves] = useState<Move[]>([]);
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null);
  type LiveAnalysis = {
    type: "analysis";
    source: string;
    tabId: number | null;
    fen: string;
    generatedAt: number;
    id: string;
    bestMoves: { uci: string; score: string; depth: number; pv: string[] }[];
  };
  const [liveAnalysis, setLiveAnalysis] = useState<LiveAnalysis | null>(null);
  const [streamStatus, setStreamStatus] = useState<"idle" | "open" | "error">("idle");
  const topWhiteMoves = useMemo<ScoredMove[]>(() => {
    const asWhite: GameState = { ...state, turn: "w" };
    return scoreMoves(asWhite, 3).slice(0, 3);
  }, [state]);

  const topBlackMoves = useMemo<ScoredMove[]>(() => {
    const asBlack: GameState = { ...state, turn: "b" };
    return scoreMoves(asBlack, 3).slice(0, 3);
  }, [state]);

  const previewArrows = useMemo(
    () => [
      ...topWhiteMoves.map((s, i) => ({ from: s.move.from, to: s.move.to, color: "w" as Color, label: `W${i + 1}` })),
      ...topBlackMoves.map((s, i) => ({ from: s.move.from, to: s.move.to, color: "b" as Color, label: `B${i + 1}` })),
    ],
    [topWhiteMoves, topBlackMoves],
  );

  const scoredMoves = useMemo(() => scoreMoves(state, 3), [state]);
  const accuracyFriendlyMoves = useMemo(() => {
    if (scoredMoves.length === 0) return [];
    const bestScore = scoredMoves[0].score;
    const maxDrop = Math.max(10, (100 - accuracyTarget) * 5); // e.g. 90 -> 50cp, 80 -> 100cp
    return scoredMoves.filter((s) => bestScore - s.score <= maxDrop).slice(0, 10);
  }, [scoredMoves, accuracyTarget]);
  const bestMoves = useMemo(() => scoredMoves.slice(0, 20), [scoredMoves]);
  const blunderMoves = useMemo(() => {
    if (scoredMoves.length <= 20) return [...scoredMoves].reverse();
    return scoredMoves.slice(-20).reverse();
  }, [scoredMoves]);
  const bestMovesCompact = useMemo(() => bestMoves.slice(0, 10), [bestMoves]);
  const blunderMovesCompact = useMemo(() => blunderMoves.slice(0, 10), [blunderMoves]);
  const status = useMemo(() => gameStatus(state), [state]);

  const canUndo = cursor > 0;
  const canRedo = cursor < states.length - 1;
  const visibleHistory = history.slice(0, cursor);

  useEffect(() => {
    const worker = new Worker("/stockfish-18-lite.js");

    worker.onmessage = (event) => {
      const payload = event.data ?? "";
      const line = typeof payload === "string" ? payload : payload.line ?? "";
      if (payload?.error) {
        setEngineError(payload.error);
        setEngineThinking(false);
        return;
      }
      if (typeof line !== "string" || !line) return;

      if (line.includes("uciok") || line.includes("readyok")) {
        setEngineReady(true);
        if (!engineOptionsSent) {
          worker.postMessage("setoption name MultiPV value 20");
          setEngineOptionsSent(true);
        }
      }

      if (line.startsWith("info ")) {
        const parts = line.split(" ");
        const depthIdx = parts.indexOf("depth");
        const scoreIdx = parts.indexOf("score");
        const pvIdx = parts.indexOf("pv");
        const multipvIdx = parts.indexOf("multipv");

        const depth = depthIdx >= 0 ? Number(parts[depthIdx + 1]) : undefined;
        let scoreText: string | null = null;
        if (scoreIdx >= 0) {
          const scoreType = parts[scoreIdx + 1];
          const raw = Number(parts[scoreIdx + 2]);
          if (scoreType === "cp") scoreText = (raw / 100).toFixed(2);
          if (scoreType === "mate") scoreText = `Mate in ${raw}`;
        }
        const pv = pvIdx >= 0 ? parts.slice(pvIdx + 1) : [];
        const multipv = multipvIdx >= 0 ? Number(parts[multipvIdx + 1]) : 1;
        const moveFromPv = pv[0] ?? "";

        if (depth !== undefined && scoreText !== null) {
          setEngineLine((prev) => {
            if (prev && depth < prev.depth) return prev;
            return {
              bestmove: prev?.bestmove ?? (multipv === 1 ? moveFromPv : ""),
              depth,
              score: scoreText ?? prev?.score ?? "0.00",
              pv,
            };
          });

          setEnginePvList((prev) => {
            const next = [...prev];
            const idx = next.findIndex((p) => p.multipv === multipv);
            const entry = {
              multipv,
              move: moveFromPv,
              score: scoreText ?? "0.00",
              depth: depth ?? 0,
              pv,
            };
            if (idx >= 0) {
              if (depth >= next[idx].depth) next[idx] = entry;
            } else {
              next.push(entry);
            }
            return next.sort((a, b) => a.multipv - b.multipv).slice(0, 20);
          });
        }
      }

      if (line.startsWith("bestmove")) {
        const tokens = line.split(" ");
        const bestmove = tokens[1];
        setEngineThinking(false);
        setEngineLine((prev) => ({
          bestmove,
          depth: prev?.depth ?? 0,
          score: prev?.score ?? "0.00",
          pv: prev?.pv?.length ? prev.pv : [bestmove],
        }));
      }
    };

    worker.postMessage("uci");
    worker.postMessage("isready");
    engineWorkerRef.current = worker;

    return () => {
      worker.terminate();
      engineWorkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setStreamStatus("open");
    es.onerror = () => setStreamStatus("error");
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data ?? "{}");
        if (payload?.type === "analysis") {
          setLiveAnalysis(payload);
        }
      } catch {
        // ignore parse errors
      }
    };
    return () => es.close();
  }, []);

  const uciToMove = useCallback(
    (uci: string): Move | null => {
      if (!uci || uci.length < 4) return null;
      const fileFrom = uci.charCodeAt(0) - 97;
      const rankFrom = Number(uci[1]);
      const fileTo = uci.charCodeAt(2) - 97;
      const rankTo = Number(uci[3]);
      if (
        Number.isNaN(rankFrom) ||
        Number.isNaN(rankTo) ||
        fileFrom < 0 ||
        fileFrom > 7 ||
        fileTo < 0 ||
        fileTo > 7
      ) {
        return null;
      }

      const from = (8 - rankFrom) * 8 + fileFrom;
      const to = (8 - rankTo) * 8 + fileTo;
      const promoChar = uci[4];
      const promotion = promoChar ? (promoChar as PieceType) : undefined;

      const legal = generateLegalMoves(state).find(
        (m) => m.from === from && m.to === to && (!m.promotion || m.promotion === promotion),
      );
      return legal ? { ...legal, promotion: promotion ?? legal.promotion } : null;
    },
    [state],
  );

  const askEngine = useCallback(
    (depth = 14, rememberFen = true) => {
      const engineWorker = engineWorkerRef.current;
      if (!engineWorker) return;
      const fen = toFen(state);
      if (rememberFen) setLastAnalyzedFen(fen);
      setEngineThinking(true);
      setEngineLine(null);
      setEnginePvList([]);
      setEngineError(null);
      engineWorker.postMessage("stop");
      engineWorker.postMessage("ucinewgame");
      engineWorker.postMessage(`position fen ${fen}`);
      engineWorker.postMessage(`go multipv 20 depth ${depth}`);
    },
    [state],
  );

  const playMove = (move: Move) => {
    const current = state;
    setStates((prev) => {
      const trimmed = prev.slice(0, cursor + 1);
      const next = makeMove(current, move);
      return [...trimmed, next];
    });
    setCursor((c) => c + 1);
    setMoves((prev) => {
      const trimmed = prev.slice(0, cursor);
      const next = [...trimmed, move];
      setLastMove({ from: move.from, to: move.to });
      return next;
    });
    setHistory((h) => {
      const trimmed = h.slice(0, cursor);
      return [
        ...trimmed,
        `${current.turn === "w" ? current.fullmove : `${current.fullmove}...`} ${formatMove(move)}`,
      ];
    });
  };

  // Auto-trigger analysis after each move when enabled and engine is idle.
  useEffect(() => {
    if (!autoAnalyze || !engineReady || engineThinking) return;
    const fen = toFen(state);
    if (fen === lastAnalyzedFen) return;
    askEngine(14, true);
  }, [autoAnalyze, engineReady, engineThinking, state, lastAnalyzedFen, askEngine]);

  const undo = () => {
    if (!canUndo) return;
    setCursor((c) => {
      const next = Math.max(0, c - 1);
      setLastMove((moves[next - 1] ?? null) as { from: number; to: number } | null);
      return next;
    });
  };

  const redo = () => {
    if (!canRedo) return;
    setCursor((c) => {
      const next = Math.min(states.length - 1, c + 1);
      setLastMove((moves[next - 1] ?? null) as { from: number; to: number } | null);
      return next;
    });
  };

  const cloneBoard = (s: GameState): GameState => ({
    board: [...s.board.map((p) => (p ? { ...p } : null))],
    turn: s.turn,
    castling: { ...s.castling },
    enPassant: s.enPassant,
    halfmove: s.halfmove,
    fullmove: s.fullmove,
  });

  const freeMove = (from: number, to: number) => {
    const current = state;
    const piece = current.board[from];
    if (!piece || from === to) return;
    const next = cloneBoard(current);
    next.board[from] = null;
    next.board[to] = piece;
    setStates((prev) => [...prev.slice(0, cursor + 1), next]);
    setCursor((c) => c + 1);
    setMoves((prev) => {
      const trimmed = prev.slice(0, cursor);
      const move = { from, to };
      setLastMove(move);
      return [...trimmed, move];
    });
    setHistory((h) => [
      ...h.slice(0, cursor),
      `✦ Free move: ${squareLabel(from)} → ${squareLabel(to)} (${piece.color}${piece.type})`,
    ]);
  };

  const removePiece = (idx: number) => {
    const current = state;
    const piece = current.board[idx];
    if (!piece) return;
    const next = cloneBoard(current);
    next.board[idx] = null;
    setStates((prev) => [...prev.slice(0, cursor + 1), next]);
    setCursor((c) => c + 1);
    setMoves((prev) => {
      const trimmed = prev.slice(0, cursor);
      const move = { from: idx, to: idx };
      setLastMove(move);
      return [...trimmed, move];
    });
    setHistory((h) => [
      ...h.slice(0, cursor),
      `✖ Removed: ${squareLabel(idx)} (${piece.color}${piece.type})`,
    ]);
  };

  const placePiece = (idx: number, pieceOverride?: Piece) => {
    const piece = pieceOverride ?? selectedPiece;
    if (!piece) return;
    const next = cloneBoard(state);
    const replaced = next.board[idx];
    next.board[idx] = { ...piece };
    setStates((prev) => [...prev.slice(0, cursor + 1), next]);
    setCursor((c) => c + 1);
    setMoves((prev) => {
      const trimmed = prev.slice(0, cursor);
      const move = { from: idx, to: idx };
      setLastMove(move);
      return [...trimmed, move];
    });
    setHistory((h) => [
      ...h.slice(0, cursor),
      `${replaced ? "↻ Replaced" : "＋ Added"}: ${squareLabel(idx)} (${piece.color}${piece.type})`,
    ]);
  };

  const reset = () => {
    setStates([initialState()]);
    setCursor(0);
    setHistory([]);
    setMoves([]);
    setLastMove(null);
    setPlacementMode(false);
    setSelectedPiece({ color: "w", type: "p" });
  };

  const loadLivePosition = () => {
    if (!liveAnalysis?.fen) return;
    const parsed = fenToState(liveAnalysis.fen);
    if (!parsed) return;
    setStates([parsed]);
    setCursor(0);
    setHistory([]);
    setMoves([]);
    setLastMove(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 md:flex-row md:gap-12">
        <div className="flex flex-1 flex-col gap-4 md:sticky md:top-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center whitespace-nowrap gap-3">
              <div className="rounded-full border border-emerald-300 bg-white shadow-sm p-1">
                <button
                  onClick={() => setPlayerColor("w")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${playerColor === "w"
                    ? "bg-emerald-500 text-white shadow"
                    : "text-emerald-700 hover:text-emerald-900"
                    }`}
                >
                  I am White
                </button>
                <button
                  onClick={() => setPlayerColor("b")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${playerColor === "b"
                    ? "bg-emerald-500 text-white shadow"
                    : "text-emerald-700 hover:text-emerald-900"
                    }`}
                >
                  I am Black
                </button>
              </div>
              <button
                onClick={() =>
                  setFreeMode((v) => {
                    const next = !v;
                    if (!next) setPlacementMode(false);
                    return next;
                  })
                }
                className={`rounded-full px-3 py-2 text-xs font-semibold transition ${freeMode
                  ? "border border-amber-400 bg-amber-100 text-amber-900 shadow"
                  : "border border-slate-200 text-slate-800 hover:bg-slate-100"
                  }`}
              >
                {freeMode ? "Free edit ON" : "Free edit OFF"}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  className="rounded-full border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Undo
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  className="rounded-full border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Redo
                </button>
              </div>
              <button
                onClick={reset}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-emerald-500/30 transition hover:translate-y-[-1px] hover:bg-emerald-500"
              >
                New game
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-200/50 bg-white/90 p-4 shadow-xl shadow-emerald-100">
            <div className="mb-3 flex items-center justify-between text-sm font-medium text-emerald-900">
              <span>{status}</span>
              <span className="rounded-full border border-emerald-300 px-3 py-1 text-xs uppercase tracking-wide text-emerald-800 bg-emerald-50">
                {state.turn === "w" ? "White" : "Black"} to move
              </span>
            </div>
            <Board
              key={cursor}
              state={state}
              onMove={playMove}
              onFreeMove={freeMode ? freeMove : () => {}}
              onPlacePiece={freeMode ? placePiece : undefined}
              perspective={playerColor}
              freeMode={freeMode}
              placementMode={placementMode}
              arrows={previewArrows}
              lastMove={lastMove}
            />
            {freeMode && (
              <div className="mt-3 space-y-2 rounded-2xl border border-emerald-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setPaletteOpen((v) => !v)}
                    className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
                  >
                    {paletteOpen ? "Hide palette" : "Show palette"}
                  </button>
                  <div className="flex overflow-hidden rounded-full border border-emerald-200 bg-white shadow-sm">
                    <button
                      onClick={() => setSelectedPiece((p) => ({ ...p, color: "w" }))}
                      className={`px-3 py-1 text-xs font-semibold transition ${selectedPiece.color === "w"
                        ? "bg-emerald-500 text-white"
                        : "text-emerald-800 hover:bg-emerald-50"
                        }`}
                    >
                      White
                    </button>
                    <button
                      onClick={() => setSelectedPiece((p) => ({ ...p, color: "b" }))}
                      className={`px-3 py-1 text-xs font-semibold transition ${selectedPiece.color === "b"
                        ? "bg-emerald-500 text-white"
                        : "text-emerald-800 hover:bg-emerald-50"
                        }`}
                    >
                      Black
                    </button>
                  </div>
                  <button
                    onClick={() => setPlacementMode((v) => !v)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${placementMode
                      ? "bg-emerald-600 text-white shadow"
                      : "border border-emerald-200 text-emerald-800 hover:bg-emerald-100"
                      }`}
                  >
                    {placementMode ? "Tap squares to place" : "Place mode off"}
                  </button>
                </div>

                {paletteOpen && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {pieceTypes.map((t) => {
                      const piece = { color: selectedPiece.color, type: t as PieceType };
                      const selected = selectedPiece.type === t;
                      return (
                        <button
                          key={`palette-${piece.color}-${t}`}
                          onClick={() => setSelectedPiece(piece)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/x-chess-piece", JSON.stringify(piece));
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          className={`flex h-14 w-14 min-w-[56px] items-center justify-center rounded-xl border transition ${selected
                            ? "border-emerald-500 bg-white shadow"
                            : "border-emerald-100 bg-white hover:border-emerald-400"
                            }`}
                          title="Drag to board or tap a square in place mode"
                        >
                          <PieceIcon color={piece.color} type={piece.type} />
                        </button>
                      );
                    })}
                  </div>
                )}

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromIdx = Number(e.dataTransfer.getData("text/plain"));
                    if (!Number.isNaN(fromIdx)) removePiece(fromIdx);
                  }}
                  className="flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900"
                >
                  Drop here to delete a piece
                </div>
              </div>
            )}
            <p className="mt-3 text-xs text-emerald-900/70">
              Tip: drag or click a piece to see its legal moves. Promotions auto-queen for speed.
              {" "}
              {freeMode &&
                "Free edit lets you move any piece anywhere, drag new pieces from the palette, or drop any piece in the bin to remove."}
            </p>
          </div>
        </div>

        <aside className="w-full max-w-md space-y-4 rounded-3xl border border-emerald-200/60 bg-white/90 p-5 shadow-xl shadow-emerald-100">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900 shadow-inner">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Live Tab Trainer</p>
              <span
                className={`h-2 w-2 rounded-full ${streamStatus === "open"
                  ? "bg-emerald-500"
                  : streamStatus === "error"
                    ? "bg-rose-500"
                    : "bg-amber-400"
                  }`}
                title={streamStatus}
              />
            </div>
            <p className="mt-1 text-xs text-emerald-800/80">
              Requires Chrome extension (load from /tmp/chess-trainer-ext). Opens SSE to receive best moves from your active chess.com tab.
            </p>
            {liveAnalysis ? (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-emerald-700">Best move</p>
                    <p className="text-sm font-semibold text-emerald-900">{liveAnalysis?.bestMoves?.[0]?.uci ?? "…"}</p>
                  </div>
                  <div className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                    {liveAnalysis?.bestMoves?.[0]?.score ?? "–"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={loadLivePosition}
                    className="flex-1 rounded-full border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  >
                    Load position to board
                  </button>
                  <button
                    onClick={() => {
                      if (liveAnalysis?.fen) navigator.clipboard?.writeText(liveAnalysis.fen);
                    }}
                    className="rounded-full border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  >
                    Copy FEN
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-emerald-800/70">Waiting for first analysis… move a piece on chess.com.</p>
            )}
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900">
            {([
              ["guide", "Guide"],
              ["engine", "Engine"],
              ["history", "History"],
            ] as [SidebarTab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSidebarTab(key as typeof sidebarTab)}
                className={`px-3 py-2 transition ${sidebarTab === key
                  ? "bg-emerald-500 text-white shadow"
                  : "hover:bg-emerald-100"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          {sidebarTab === "guide" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-800">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-900">Accuracy-friendly</p>
                  <span className="text-[11px] font-semibold text-emerald-700">
                    Δcp ≤ ~{Math.max(10, (100 - accuracyTarget) * 5)}{" "}
                  </span>
                </div>
                {accuracyFriendlyMoves.length === 0 ? (
                  <p className="mt-1 text-slate-700/70">No moves within your target. Consider relaxing accuracy.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {accuracyFriendlyMoves.slice(0, 6).map((item, i) => {
                      const drop = accuracyFriendlyMoves[0].score - item.score;
                      return (
                        <div
                          key={`${moveKey(item.move)}-acc-${i}`}
                          className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs"
                        >
                          <div>
                            <p className="font-semibold text-emerald-900">
                              {i + 1}. {formatMove(item.move)}
                            </p>
                            <p className="text-emerald-800/70">
                              Eval: {(item.score / 100).toFixed(2)} · Drop {drop.toFixed(0)}cp
                            </p>
                          </div>
                          <button
                            onClick={() => playMove(item.move)}
                            className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-white shadow hover:bg-emerald-400"
                          >
                            Play
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-emerald-900">Move explorer</h2>
                <div className="grid grid-cols-2 overflow-hidden rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900">
                  <button
                    onClick={() => setMovePanel("best")}
                    className={`px-3 py-1 transition ${movePanel === "best" ? "bg-emerald-500 text-white shadow" : "hover:bg-emerald-100"
                      }`}
                  >
                    Best (10)
                  </button>
                  <button
                    onClick={() => setMovePanel("blunder")}
                    className={`px-3 py-1 transition ${movePanel === "blunder" ? "bg-rose-500 text-white shadow" : "hover:bg-rose-100"
                      }`}
                  >
                    Blunders (10)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={movePanel === "best" ? !bestMovesCompact.length : !blunderMovesCompact.length}
                  onClick={() => {
                    const list = movePanel === "best" ? bestMovesCompact : blunderMovesCompact;
                    if (list[0]) playMove(list[0].move);
                  }}
                  className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${movePanel === "best"
                    ? "border border-emerald-400 text-emerald-800 hover:bg-emerald-500 hover:text-white"
                    : "border border-rose-300 text-rose-900 hover:bg-rose-500 hover:text-white"
                    }`}
                >
                  {movePanel === "best" ? "Play top move" : "Play blunder"}
                </button>
                <button
                  onClick={() => setMovePanel((p) => (p === "best" ? "blunder" : "best"))}
                  className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Swap
                </button>
              </div>

              <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                {(movePanel === "best" ? bestMovesCompact : blunderMovesCompact).length === 0 && (
                  <p className="text-sm text-emerald-800/80">No legal moves left.</p>
                )}
                {(movePanel === "best" ? bestMovesCompact : blunderMovesCompact).map((item, i) => {
                  const isBest = movePanel === "best";
                  const border = isBest
                    ? "border-emerald-200/60 hover:border-emerald-400"
                    : "border-rose-200/80 hover:border-rose-400";
                  const bg = isBest ? "bg-white hover:bg-emerald-50" : "bg-rose-50 hover:bg-rose-100";
                  const pillBg = isBest ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800";
                  const text = isBest ? "text-emerald-900" : "text-rose-900";
                  const subtext = isBest ? "text-emerald-800/70" : "text-rose-800/70";
                  return (
                    <button
                      key={`${moveKey(item.move)}-${movePanel}-${i}`}
                      onClick={() => playMove(item.move)}
                      className={`flex w-full items-center justify-between rounded-2xl border ${border} ${bg} px-3 py-3 text-left transition`}
                    >
                      <div>
                        <p className={`text-sm font-semibold ${text}`}>
                          #{i + 1} · {formatMove(item.move)}
                        </p>
                        <p className={`text-xs ${subtext}`}>
                          Eval (White perspective): {(item.score / 100).toFixed(2)}
                        </p>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs font-semibold ${pillBg}`}>
                        {(item.score / 100).toFixed(2)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {sidebarTab === "engine" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200/60 bg-white p-3 text-sm text-emerald-900/80">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-emerald-900">Stockfish Lite</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${engineReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                      }`}
                  >
                    {engineReady ? "Ready" : "Warming up"}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-emerald-800">
                  <span>Auto-analyze after each move</span>
                  <button
                    onClick={() => setAutoAnalyze((v) => !v)}
                    className={`rounded-full px-3 py-1 transition ${autoAnalyze
                      ? "bg-emerald-500 text-white shadow"
                      : "border border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                      }`}
                  >
                    {autoAnalyze ? "On" : "Off"}
                  </button>
                </div>

                <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Accuracy target</span>
                    <span>{accuracyTarget}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={accuracyTarget}
                    onChange={(e) => setAccuracyTarget(Number(e.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer accent-emerald-500"
                  />
                  <p className="mt-1 text-[11px] text-emerald-800/80">
                    Shows moves within a small eval drop of the best line so you can play to that level.
                  </p>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => askEngine(14, true)}
                    disabled={!engineReady || engineThinking}
                    className="flex-1 rounded-full border border-emerald-400 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {engineThinking ? "Thinking..." : "Analyze depth 14"}
                  </button>
                  <button
                    onClick={() => {
                      if (!engineLine?.bestmove) return;
                      const move = uciToMove(engineLine.bestmove);
                      if (move) playMove(move);
                    }}
                    disabled={!engineLine?.bestmove}
                    className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Play suggestion
                  </button>
                </div>

                <div className="mt-2 space-y-1 text-xs text-emerald-800/80">
                  {engineError && (
                    <p className="text-rose-700">
                      Engine error: {engineError}. Reload after ensuring COOP/COEP headers.
                    </p>
                  )}
                  {!engineError && engineLine ? (
                    <>
                      <p>
                        Best move:{" "}
                        <span className="font-semibold text-emerald-900">
                          {engineLine.bestmove || "(pending)"}
                        </span>{" "}
                        · depth {engineLine.depth} · eval {engineLine.score}
                      </p>
                      {engineLine.pv.length > 0 && (
                        <p className="text-emerald-800/70">
                          PV: {engineLine.pv.slice(0, 8).join(" ")}
                          {engineLine.pv.length > 8 ? " …" : ""}
                        </p>
                      )}
                    </>
                  ) : (
                    <p>No analysis yet. Hit “Analyze”.</p>
                  )}
                </div>

                {!engineError && enginePvList.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                      Top lines (10)
                    </p>
                    <div className="mt-2 space-y-1 max-h-64 overflow-auto pr-1">
                      {enginePvList.slice(0, 10).map((pv) => (
                        <button
                          key={`pv-${pv.multipv}`}
                          onClick={() => {
                            const move = uciToMove(pv.move);
                            if (move) playMove(move);
                          }}
                          className="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-white px-3 py-2 text-left text-xs font-medium text-emerald-900 transition hover:border-emerald-400 hover:bg-emerald-100"
                        >
                          <span className="flex items-center gap-2">
                            <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-900">
                              #{pv.multipv}
                            </span>
                            <span className="font-semibold">{pv.move || "(pending)"}</span>
                            <span className="text-emerald-700">· depth {pv.depth}</span>
                          </span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            {pv.score}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {sidebarTab === "history" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200/60 bg-white p-3 text-sm text-emerald-900/80">
                <p className="font-semibold text-emerald-900">Move history</p>
                {visibleHistory.length === 0 ? (
                  <p className="mt-1 text-emerald-800/70">No moves yet.</p>
                ) : (
                  <div className="mt-2 grid grid-cols-1 gap-1 text-emerald-900">
                    {visibleHistory.slice(-20).map((h, idx) => (
                      <div
                        key={`${h}-${idx}`}
                        className="rounded-lg border border-emerald-200/60 bg-emerald-50 px-3 py-2 text-xs"
                      >
                        {h}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200/60 bg-white p-3 text-sm text-emerald-900/80">
                <p className="font-semibold text-emerald-900">How to use</p>
                <ul className="mt-2 space-y-1 pl-4">
                  <li className="list-disc">Click a piece, then a highlighted square to move.</li>
                  <li className="list-disc">Use “Play top move” to let the helper execute its favorite line.</li>
                  <li className="list-disc">Want to switch sides? Just start moving the other color.</li>
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
