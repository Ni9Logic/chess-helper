// ---------------------------------------------------------------------------
// Move History Tracker
// Tracks FEN positions, engine evaluations, and classifies player moves.
// Stored on globalThis so content.js can access it.
// ---------------------------------------------------------------------------

const STARTING_FEN_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

class MoveHistory {
    constructor() {
        this.reset();
        this._lastUrl = location.href;
        // Watch for navigation (new game pages on chess.com / lichess)
        this._urlObserver = setInterval(() => this._checkUrlChange(), 1000);
    }

    reset() {
        this.fenHistory = [];       // ordered list of FEN strings
        this.evalHistory = [];      // eval per position index { score, wdl, bestMoves }
        this.classifications = [];  // per-move classification string
        this.openingName = "";
        this.gameStartedAt = Date.now();
        this._prevBoardFen = null;  // board-part only (for dedup)
    }

    /** Record a new board position. Returns true if it was genuinely new. */
    recordPosition(fen) {
        if (!fen) return false;
        const boardPart = fen.split(" ")[0];

        // Detect new game: board reset to starting position & we had moves before
        if (boardPart === STARTING_FEN_BOARD && this.fenHistory.length > 2) {
            this.reset();
        }

        // Deduplicate consecutive identical positions
        if (boardPart === this._prevBoardFen) return false;
        this._prevBoardFen = boardPart;

        this.fenHistory.push(fen);
        this.evalHistory.push(null); // placeholder until analysis arrives
        this.classifications.push(null);

        // Emit custom event for listeners
        this._emit("game:newMove", { fen, moveIndex: this.fenHistory.length - 1 });
        return true;
    }

    /** Attach engine analysis to the current position. */
    recordEval(fen, payload) {
        // Find the position this eval belongs to (usually the latest)
        const idx = this._findFenIndex(fen);
        if (idx === -1) return;
        this.evalHistory[idx] = {
            score: payload.bestMoves?.[0]?.score ?? "0.00",
            wdl: payload.bestMoves?.[0]?.wdl ?? null,
            bestMoves: (payload.bestMoves || []).map(m => ({
                uci: m.uci,
                score: m.score,
                pv: m.pv,
                wdl: m.wdl,
            })),
        };
    }

    /**
     * Classify the last completed move by comparing the eval drop.
     * Call this AFTER the engine eval for the NEW position has arrived.
     */
    classifyLastMove() {
        const len = this.fenHistory.length;
        if (len < 2) return null;

        const prevEval = this.evalHistory[len - 2];
        const currEval = this.evalHistory[len - 1];
        if (!prevEval || !currEval) return null;

        const prevScore = this._parseScore(prevEval.score);
        const currScore = this._parseScore(currEval.score);
        if (prevScore === null || currScore === null) return null;

        // Centipawn loss from the mover's perspective.
        // If it was White's move (even index), positive score is good for white.
        // We track absolute eval swing: a drop means a bad move.
        const cpLoss = prevScore - currScore; // positive = loss for the side that moved

        // Determine which side moved (the previous position's active color)
        const prevFen = this.fenHistory[len - 2];
        const prevActive = prevFen.split(" ")[1]; // "w" or "b"
        // Flip perspective: if black moved, scores are from white's POV so we negate
        const adjustedLoss = prevActive === "b" ? -cpLoss : cpLoss;

        let classification;
        if (adjustedLoss <= -50) classification = "brilliant";  // sacrifice that improves position
        else if (adjustedLoss <= 10) classification = "great";
        else if (adjustedLoss <= 30) classification = "good";
        else if (adjustedLoss <= 80) classification = "inaccuracy";
        else if (adjustedLoss <= 200) classification = "mistake";
        else classification = "blunder";

        this.classifications[len - 2] = classification; // classify the move that LED to current position
        this._emit("game:moveClassified", {
            classification,
            moveIndex: len - 2,
            cpLoss: adjustedLoss,
        });

        return classification;
    }

    /** Get the inferred player move UCI by diffing two consecutive FENs. */
    getLastMoveUci() {
        const len = this.fenHistory.length;
        if (len < 2) return null;
        return this._diffFens(this.fenHistory[len - 2], this.fenHistory[len - 1]);
    }

    /** Export game data for PGN generation. */
    exportData() {
        return {
            fenHistory: [...this.fenHistory],
            evalHistory: [...this.evalHistory],
            classifications: [...this.classifications],
            openingName: this.openingName,
            startedAt: this.gameStartedAt,
        };
    }

    // --- Private helpers ---

    _findFenIndex(fen) {
        const board = fen.split(" ")[0];
        // Search from end (most likely match is recent)
        for (let i = this.fenHistory.length - 1; i >= 0; i--) {
            if (this.fenHistory[i].split(" ")[0] === board) return i;
        }
        return -1;
    }

    _parseScore(score) {
        if (typeof score === "number") return score;
        if (typeof score !== "string") return null;
        if (score.startsWith("Mate")) {
            const n = parseInt(score.split(" ")[1], 10);
            return n > 0 ? 10000 - n : -10000 - n; // large value, closer = more extreme
        }
        const parsed = parseFloat(score);
        return isNaN(parsed) ? null : parsed * 100; // convert to centipawns
    }

    _diffFens(fenA, fenB) {
        const boardA = this._fenToBoard(fenA);
        const boardB = this._fenToBoard(fenB);
        if (!boardA || !boardB) return null;

        const files = "abcdefgh";
        let from = null;
        let to = null;

        for (let i = 0; i < 64; i++) {
            if (boardA[i] !== boardB[i]) {
                if (boardA[i] && !boardB[i]) {
                    // Piece left this square
                    if (!from) from = i;
                }
                if (boardB[i] && (!boardA[i] || boardA[i] !== boardB[i])) {
                    // Piece arrived at this square
                    to = i;
                }
            }
        }

        if (from === null || to === null) return null;
        const fromSq = `${files[from % 8]}${8 - Math.floor(from / 8)}`;
        const toSq = `${files[to % 8]}${8 - Math.floor(to / 8)}`;
        return `${fromSq}${toSq}`;
    }

    _fenToBoard(fen) {
        const boardPart = fen.split(" ")[0];
        const rows = boardPart.split("/");
        if (rows.length !== 8) return null;
        const board = [];
        for (const row of rows) {
            for (const ch of row) {
                if (ch >= "1" && ch <= "8") {
                    for (let i = 0; i < parseInt(ch, 10); i++) board.push(null);
                } else {
                    board.push(ch);
                }
            }
        }
        return board.length === 64 ? board : null;
    }

    _checkUrlChange() {
        if (location.href !== this._lastUrl) {
            this._lastUrl = location.href;
            // URL changed — likely a new game page
            if (this.fenHistory.length > 0) {
                this.reset();
                this._emit("game:newGame", {});
            }
        }
    }

    _emit(eventName, detail) {
        try {
            document.dispatchEvent(new CustomEvent(eventName, { detail }));
        } catch { /* ignore if page CSP blocks */ }
    }
}

// Expose globally
globalThis.moveHistory = new MoveHistory();
