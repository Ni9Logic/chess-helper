import { spawn } from "child_process";
import readline from "readline";
import path from "path";
import crypto from "crypto";

export type EngineResult = {
  id: string;
  bestMoves: {
    uci: string;
    score: string;
    depth: number;
    pv: string[];
  }[];
};

type InfoLine = {
  depth?: number;
  score?: string;
  multipv?: number;
  move?: string;
  pv?: string[];
};

// Use lite single-threaded for faster turnaround while keeping full UCI.
const ENGINE_PATH = path.join(process.cwd(), "node_modules/stockfish/bin/stockfish-18-lite-single.js");

export const analyzeFenWithStockfish = async (
  fen: string,
  depth = 12,
  multipv = 3,
  skillLevel = 20,
): Promise<EngineResult> => {
  return new Promise<EngineResult>((resolve, reject) => {
    const id = crypto.randomUUID();
    const child = spawn(process.execPath, [ENGINE_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    const rl = readline.createInterface({ input: child.stdout });

    const lines: Record<number, InfoLine> = {};
    let bestmove: string | null = null;

    let finished = false;
    const cleanup = (err?: Error, result?: EngineResult) => {
      if (finished) return;
      finished = true;
      rl.close();
      child.kill();
      if (err) reject(err);
      else if (result) resolve(result);
      else resolve({ id, bestMoves: [] });
    };

    let ready = false;

    const startSearch = () => {
      child.stdin.write(`setoption name MultiPV value ${multipv}\n`);
      child.stdin.write(`setoption name Skill Level value ${skillLevel}\n`);
      child.stdin.write("ucinewgame\n");
      child.stdin.write(`position fen ${fen}\n`);
      child.stdin.write(`go depth ${depth} multipv ${multipv}\n`);
    };

    rl.on("line", (line) => {
      const text = line.trim();
      if (text === "readyok" && !ready) {
        ready = true;
        startSearch();
        return;
      }
      if (text.startsWith("info ")) {
        const parts = text.split(/\s+/);
        const info: InfoLine = {};
        const idx = (key: string) => parts.indexOf(key);
        const depthIdx = idx("depth");
        if (depthIdx > -1) info.depth = Number(parts[depthIdx + 1]);
        const multipvIdx = idx("multipv");
        if (multipvIdx > -1) info.multipv = Number(parts[multipvIdx + 1]);
        const scoreIdx = idx("score");
        if (scoreIdx > -1) {
          const type = parts[scoreIdx + 1];
          const raw = Number(parts[scoreIdx + 2]);
          info.score = type === "cp" ? (raw / 100).toFixed(2) : `Mate ${raw}`;
        }
        const pvIdx = idx("pv");
        if (pvIdx > -1) info.pv = parts.slice(pvIdx + 1);
        const moveIdx = pvIdx > -1 ? pvIdx + 1 : -1;
        if (moveIdx > -1) info.move = parts[moveIdx];
        const key = info.multipv ?? 1;
        if (info.depth !== undefined && info.score && info.move) {
          const existing = lines[key];
          if (!existing || (existing.depth ?? 0) <= info.depth) {
            lines[key] = info;
          }
        }
      }
      if (text.startsWith("bestmove")) {
        bestmove = text.split(/\s+/)[1];
        finish();
      }
    });

    child.stderr?.on("data", () => {});

    child.on("error", (err) => cleanup(err));

    child.stdin.write("uci\n");
    child.stdin.write("isready\n");

    const timeout = setTimeout(() => cleanup(new Error("engine_timeout")), Math.max(12000, depth * 900));

    const finish = () => {
      clearTimeout(timeout);
      const bestMoves = Object.values(lines)
        .sort((a, b) => (a.multipv ?? 1) - (b.multipv ?? 1))
        .map((l) => ({
          uci: l.move ?? "",
          score: l.score ?? "0.00",
          depth: l.depth ?? depth,
          pv: l.pv ?? [],
        }))
        .filter((m) => m.uci);

      if (!bestMoves.length && bestmove) {
        bestMoves.push({ uci: bestmove, score: "0.00", depth, pv: [bestmove] });
      }

      cleanup(undefined, { id, bestMoves });
    };

    child.on("close", () => {
      if (!finished) finish();
    });
  });
};
