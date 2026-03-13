import { spawn, type ChildProcess } from "child_process";
import readline from "readline";
import crypto from "crypto";
import path from "path";

export type EngineResult = {
  id: string;
  bestMoves: {
    uci: string;
    score: string;
    depth: number;
    pv: string[];
    wdl?: { win: number; draw: number; loss: number };
  }[];
};

type InfoLine = {
  depth?: number;
  score?: string;
  multipv?: number;
  move?: string;
  pv?: string[];
  wdl?: { win: number; draw: number; loss: number };
};

type PendingJob = {
  id: string;
  fen: string;
  depth: number;
  multipv: number;
  skillLevel: number;
  resolve: (result: EngineResult) => void;
  reject: (err: Error) => void;
  aborted: boolean;
};

// Use lite single-threaded for faster turnaround while keeping full UCI.
const ENGINE_PATH = path.join(process.cwd(), "node_modules/stockfish/bin/stockfish-18-lite-single.js");

// ---------------------------------------------------------------------------
// Persistent Stockfish engine pool
// ---------------------------------------------------------------------------

class StockfishEngine {
  private child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private busy = false;
  private currentJob: PendingJob | null = null;
  private lines: Record<number, InfoLine> = {};
  private bestmove: string | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.child) return;

    return new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [ENGINE_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stderr?.on("data", () => { }); // suppress stderr noise

      child.on("error", (err) => {
        this.handleCrash();
        reject(err);
      });

      child.on("close", () => {
        this.handleCrash();
      });

      const rl = readline.createInterface({ input: child.stdout! });
      rl.on("line", (line) => this.onLine(line));

      this.child = child;
      this.rl = rl;

      // Wait for "uciok" to know the engine is ready
      const onUciOk = (line: string) => {
        if (line.trim() === "uciok") {
          this.ready = true;
          rl.removeListener("line", onUciOk);
          resolve();
        }
      };
      rl.on("line", onUciOk);
      child.stdin!.write("uci\n");
    });
  }

  private handleCrash() {
    this.ready = false;
    this.child = null;
    this.rl?.close();
    this.rl = null;
    if (this.currentJob && !this.currentJob.aborted) {
      this.currentJob.reject(new Error("engine_crashed"));
    }
    this.currentJob = null;
    this.busy = false;
    if (this.timeout) clearTimeout(this.timeout);
  }

  isBusy() {
    return this.busy;
  }

  isAlive() {
    return this.child !== null && this.ready;
  }

  /** Cancel the current in-flight analysis if any. */
  cancelCurrent() {
    if (!this.currentJob) return;
    this.currentJob.aborted = true;
    // Send "stop" to Stockfish; it will emit "bestmove" which we handle in onLine
    this.child?.stdin?.write("stop\n");
  }

  async analyze(job: PendingJob): Promise<void> {
    if (!this.isAlive()) await this.start();
    this.busy = true;
    this.currentJob = job;
    this.lines = {};
    this.bestmove = null;

    const stdin = this.child!.stdin!;
    stdin.write(`setoption name MultiPV value ${job.multipv}\n`);
    stdin.write(`setoption name Skill Level value ${job.skillLevel}\n`);
    stdin.write("setoption name UCI_ShowWDL value true\n");
    stdin.write("ucinewgame\n");
    stdin.write("isready\n"); // wait for readyok before sending position

    // readyok is handled inside onLine → starts the actual search
    this.timeout = setTimeout(() => {
      if (this.currentJob === job && !job.aborted) {
        this.cancelCurrent();
        job.reject(new Error("engine_timeout"));
      }
    }, Math.max(15000, job.depth * 1000));
  }

  private onLine(raw: string) {
    const text = raw.trim();
    const job = this.currentJob;
    if (!job) return;

    if (text === "readyok") {
      // Engine is ready — start the search now
      const stdin = this.child!.stdin!;
      stdin.write(`position fen ${job.fen}\n`);
      stdin.write(`go depth ${job.depth} multipv ${job.multipv}\n`);
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
        const rawVal = Number(parts[scoreIdx + 2]);
        info.score = type === "cp" ? (rawVal / 100).toFixed(2) : `Mate ${rawVal}`;
      }

      const wdlIdx = idx("wdl");
      if (wdlIdx > -1 && parts.length > wdlIdx + 3) {
        info.wdl = {
          win: Number(parts[wdlIdx + 1]),
          draw: Number(parts[wdlIdx + 2]),
          loss: Number(parts[wdlIdx + 3]),
        };
      }

      const pvIdx = idx("pv");
      if (pvIdx > -1) info.pv = parts.slice(pvIdx + 1);
      const moveIdx = pvIdx > -1 ? pvIdx + 1 : -1;
      if (moveIdx > -1) info.move = parts[moveIdx];

      const key = info.multipv ?? 1;
      if (info.depth !== undefined && info.score && info.move) {
        const existing = this.lines[key];
        if (!existing || (existing.depth ?? 0) <= info.depth) {
          this.lines[key] = info;
        }
      }
    }

    if (text.startsWith("bestmove")) {
      this.bestmove = text.split(/\s+/)[1];
      this.finishJob();
    }
  }

  private finishJob() {
    if (this.timeout) clearTimeout(this.timeout);
    const job = this.currentJob;
    if (!job) {
      this.busy = false;
      return;
    }

    this.currentJob = null;
    this.busy = false;

    if (job.aborted) {
      // Resolve with empty so callers don't hang, but the route will discard it
      job.resolve({ id: job.id, bestMoves: [] });
      return;
    }

    const bestMoves = Object.values(this.lines)
      .sort((a, b) => (a.multipv ?? 1) - (b.multipv ?? 1))
      .map((l) => ({
        uci: l.move ?? "",
        score: l.score ?? "0.00",
        depth: l.depth ?? job.depth,
        pv: l.pv ?? [],
        wdl: l.wdl,
      }))
      .filter((m) => m.uci);

    if (!bestMoves.length && this.bestmove) {
      bestMoves.push({ uci: this.bestmove, score: "0.00", depth: job.depth, pv: [this.bestmove], wdl: undefined });
    }

    job.resolve({ id: job.id, bestMoves });
  }
}

// ---------------------------------------------------------------------------
// Pool of engines (currently 1 — easy to scale up)
// ---------------------------------------------------------------------------

const POOL_SIZE = 1;
const pool: StockfishEngine[] = [];
let latestRequestId: string | null = null;

const getEngine = async (): Promise<StockfishEngine> => {
  // Initialise pool on first call
  if (pool.length === 0) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const engine = new StockfishEngine();
      await engine.start();
      pool.push(engine);
    }
  }

  // Find an idle engine
  const idle = pool.find((e) => !e.isBusy());
  if (idle) return idle;

  // All busy — cancel the current work on the first engine (latest-wins)
  const engine = pool[0];
  engine.cancelCurrent();
  // Give it a tick to process the "stop"
  await new Promise((r) => setTimeout(r, 5));
  return engine;
};

export const analyzeFenWithStockfish = async (
  fen: string,
  depth = 12,
  multipv = 3,
  skillLevel = 20,
): Promise<EngineResult> => {
  const id = crypto.randomUUID();
  latestRequestId = id;

  const engine = await getEngine();

  return new Promise<EngineResult>((resolve, reject) => {
    const job: PendingJob = {
      id,
      fen,
      depth,
      multipv,
      skillLevel,
      resolve: (result) => {
        // Discard results from stale requests
        if (id !== latestRequestId) {
          resolve({ id, bestMoves: [] });
          return;
        }
        resolve(result);
      },
      reject,
      aborted: false,
    };
    engine.analyze(job);
  });
};
