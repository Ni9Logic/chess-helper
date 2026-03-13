export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { analyzeFenWithStockfish } from "@/lib/stockfishNode";
import { broadcast } from "@/lib/streamBus";
import { fenToState } from "@/lib/fen";
import { scoreMoves } from "@/lib/chessEngine";

const allowCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type AnalysisPayload = {
  type: "analysis";
  source: string;
  fen: string;
  generatedAt: number;
  id: string;
  bestMoves: {
    uci: string;
    score: string;
    depth: number;
    pv: string[];
  }[];
  blunderMove?: { uci: string; score: string };
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: allowCors });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fen, depth = 12, multipv = 3, skillLevel = 20, source = "extension" } = body ?? {};
    if (!fen || typeof fen !== "string") {
      return NextResponse.json({ error: "fen required" }, { status: 400, headers: allowCors });
    }

    const result = await analyzeFenWithStockfish(
      fen,
      Number(depth) || 12,
      Number(multipv) || 3,
      Math.min(20, Math.max(0, Number(skillLevel) || 20)),
    );

    // Quick local worst-move heuristic using lightweight JS engine to give a "blunder" suggestion.
    let blunderMove: { uci: string; score: string } | undefined;
    const state = fenToState(fen);
    if (state) {
      const scored = scoreMoves(state, 3);
      if (scored.length > 0) {
        const worst = scored[scored.length - 1];
        const files = "abcdefgh";
        const toUci = (idx: number) => `${files[idx % 8]}${8 - Math.floor(idx / 8)}`;
        blunderMove = {
          uci: `${toUci(worst.move.from)}${toUci(worst.move.to)}${worst.move.promotion ?? ""}`,
          score: (worst.score / 100).toFixed(2),
        };
      }
    }
    const payload: AnalysisPayload = {
      type: "analysis",
      source,
      fen,
      generatedAt: Date.now(),
      blunderMove,
      ...result,
    };
    broadcast(payload);
    return NextResponse.json(payload, { headers: allowCors });
  } catch (err: unknown) {
    console.error("analyze error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: allowCors });
  }
}
