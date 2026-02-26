"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type PieceType,
  type Color,
} from "@/lib/chessEngine";

const pieceName: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

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
  (row + col) % 2 === 0 ? "bg-white" : "bg-emerald-600";

const labelColor = (row: number, col: number) =>
  (row + col) % 2 === 0 ? "text-emerald-700" : "text-emerald-50";

const pieceColor = (color: "w" | "b") => (color === "w" ? "text-slate-900" : "text-black");

const Board = ({
  state,
  onMove,
  onFreeMove,
  perspective,
  freeMode,
}: {
  state: GameState;
  onMove: (move: Move) => void;
  onFreeMove: (from: number, to: number) => void;
  perspective: "w" | "b";
  freeMode: boolean;
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
    const highlight =
      isSelected || isTarget
        ? "ring-2 ring-amber-400 shadow-[0_0_0_3px] shadow-amber-200/40"
        : "";

    return (
      <button
        key={idx}
        onClick={() => handleSquare(idx)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
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
            <span className="h-4 w-4 rounded-full bg-amber-300/80 shadow shadow-amber-500/40" />
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
    <div className="grid grid-cols-8 overflow-hidden rounded-2xl border border-slate-800/50 shadow-2xl shadow-emerald-500/10 backdrop-blur">
      {order.map((idx) => renderSquare(idx))}
    </div>
  );
};

export default function Home() {
  const [states, setStates] = useState<GameState[]>(() => [initialState()]);
  const [cursor, setCursor] = useState(0);
  const state = states[cursor];
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [movePanel, setMovePanel] = useState<"best" | "blunder">("best");
  const [history, setHistory] = useState<string[]>([]);
  const [freeMode, setFreeMode] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineThinking, setEngineThinking] = useState(false);
  const [engineLine, setEngineLine] = useState<{
    bestmove: string;
    depth: number;
    score: string;
    pv: string[];
  } | null>(null);
  const [engineWorker, setEngineWorker] = useState<Worker | null>(null);

  const scoredMoves = useMemo(() => scoreMoves(state, 3), [state]);
  const bestMoves = useMemo(() => scoredMoves.slice(0, 20), [scoredMoves]);
  const blunderMoves = useMemo(() => {
    if (scoredMoves.length <= 20) return [...scoredMoves].reverse();
    return scoredMoves.slice(-20).reverse();
  }, [scoredMoves]);
  const status = useMemo(() => gameStatus(state), [state]);

  const canUndo = cursor > 0;
  const canRedo = cursor < states.length - 1;
  const visibleHistory = history.slice(0, cursor);

  useEffect(() => {
    const worker = new Worker("/stockfish-18-lite.js");

    worker.onmessage = (event) => {
      const payload = event.data ?? "";
      const line = typeof payload === "string" ? payload : payload.line ?? "";
      if (!line) return;

      if (line.includes("uciok") || line.includes("readyok")) {
        setEngineReady(true);
      }

      if (line.startsWith("info ")) {
        const parts = line.split(" ");
        const depthIdx = parts.indexOf("depth");
        const scoreIdx = parts.indexOf("score");
        const pvIdx = parts.indexOf("pv");

        const depth = depthIdx >= 0 ? Number(parts[depthIdx + 1]) : undefined;
        let scoreText: string | null = null;
        if (scoreIdx >= 0) {
          const scoreType = parts[scoreIdx + 1];
          const raw = Number(parts[scoreIdx + 2]);
          if (scoreType === "cp") scoreText = (raw / 100).toFixed(2);
          if (scoreType === "mate") scoreText = `Mate in ${raw}`;
        }
        const pv = pvIdx >= 0 ? parts.slice(pvIdx + 1) : [];

        if (depth !== undefined && scoreText !== null) {
          setEngineLine((prev) => {
            if (prev && depth < prev.depth) return prev;
            return {
              bestmove: prev?.bestmove ?? "",
              depth,
              score: scoreText ?? prev?.score ?? "0.00",
              pv,
            };
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
    setEngineWorker(worker);

    return () => {
      worker.terminate();
    };
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
    (depth = 14) => {
      if (!engineWorker) return;
      const fen = toFen(state);
      setEngineThinking(true);
      setEngineLine(null);
      engineWorker.postMessage("stop");
      engineWorker.postMessage("ucinewgame");
      engineWorker.postMessage(`position fen ${fen}`);
      engineWorker.postMessage(`go depth ${depth}`);
    },
    [engineWorker, state],
  );

  const playMove = (move: Move) => {
    const current = state;
    setStates((prev) => {
      const trimmed = prev.slice(0, cursor + 1);
      const next = makeMove(current, move);
      return [...trimmed, next];
    });
    setCursor((c) => c + 1);
    setHistory((h) => {
      const trimmed = h.slice(0, cursor);
      return [
        ...trimmed,
        `${current.turn === "w" ? current.fullmove : `${current.fullmove}...`} ${formatMove(move)}`,
      ];
    });
  };

  const undo = () => {
    if (!canUndo) return;
    setCursor((c) => Math.max(0, c - 1));
  };

  const redo = () => {
    if (!canRedo) return;
    setCursor((c) => Math.min(states.length - 1, c + 1));
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
    setHistory((h) => [
      ...h.slice(0, cursor),
      `✖ Removed: ${squareLabel(idx)} (${piece.color}${piece.type})`,
    ]);
  };

  const reset = () => {
    setStates([initialState()]);
    setCursor(0);
    setHistory([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 md:flex-row md:gap-12">
        <div className="flex flex-1 flex-col gap-4">
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
                onClick={() => setFreeMode((v) => !v)}
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
              onFreeMove={freeMode ? freeMove : () => { }}
              perspective={playerColor}
              freeMode={freeMode}
            />
            {freeMode && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromIdx = Number(e.dataTransfer.getData("text/plain"));
                  if (!Number.isNaN(fromIdx)) removePiece(fromIdx);
                }}
                className="mt-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900"
              >
                Drag a piece here to remove it
              </div>
            )}
            <p className="mt-3 text-xs text-emerald-900/70">
              Tip: drag or click a piece to see its legal moves. Promotions auto-queen for speed.
              {" "}
              {freeMode && "Free edit lets you move any piece anywhere or drop it in the bin to remove."}
            </p>
          </div>
        </div>

        <aside className="w-full max-w-md space-y-4 rounded-3xl border border-emerald-200/60 bg-white/90 p-5 shadow-xl shadow-emerald-100">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-emerald-900">Move explorer</h2>
            <div className="grid grid-cols-2 overflow-hidden rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900">
              <button
                onClick={() => setMovePanel("best")}
                className={`px-3 py-1 transition ${movePanel === "best" ? "bg-emerald-500 text-white shadow" : "hover:bg-emerald-100"
                  }`}
              >
                Best (20)
              </button>
              <button
                onClick={() => setMovePanel("blunder")}
                className={`px-3 py-1 transition ${movePanel === "blunder" ? "bg-rose-500 text-white shadow" : "hover:bg-rose-100"
                  }`}
              >
                Blunders (20)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={movePanel === "best" ? !bestMoves.length : !blunderMoves.length}
              onClick={() => {
                const list = movePanel === "best" ? bestMoves : blunderMoves;
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

          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
            {(movePanel === "best" ? bestMoves : blunderMoves).length === 0 && (
              <p className="text-sm text-emerald-800/80">No legal moves left.</p>
            )}
            {(movePanel === "best" ? bestMoves : blunderMoves).map((item, i) => {
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

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => askEngine(14)}
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
              {engineLine ? (
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
          </div>

          <div className="rounded-2xl border border-emerald-200/60 bg-white p-3 text-sm text-emerald-900/80">
            <p className="font-semibold text-emerald-900">Move history</p>
            {visibleHistory.length === 0 ? (
              <p className="mt-1 text-emerald-800/70">No moves yet.</p>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-1 text-emerald-900">
                {visibleHistory.slice(-16).map((h, idx) => (
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
        </aside>
      </div>
    </div>
  );
}
