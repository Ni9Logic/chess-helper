export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  color: Color;
  type: PieceType;
}

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface GameState {
  board: (Piece | null)[];
  turn: Color;
  castling: CastlingRights;
  enPassant: number | null;
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  promotion?: PieceType;
  capture?: Piece | null;
  enPassant?: boolean;
  castle?: "K" | "Q";
}

export interface ScoredMove {
  move: Move;
  score: number;
}

const files = "abcdefgh";
const pieceValue: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

// Piece-square tables encourage good piece placement.
const pst = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0,
    -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10,
    20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0,
    0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15,
    20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0,
    -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10,
    10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10,
    5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20,
    -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0,
    -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5,
    5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 0,
    5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10,
    -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
    -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40,
    -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20,
    -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

export const initialState = (): GameState => {
  const layout = [
    "rnbqkbnr",
    "pppppppp",
    "........",
    "........",
    "........",
    "........",
    "PPPPPPPP",
    "RNBQKBNR",
  ];

  const board: (Piece | null)[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const char = layout[row][col];
      if (char === ".") {
        board.push(null);
      } else {
        const color: Color = char === char.toUpperCase() ? "w" : "b";
        const type = char.toLowerCase() as PieceType;
        board.push({ color, type });
      }
    }
  }

  return {
    board,
    turn: "w",
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
};

const cloneState = (state: GameState): GameState => ({
  board: state.board.map((p) => (p ? { ...p } : null)),
  turn: state.turn,
  castling: { ...state.castling },
  enPassant: state.enPassant,
  halfmove: state.halfmove,
  fullmove: state.fullmove,
});

const idxToCoord = (idx: number) => {
  const row = Math.floor(idx / 8);
  const col = idx % 8;
  return { row, col };
};

const coordToIdx = (row: number, col: number) => row * 8 + col;

export const squareLabel = (idx: number) => {
  const { row, col } = idxToCoord(idx);
  return `${files[col]}${8 - row}`;
};

const opposite = (color: Color): Color => (color === "w" ? "b" : "w");

const isInside = (row: number, col: number) => row >= 0 && row < 8 && col >= 0 && col < 8;

const kingSquare = (state: GameState, color: Color) =>
  state.board.findIndex((p) => p?.type === "k" && p.color === color);

const isSquareAttacked = (state: GameState, idx: number, byColor: Color): boolean => {
  const { row, col } = idxToCoord(idx);
  const forward = byColor === "w" ? -1 : 1;
  // Pawns
  for (const dc of [-1, 1]) {
    const r = row + forward;
    const c = col + dc;
    if (!isInside(r, c)) continue;
    const p = state.board[coordToIdx(r, c)];
    if (p && p.color === byColor && p.type === "p") return true;
  }

  // Knights
  const knightDeltas = [
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
  ];
  for (const [dr, dc] of knightDeltas) {
    const r = row + dr;
    const c = col + dc;
    if (!isInside(r, c)) continue;
    const p = state.board[coordToIdx(r, c)];
    if (p && p.color === byColor && p.type === "n") return true;
  }

  // Sliding pieces: bishops/queens
  const bishopDirs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dr, dc] of bishopDirs) {
    let r = row + dr;
    let c = col + dc;
    while (isInside(r, c)) {
      const p = state.board[coordToIdx(r, c)];
      if (p) {
        if (p.color === byColor && (p.type === "b" || p.type === "q")) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // Rooks/queens
  const rookDirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dr, dc] of rookDirs) {
    let r = row + dr;
    let c = col + dc;
    while (isInside(r, c)) {
      const p = state.board[coordToIdx(r, c)];
      if (p) {
        if (p.color === byColor && (p.type === "r" || p.type === "q")) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // King
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (!isInside(r, c)) continue;
      const p = state.board[coordToIdx(r, c)];
      if (p && p.color === byColor && p.type === "k") return true;
    }
  }

  return false;
};

export const inCheck = (state: GameState, color: Color) => {
  const kIdx = kingSquare(state, color);
  if (kIdx === -1) return false;
  return isSquareAttacked(state, kIdx, opposite(color));
};

const addMove = (moves: Move[], move: Move) => moves.push(move);

const pawnMoves = (state: GameState, idx: number, moves: Move[]) => {
  const piece = state.board[idx];
  if (!piece) return;
  const { color } = piece;
  const dir = color === "w" ? -1 : 1;
  const { row, col } = idxToCoord(idx);
  const startRow = color === "w" ? 6 : 1;

  // One step forward
  const oneRow = row + dir;
  if (isInside(oneRow, col) && state.board[coordToIdx(oneRow, col)] === null) {
    const toIdx = coordToIdx(oneRow, col);
    addMove(moves, {
      from: idx,
      to: toIdx,
      promotion: oneRow === 0 || oneRow === 7 ? "q" : undefined,
    });

    // Two steps
    if (row === startRow) {
      const twoRow = row + dir * 2;
      if (state.board[coordToIdx(twoRow, col)] === null) {
        addMove(moves, { from: idx, to: coordToIdx(twoRow, col) });
      }
    }
  }

  // Captures
  for (const dc of [-1, 1]) {
    const r = row + dir;
    const c = col + dc;
    if (!isInside(r, c)) continue;
    const targetIdx = coordToIdx(r, c);
    const target = state.board[targetIdx];
    if (target && target.color !== color) {
      addMove(moves, {
        from: idx,
        to: targetIdx,
        capture: target,
        promotion: r === 0 || r === 7 ? "q" : undefined,
      });
    }
    if (state.enPassant === targetIdx && !target) {
      addMove(moves, { from: idx, to: targetIdx, enPassant: true, capture: { color: opposite(color), type: "p" } });
    }
  }
};

const knightMoves = (state: GameState, idx: number, moves: Move[]) => {
  const piece = state.board[idx];
  if (!piece) return;
  const { color } = piece;
  const deltas = [
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
  ];
  const { row, col } = idxToCoord(idx);
  for (const [dr, dc] of deltas) {
    const r = row + dr;
    const c = col + dc;
    if (!isInside(r, c)) continue;
    const targetIdx = coordToIdx(r, c);
    const target = state.board[targetIdx];
    if (!target || target.color !== color) {
      addMove(moves, { from: idx, to: targetIdx, capture: target ?? undefined });
    }
  }
};

const slidingMoves = (
  state: GameState,
  idx: number,
  moves: Move[],
  dirs: Array<[number, number]>,
) => {
  const piece = state.board[idx];
  if (!piece) return;
  const { color } = piece;
  const { row, col } = idxToCoord(idx);
  for (const [dr, dc] of dirs) {
    let r = row + dr;
    let c = col + dc;
    while (isInside(r, c)) {
      const targetIdx = coordToIdx(r, c);
      const target = state.board[targetIdx];
      if (target) {
        if (target.color !== color) addMove(moves, { from: idx, to: targetIdx, capture: target });
        break;
      } else {
        addMove(moves, { from: idx, to: targetIdx });
      }
      r += dr;
      c += dc;
    }
  }
};

const kingMoves = (state: GameState, idx: number, moves: Move[]) => {
  const piece = state.board[idx];
  if (!piece) return;
  const { color } = piece;
  const { row, col } = idxToCoord(idx);

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (!isInside(r, c)) continue;
      const targetIdx = coordToIdx(r, c);
      const target = state.board[targetIdx];
      if (!target || target.color !== color) {
        addMove(moves, { from: idx, to: targetIdx, capture: target ?? undefined });
      }
    }
  }

  // Castling
  const rights = state.castling;
  const enemy = opposite(color);
  const homeRow = color === "w" ? 7 : 0;
  if (row === homeRow && col === 4 && !isSquareAttacked(state, idx, enemy)) {
    // Kingside
    const kingsideClear =
      state.board[coordToIdx(homeRow, 5)] === null &&
      state.board[coordToIdx(homeRow, 6)] === null;
    if (
      kingsideClear &&
      ((color === "w" && rights.wK) || (color === "b" && rights.bK)) &&
      !isSquareAttacked(state, coordToIdx(homeRow, 5), enemy) &&
      !isSquareAttacked(state, coordToIdx(homeRow, 6), enemy)
    ) {
      addMove(moves, { from: idx, to: coordToIdx(homeRow, 6), castle: "K" });
    }
    // Queenside
    const queensideClear =
      state.board[coordToIdx(homeRow, 3)] === null &&
      state.board[coordToIdx(homeRow, 2)] === null &&
      state.board[coordToIdx(homeRow, 1)] === null;
    if (
      queensideClear &&
      ((color === "w" && rights.wQ) || (color === "b" && rights.bQ)) &&
      !isSquareAttacked(state, coordToIdx(homeRow, 3), enemy) &&
      !isSquareAttacked(state, coordToIdx(homeRow, 2), enemy)
    ) {
      addMove(moves, { from: idx, to: coordToIdx(homeRow, 2), castle: "Q" });
    }
  }
};

const pseudoLegalMoves = (state: GameState, color: Color) => {
  const moves: Move[] = [];
  for (let idx = 0; idx < 64; idx += 1) {
    const piece = state.board[idx];
    if (!piece || piece.color !== color) continue;
    switch (piece.type) {
      case "p":
        pawnMoves(state, idx, moves);
        break;
      case "n":
        knightMoves(state, idx, moves);
        break;
      case "b":
        slidingMoves(
          state,
          idx,
          moves,
          [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ],
        );
        break;
      case "r":
        slidingMoves(
          state,
          idx,
          moves,
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ],
        );
        break;
      case "q":
        slidingMoves(
          state,
          idx,
          moves,
          [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ],
        );
        break;
      case "k":
        kingMoves(state, idx, moves);
        break;
      default:
        break;
    }
  }
  return moves;
};

export const makeMove = (state: GameState, move: Move): GameState => {
  const next = cloneState(state);
  const piece = next.board[move.from];
  if (!piece) return state;

  // Reset en-passant target by default
  next.enPassant = null;

  // Halfmove clock
  if (piece.type === "p" || move.capture) {
    next.halfmove = 0;
  } else {
    next.halfmove += 1;
  }

  // Move the piece
  next.board[move.from] = null;

  // En passant capture removes the pawn behind the target square
  if (move.enPassant) {
    const dir = piece.color === "w" ? 1 : -1;
    const { row, col } = idxToCoord(move.to);
    const capturedIdx = coordToIdx(row + dir, col);
    next.board[capturedIdx] = null;
  }

  // Castling rook move
  if (piece.type === "k" && move.castle) {
    const homeRow = piece.color === "w" ? 7 : 0;
    if (move.castle === "K") {
      const rookFrom = coordToIdx(homeRow, 7);
      const rookTo = coordToIdx(homeRow, 5);
      next.board[rookTo] = next.board[rookFrom];
      next.board[rookFrom] = null;
    } else {
      const rookFrom = coordToIdx(homeRow, 0);
      const rookTo = coordToIdx(homeRow, 3);
      next.board[rookTo] = next.board[rookFrom];
      next.board[rookFrom] = null;
    }
  }

  const promotedPiece =
    piece.type === "p" && move.promotion
      ? { color: piece.color, type: move.promotion }
      : piece;

  next.board[move.to] = promotedPiece;

  // Set en-passant target on a double pawn push
  const { row: fromRow, col } = idxToCoord(move.from);
  const { row: toRow } = idxToCoord(move.to);
  if (piece.type === "p" && Math.abs(toRow - fromRow) === 2) {
    const epRow = (fromRow + toRow) / 2;
    next.enPassant = coordToIdx(epRow, col);
  }

  // Update castling rights
  const touchRook = (rookIdx: number) => {
    if (rookIdx === coordToIdx(7, 0)) next.castling.wQ = false;
    if (rookIdx === coordToIdx(7, 7)) next.castling.wK = false;
    if (rookIdx === coordToIdx(0, 0)) next.castling.bQ = false;
    if (rookIdx === coordToIdx(0, 7)) next.castling.bK = false;
  };

  if (piece.type === "k") {
    if (piece.color === "w") {
      next.castling.wK = false;
      next.castling.wQ = false;
    } else {
      next.castling.bK = false;
      next.castling.bQ = false;
    }
  }

  if (piece.type === "r") touchRook(move.from);
  if (move.capture && move.capture.type === "r" && move.to !== undefined) touchRook(move.to);

  // Switch turn and fullmove number
  if (state.turn === "b") next.fullmove += 1;
  next.turn = opposite(state.turn);

  return next;
};

export const generateLegalMoves = (state: GameState, color: Color = state.turn): Move[] => {
  const all = pseudoLegalMoves(state, color);
  const legal: Move[] = [];
  for (const mv of all) {
    const next = makeMove(state, mv);
    if (!inCheck(next, color)) legal.push(mv);
  }
  return legal;
};

const mateValue = 100000;

const evaluate = (state: GameState): number => {
  let score = 0;
  for (let idx = 0; idx < 64; idx += 1) {
    const piece = state.board[idx];
    if (!piece) continue;
    const base = pieceValue[piece.type];
    const table = pst[piece.type];
    const mirroredIdx = piece.color === "w" ? idx : 63 - idx;
    const positional = table[mirroredIdx] ?? 0;
    const value = base + positional;
    score += piece.color === "w" ? value : -value;
  }
  // Encourage side to move (tempo)
  score += state.turn === "w" ? 5 : -5;
  return score;
};

const negamax = (state: GameState, depth: number, alpha: number, beta: number): number => {
  if (depth === 0) return evaluate(state);
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    if (inCheck(state, state.turn)) {
      return -(mateValue - depth); // current player is checkmated
    }
    return 0; // stalemate
  }

  let best = -Infinity;
  for (const move of moves) {
    const score = -negamax(makeMove(state, move), depth - 1, -beta, -alpha);
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  return best;
};

export const scoreMoves = (state: GameState, depth = 3): ScoredMove[] => {
  const moves = generateLegalMoves(state);
  const scored = moves.map((mv) => ({
    move: mv,
    score: -negamax(makeMove(state, mv), depth - 1, -Infinity, Infinity),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
};

export const findBestMoves = (
  state: GameState,
  depth = 3,
  limit = 3,
): ScoredMove[] => {
  return scoreMoves(state, depth).slice(0, limit);
};

export const moveKey = (move: Move) => `${move.from}-${move.to}-${move.promotion ?? ""}`;

export const formatMove = (move: Move) => {
  const from = squareLabel(move.from);
  const to = squareLabel(move.to);
  const arrow = move.capture ? "×" : "→";
  const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : "";
  const castle =
    move.castle === "K"
      ? "O-O"
      : move.castle === "Q"
        ? "O-O-O"
        : null;
  return castle ?? `${from} ${arrow} ${to}${promo}`;
};

export const gameStatus = (state: GameState) => {
  const moves = generateLegalMoves(state);
  const colorName = state.turn === "w" ? "White" : "Black";
  if (moves.length === 0) {
    return inCheck(state, state.turn)
      ? `${colorName} is checkmated`
      : "Stalemate";
  }
  return inCheck(state, state.turn) ? `${colorName} is in check` : `${colorName} to move`;
};
