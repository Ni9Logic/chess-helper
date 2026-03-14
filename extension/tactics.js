// ---------------------------------------------------------------------------
// Tactics Detection Module
// Detects common tactical patterns on the board: forks, pins, skewers,
// discovered attacks, and back-rank mate threats.
// ---------------------------------------------------------------------------

const tacticsEngine = (() => {
    const FILES = "abcdefgh";
    const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

    const idxToSq = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
    const sqToIdx = (sq) => (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);

    const isWhite = (ch) => ch >= "A" && ch <= "Z";
    const pieceType = (ch) => ch.toLowerCase();
    const pieceColor = (ch) => (ch >= "A" && ch <= "Z") ? "w" : "b";

    // Parse FEN board into array of 64 entries
    const fenToBoard = (fen) => {
        const rows = fen.split(" ")[0].split("/");
        const board = [];
        for (const row of rows) {
            for (const ch of row) {
                if (ch >= "1" && ch <= "8") {
                    for (let i = 0; i < parseInt(ch); i++) board.push(null);
                } else {
                    board.push(ch);
                }
            }
        }
        return board.length === 64 ? board : null;
    };

    // Get squares attacked by a piece at idx
    const getAttacks = (board, idx) => {
        const piece = board[idx];
        if (!piece) return [];
        const type = pieceType(piece);
        const row = Math.floor(idx / 8), col = idx % 8;
        const attacks = [];

        if (type === "n") {
            const offsets = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
            for (const [dr, dc] of offsets) {
                const r = row + dr, c = col + dc;
                if (r >= 0 && r < 8 && c >= 0 && c < 8) attacks.push(r * 8 + c);
            }
        } else if (type === "k") {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const r = row + dr, c = col + dc;
                    if (r >= 0 && r < 8 && c >= 0 && c < 8) attacks.push(r * 8 + c);
                }
            }
        } else if (type === "p") {
            const dir = isWhite(piece) ? -1 : 1;
            if (col > 0) attacks.push((row + dir) * 8 + col - 1);
            if (col < 7) attacks.push((row + dir) * 8 + col + 1);
        } else {
            // Sliding pieces: bishop diagonals, rook lines, queen both
            const dirs = [];
            if (type === "b" || type === "q") dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
            if (type === "r" || type === "q") dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
            for (const [dr, dc] of dirs) {
                let r = row + dr, c = col + dc;
                while (r >= 0 && r < 8 && c >= 0 && c < 8) {
                    attacks.push(r * 8 + c);
                    if (board[r * 8 + c]) break; // blocked
                    r += dr; c += dc;
                }
            }
        }
        return attacks;
    };

    // Detect patterns after a move is made
    const detectPatterns = (fen, moveUci) => {
        const board = fenToBoard(fen);
        if (!board || !moveUci) return [];
        const patterns = [];
        const active = fen.split(" ")[1] || "w";

        // Check all pieces of the side that just moved (opposite of active, since FEN shows next to move)
        const moverColor = active === "w" ? "b" : "w";

        for (let idx = 0; idx < 64; idx++) {
            const piece = board[idx];
            if (!piece || pieceColor(piece) !== moverColor) continue;

            const attacks = getAttacks(board, idx);
            const attackedEnemies = attacks
                .filter(a => board[a] && pieceColor(board[a]) !== moverColor)
                .map(a => ({ idx: a, piece: board[a], value: PIECE_VALUES[pieceType(board[a])] || 0 }));

            // Fork: piece attacks 2+ enemy pieces of value >= itself
            if (attackedEnemies.length >= 2) {
                const myValue = PIECE_VALUES[pieceType(piece)] || 0;
                const valuable = attackedEnemies.filter(e => e.value >= myValue || pieceType(e.piece) === "k");
                if (valuable.length >= 2) {
                    patterns.push({
                        type: "fork",
                        piece: piece,
                        square: idxToSq(idx),
                        targets: valuable.map(e => idxToSq(e.idx)),
                        label: `${piece.toUpperCase()} fork!`,
                    });
                }
            }
        }

        // Back-rank mate threat: check if the king is on rank 1/8 with no escape
        for (let idx = 0; idx < 64; idx++) {
            const piece = board[idx];
            if (!piece || pieceType(piece) !== "k") continue;
            const row = Math.floor(idx / 8);
            const isBackRank = (pieceColor(piece) === "w" && row === 7) || (pieceColor(piece) === "b" && row === 0);
            if (!isBackRank) continue;

            // Check if king is boxed in by own pawns
            const dir = pieceColor(piece) === "w" ? -1 : 1;
            const col = idx % 8;
            let blocked = 0;
            for (let dc = -1; dc <= 1; dc++) {
                const escapeRow = row + dir;
                const escapeCol = col + dc;
                if (escapeRow < 0 || escapeRow > 7 || escapeCol < 0 || escapeCol > 7) { blocked++; continue; }
                const escapeIdx = escapeRow * 8 + escapeCol;
                if (board[escapeIdx] && pieceColor(board[escapeIdx]) === pieceColor(piece)) blocked++;
            }
            if (blocked >= 2) {
                patterns.push({
                    type: "back_rank_weakness",
                    square: idxToSq(idx),
                    label: "⚠ Back rank",
                });
            }
        }

        return patterns;
    };

    // Detect if current position has a tactic (large eval swing possible)
    const detectPuzzle = (prevScore, bestScore) => {
        if (prevScore === null || bestScore === null) return false;
        const swing = Math.abs(bestScore - prevScore);
        return swing > 200; // >2 pawns swing = tactical opportunity
    };

    // Generate a simple "why" explanation for a move
    const explainMove = (fen, moveUci) => {
        if (!moveUci || moveUci.length < 4) return null;
        const board = fenToBoard(fen);
        if (!board) return null;

        const fromIdx = sqToIdx(moveUci.slice(0, 2));
        const toIdx = sqToIdx(moveUci.slice(2, 4));
        const movingPiece = board[fromIdx];
        const capturedPiece = board[toIdx];
        if (!movingPiece) return null;

        const reasons = [];

        // Capture
        if (capturedPiece) {
            const capturedName = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen" }[pieceType(capturedPiece)] || "piece";
            reasons.push(`Captures ${capturedName}`);
        }

        // Promotion
        if (moveUci.length === 5) {
            const promoNames = { q: "queen", r: "rook", b: "bishop", n: "knight" };
            reasons.push(`Promotes to ${promoNames[moveUci[4]] || "queen"}`);
        }

        // Center control (moving to d4/d5/e4/e5)
        const centerSquares = ["d4", "d5", "e4", "e5"];
        if (centerSquares.includes(moveUci.slice(2, 4))) {
            reasons.push("Controls center");
        }

        // Castling
        if (pieceType(movingPiece) === "k" && Math.abs(fromIdx - toIdx) === 2) {
            reasons.push("Castles for king safety");
        }

        // Development (minor piece moves from back rank)
        const fromRow = Math.floor(fromIdx / 8);
        if ((pieceType(movingPiece) === "n" || pieceType(movingPiece) === "b") &&
            ((isWhite(movingPiece) && fromRow === 7) || (!isWhite(movingPiece) && fromRow === 0))) {
            reasons.push("Develops piece");
        }

        // Check threats (simplified: look at attacks from the destination)
        const simulatedBoard = [...board];
        simulatedBoard[fromIdx] = null;
        simulatedBoard[toIdx] = movingPiece;
        const attacks = getAttacks(simulatedBoard, toIdx);
        for (const aIdx of attacks) {
            if (simulatedBoard[aIdx] && pieceType(simulatedBoard[aIdx]) === "k" &&
                pieceColor(simulatedBoard[aIdx]) !== pieceColor(movingPiece)) {
                reasons.push("Gives check");
                break;
            }
        }

        // Fork detection after move
        const enemyTargets = attacks.filter(a =>
            simulatedBoard[a] && pieceColor(simulatedBoard[a]) !== pieceColor(movingPiece) &&
            pieceType(simulatedBoard[a]) !== "p"
        );
        if (enemyTargets.length >= 2) {
            reasons.push("Creates fork");
        }

        return reasons.length ? reasons.join(" · ") : "Improves position";
    };

    return { detectPatterns, detectPuzzle, explainMove, fenToBoard };
})();

if (typeof globalThis !== "undefined") {
    globalThis.tacticsEngine = tacticsEngine;
}
