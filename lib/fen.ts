import { type CastlingRights, type Color, type GameState, type Piece, type PieceType } from "./chessEngine";

const fileChars = "abcdefgh";

const charToPiece = (ch: string): Piece | null => {
  if (ch === "." || ch === "") return null;
  const isUpper = ch === ch.toUpperCase();
  const color: Color = isUpper ? "w" : "b";
  const type = ch.toLowerCase() as PieceType;
  return { color, type };
};

export const fenToState = (fen: string): GameState | null => {
  if (!fen) return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const [boardPart, activeColor, castlingPart, enPassantPart, halfmoveStr = "0", fullmoveStr = "1"] = parts;
  const rows = boardPart.split("/");
  if (rows.length !== 8) return null;

  const board: (Piece | null)[] = [];
  for (const row of rows) {
    for (const ch of row) {
      if (Number.isInteger(Number(ch))) {
        const n = Number(ch);
        for (let i = 0; i < n; i += 1) board.push(null);
      } else {
        board.push(charToPiece(ch));
      }
    }
  }
  if (board.length !== 64) return null;

  const castling: CastlingRights = {
    wK: castlingPart.includes("K"),
    wQ: castlingPart.includes("Q"),
    bK: castlingPart.includes("k"),
    bQ: castlingPart.includes("q"),
  };

  const enPassant = (() => {
    if (enPassantPart === "-" || enPassantPart.length !== 2) return null;
    const file = fileChars.indexOf(enPassantPart[0]);
    const rank = Number(enPassantPart[1]);
    if (file < 0 || Number.isNaN(rank) || rank < 1 || rank > 8) return null;
    const row = 8 - rank;
    return row * 8 + file;
  })();

  return {
    board,
    turn: activeColor === "b" ? "b" : "w",
    castling,
    enPassant,
    halfmove: Number(halfmoveStr) || 0,
    fullmove: Number(fullmoveStr) || 1,
  };
};

export const fenFromBoard = fenToState; // alias for symmetry
