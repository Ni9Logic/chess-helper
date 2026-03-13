// ---------------------------------------------------------------------------
// Lichess Board Reader
// Provides functions to read the board from lichess.org's DOM.
// Loaded alongside content.js; content.js delegates here when on Lichess.
// ---------------------------------------------------------------------------

const lichessHelpers = (() => {
    const PIECE_ROLES = {
        king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p",
    };

    /** Find the main cg-board element. */
    const findBoard = () => document.querySelector("cg-board");

    /** Detect orientation from cg-wrap class. */
    const isFlipped = () => {
        const wrap = document.querySelector("cg-wrap, .cg-wrap");
        if (!wrap) return false;
        return wrap.classList.contains("orientation-black");
    };

    /**
     * Read piece positions from Lichess DOM.
     * Lichess uses <piece class="white king"> with transform: translate(x, y).
     */
    const readFen = () => {
        const boardEl = findBoard();
        if (!boardEl) return null;
        const rect = boardEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const squareSize = rect.width / 8;
        const board = Array(64).fill(null);
        const flipped = isFlipped();

        const pieces = boardEl.querySelectorAll("piece");
        pieces.forEach((el) => {
            const cls = el.className || "";
            const isWhite = cls.includes("white");
            const isBlack = cls.includes("black");
            if (!isWhite && !isBlack) return;

            // Determine piece type
            let pieceType = null;
            for (const [role, symbol] of Object.entries(PIECE_ROLES)) {
                if (cls.includes(role)) {
                    pieceType = isWhite ? symbol.toUpperCase() : symbol;
                    break;
                }
            }
            if (!pieceType) return;

            // Get position from transform or style
            const style = el.getAttribute("style") || "";
            const transformMatch = style.match(/translate\(\s*(\d+(?:\.\d+)?)\s*px\s*,\s*(\d+(?:\.\d+)?)\s*px\s*\)/);
            if (!transformMatch) return;

            const px = parseFloat(transformMatch[1]);
            const py = parseFloat(transformMatch[2]);
            let col = Math.round(px / squareSize);
            let row = Math.round(py / squareSize);

            if (flipped) {
                col = 7 - col;
                row = 7 - row;
            }

            if (col >= 0 && col < 8 && row >= 0 && row < 8) {
                board[row * 8 + col] = pieceType;
            }
        });

        // Build FEN string
        const fenRows = [];
        for (let r = 0; r < 8; r++) {
            let row = "";
            let empty = 0;
            for (let c = 0; c < 8; c++) {
                const piece = board[r * 8 + c];
                if (!piece) {
                    empty++;
                } else {
                    if (empty > 0) { row += empty; empty = 0; }
                    row += piece;
                }
            }
            if (empty > 0) row += empty;
            fenRows.push(row || "8");
        }

        // Determine active color from clock
        const active = detectActiveColor() || "w";
        const castling = inferCastlingRightsLichess(board);
        return `${fenRows.join("/")} ${active} ${castling} - 0 1`;
    };

    /** Detect whose turn it is via running clock. */
    const detectActiveColor = () => {
        const clocks = document.querySelectorAll(".rclock-bottom, .rclock-top, div.clock");
        for (const clock of clocks) {
            const isRunning = clock.classList.contains("clock--running") ||
                clock.classList.contains("running") ||
                clock.querySelector(".running");
            if (!isRunning) continue;
            // Bottom clock is the viewer's side
            const isBottom = clock.classList.contains("rclock-bottom");
            const viewerColor = isFlipped() ? "b" : "w";
            if (isBottom) return viewerColor;
            return viewerColor === "w" ? "b" : "w";
        }
        return null;
    };

    /** Same castling inference logic but for Lichess board array. */
    const inferCastlingRightsLichess = (board) => {
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

    return { findBoard, isFlipped, readFen };
})();

if (typeof globalThis !== "undefined") {
    globalThis.lichessHelpers = lichessHelpers;
}
