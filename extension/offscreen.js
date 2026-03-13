// ---------------------------------------------------------------------------
// Offscreen Stockfish Engine Manager
// Runs in an offscreen document (invisible page). Spawns Stockfish as a
// Web Worker and relays UCI commands from the background service worker.
// ---------------------------------------------------------------------------

let worker = null;
let currentJob = null;
let lines = {};       // multipv → best info line
let bestmove = null;
let jobTimeout = null;

const startWorker = () => {
    if (worker) return;
    worker = new Worker(chrome.runtime.getURL("engine/stockfish.js"));
    worker.onmessage = (e) => onEngineLine(e.data);
    worker.onerror = (e) => {
        console.error("Stockfish worker error:", e);
        worker = null;
    };
    // Initialize UCI
    worker.postMessage("uci");
};

const sendCmd = (cmd) => {
    if (!worker) startWorker();
    worker.postMessage(cmd);
};

const onEngineLine = (text) => {
    if (typeof text !== "string") return;
    const line = text.trim();

    // Forward to background for debugging
    // chrome.runtime.sendMessage({ type: "engineDebug", line });

    if (!currentJob) return;

    if (line === "uciok" || line === "readyok") return;

    if (line.startsWith("info ")) {
        const parts = line.split(/\s+/);
        const idx = (key) => parts.indexOf(key);
        const info = {};

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
            const existing = lines[key];
            if (!existing || (existing.depth ?? 0) <= info.depth) {
                lines[key] = info;
            }
        }
    }

    if (line.startsWith("bestmove")) {
        bestmove = line.split(/\s+/)[1];
        finishJob();
    }
};

const finishJob = () => {
    if (jobTimeout) { clearTimeout(jobTimeout); jobTimeout = null; }
    const job = currentJob;
    if (!job) return;
    currentJob = null;

    if (job.aborted) {
        chrome.runtime.sendMessage({
            type: "engineResult",
            id: job.id,
            bestMoves: [],
            aborted: true,
        });
        return;
    }

    const bestMoves = Object.values(lines)
        .sort((a, b) => (a.multipv ?? 1) - (b.multipv ?? 1))
        .map((l) => ({
            uci: l.move ?? "",
            score: l.score ?? "0.00",
            depth: l.depth ?? job.depth,
            pv: l.pv ?? [],
            wdl: l.wdl ?? undefined,
        }))
        .filter((m) => m.uci);

    if (!bestMoves.length && bestmove) {
        bestMoves.push({ uci: bestmove, score: "0.00", depth: job.depth, pv: [bestmove] });
    }

    chrome.runtime.sendMessage({
        type: "engineResult",
        id: job.id,
        bestMoves,
    });
};

// Listen for commands from background.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "engineAnalyze") {
        // Cancel current job if any
        if (currentJob) {
            currentJob.aborted = true;
            sendCmd("stop");
        }

        const job = {
            id: msg.id,
            fen: msg.fen,
            depth: msg.depth || 12,
            multipv: msg.multipv || 3,
            skillLevel: msg.skillLevel ?? 20,
            aborted: false,
        };

        currentJob = job;
        lines = {};
        bestmove = null;

        if (!worker) startWorker();

        sendCmd(`setoption name MultiPV value ${job.multipv}`);
        sendCmd(`setoption name Skill Level value ${job.skillLevel}`);
        sendCmd("setoption name UCI_ShowWDL value true");
        sendCmd("ucinewgame");
        sendCmd("isready");

        // Small delay to let isready process, then send position + go
        setTimeout(() => {
            if (currentJob !== job || job.aborted) return;
            sendCmd(`position fen ${job.fen}`);
            sendCmd(`go depth ${job.depth}`);
        }, 20);

        // Timeout safety
        jobTimeout = setTimeout(() => {
            if (currentJob === job && !job.aborted) {
                job.aborted = true;
                sendCmd("stop");
            }
        }, Math.max(15000, job.depth * 1000));

        sendResponse({ ok: true });
        return;
    }

    if (msg?.type === "engineStop") {
        if (currentJob) {
            currentJob.aborted = true;
            sendCmd("stop");
        }
        sendResponse({ ok: true });
        return;
    }
});

// Start the engine immediately
startWorker();
