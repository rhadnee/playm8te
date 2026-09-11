import { Chess, Move } from "chess.js";
import { StockfishEngine } from "./StockfishEngine";
import { PIECE_VALUE } from "./pieceValues";

export type MoveQuality = "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";

/**
 * Centipawn-loss thresholds for move-quality classification. These are
 * NOT claimed to be universally "correct" — they're a documented starting
 * point roughly in line with common conventions used by lichess/similar
 * tools, and are the single place to retune if practical play shows they
 * feel wrong. "Centipawn loss" = how much worse the played move's
 * resulting evaluation is than the best move available, from the mover's
 * own perspective. A perfect/best move has ~0 loss.
 */
export const MOVE_QUALITY_THRESHOLDS_CP = {
  excellent: 10, // loss < 10cp
  good: 25, // loss < 25cp
  inaccuracy: 50, // loss < 50cp
  mistake: 100, // loss < 100cp
  // anything >= 100cp loss is a "blunder"
};

/** Converts a mate score to a large-magnitude centipawn-equivalent, preserving sign and rewarding faster mates. Lets mate scores compare sensibly against ordinary centipawn evaluations. */
function mateToCpEquivalent(mateIn: number): number {
  const sign = mateIn > 0 ? 1 : -1;
  const pliesToMate = Math.abs(mateIn);
  return sign * (10000 - pliesToMate * 10);
}

function scoreToCp(evaluationCp: number | null, mateIn: number | null): number | null {
  if (mateIn !== null) return mateToCpEquivalent(mateIn);
  return evaluationCp;
}

function classifyMoveQuality(centipawnLoss: number): MoveQuality {
  if (centipawnLoss < MOVE_QUALITY_THRESHOLDS_CP.excellent) return "excellent";
  if (centipawnLoss < MOVE_QUALITY_THRESHOLDS_CP.good) return "good";
  if (centipawnLoss < MOVE_QUALITY_THRESHOLDS_CP.inaccuracy) return "inaccuracy";
  if (centipawnLoss < MOVE_QUALITY_THRESHOLDS_CP.mistake) return "mistake";
  return "blunder";
}

export interface ChessContext {
  fen: string;
  moveNumber: number;
  turn: "white" | "black";
  moverColor: "white" | "black";

  lastMove?: { from: string; to: string; san: string };

  /** Both values are from the perspective of the player who made lastMove — positive is good for them. Null fields mean the engine was unavailable (engineAvailable will be false). */
  evaluation?: { beforeCp: number | null; afterCp: number | null; deltaCp: number | null };

  bestMove?: { uci: string; san: string | null };
  playedMove?: { uci: string; san: string };

  moveQuality?: MoveQuality;

  /**
   * Deterministic, board-verifiable facts only — see class doc for what is
   * intentionally NOT included (fork/pin/skewer/discovered attack/back-rank
   * are not detected in this version; do not infer their presence from
   * this array being empty vs non-empty for those specific motifs).
   */
  tacticalMotifs: string[];

  materialBalance: { white: number; black: number; difference: number };

  capturedPiece?: string;
  check: boolean;
  checkmate: boolean;
  stalemate: boolean;

  engineAvailable: boolean;
}

/**
 * Converts raw chess engine output into structured facts the companion can
 * reason from. Stockfish determines chess facts; the LLM only ever
 * interprets facts produced here — it must never be asked to invent an
 * evaluation, a "best move," or a tactic.
 *
 * INTENTIONALLY NOT IMPLEMENTED in this version (documented rather than
 * faked, per "do not claim a tactic exists unless it can be supported"):
 * fork, pin, skewer, discovered attack/check, back-rank weakness, king
 * attack pattern detection. These require attack-map computation per piece
 * type that wasn't in scope for this pass — see docs/TECHNICAL_DEBT.md.
 * What IS detected is fully deterministic and board/engine-verifiable:
 * check, checkmate, stalemate, capture, promotion, and "immediate
 * recapture available" (the moved piece can be captured right back — a
 * real, checkable fact, not a claim about whether that capture is actually
 * good for the opponent after further exchanges).
 */
export class ChessContextEngine {
  /**
   * Analyzes a move that was just played. `fenBefore`/`fenAfter` are FEN
   * snapshots (not live Chess instances) specifically so this can run
   * asynchronously in the background after the move has already been
   * applied and returned to the caller — a live Chess reference would risk
   * being mutated by a subsequent move before this analysis completes.
   * `moveResult` is the plain-data Move object chess.js returned when the
   * move was applied (chess.js Move objects are snapshots, not live
   * references, so holding onto one after further moves is safe).
   */
  static async analyzeMove(fenBefore: string, moveResult: Move, fenAfter: string): Promise<ChessContext> {
    const moverColor = moveResult.color; // "w" | "b"
    const chessAfter = new Chess();
    chessAfter.load(fenAfter);

    const [beforeEval, afterEval] = await Promise.all([
      StockfishEngine.evaluate(fenBefore),
      StockfishEngine.evaluate(fenAfter),
    ]);

    const engineAvailable = beforeEval !== null && afterEval !== null;

    let beforeCp: number | null = null;
    let afterCp: number | null = null;
    let deltaCp: number | null = null;
    let moveQuality: MoveQuality | undefined;
    let bestMove: ChessContext["bestMove"];

    if (beforeEval && afterEval) {
      // beforeEval.evaluationCp/mateIn is from the mover's own perspective
      // (they're the side to move in fenBefore) — this represents the best
      // achievable outcome (engine's own best move).
      beforeCp = scoreToCp(beforeEval.evaluationCp, beforeEval.mateIn);

      // afterEval is from the perspective of whoever moves next in
      // fenAfter — i.e. the OPPONENT, since the turn just changed. Negate
      // it to view the actual resulting position from the mover's own
      // perspective, so it's directly comparable to beforeCp.
      const afterCpFromOpponentPov = scoreToCp(afterEval.evaluationCp, afterEval.mateIn);
      afterCp = afterCpFromOpponentPov === null ? null : -afterCpFromOpponentPov;

      if (beforeCp !== null && afterCp !== null) {
        deltaCp = afterCp - beforeCp; // <= 0 in the normal case (can't beat the engine's own best move)
        const centipawnLoss = Math.max(0, beforeCp - afterCp);
        moveQuality = classifyMoveQuality(centipawnLoss);
      }

      bestMove = { uci: beforeEval.move.from + beforeEval.move.to + (beforeEval.move.promotion ?? ""), san: null };
    }

    const tacticalMotifs: string[] = [];
    if (chessAfter.inCheck()) tacticalMotifs.push("check");
    if (chessAfter.isCheckmate()) tacticalMotifs.push("checkmate");
    if (chessAfter.isStalemate()) tacticalMotifs.push("stalemate");
    if (moveResult.captured) tacticalMotifs.push("capture");
    if (moveResult.promotion) tacticalMotifs.push("promotion");
    if (ChessContextEngine.canOpponentRecapture(chessAfter, moveResult.to)) {
      tacticalMotifs.push("immediate_recapture_available");
    }

    return {
      fen: fenAfter,
      moveNumber: chessAfter.moveNumber(),
      turn: chessAfter.turn() === "w" ? "white" : "black",
      moverColor: moverColor === "w" ? "white" : "black",
      lastMove: { from: moveResult.from, to: moveResult.to, san: moveResult.san },
      evaluation: engineAvailable ? { beforeCp, afterCp, deltaCp } : undefined,
      bestMove,
      playedMove: { uci: moveResult.from + moveResult.to + (moveResult.promotion ?? ""), san: moveResult.san },
      moveQuality,
      tacticalMotifs,
      materialBalance: ChessContextEngine.materialBalance(chessAfter),
      capturedPiece: moveResult.captured,
      check: chessAfter.inCheck(),
      checkmate: chessAfter.isCheckmate(),
      stalemate: chessAfter.isStalemate(),
      engineAvailable,
    };
  }

  /** True if the opponent (side to move in `chessAfter`) has a legal move capturing on `square`. A real, checkable fact — not a claim that the resulting trade is bad for the mover. */
  private static canOpponentRecapture(chessAfter: Chess, square: string): boolean {
    const moves = chessAfter.moves({ verbose: true }) as Move[];
    return moves.some((m) => m.to === square && !!m.captured);
  }

  static materialBalance(chess: Chess): ChessContext["materialBalance"] {
    const board = chess.board();
    let white = 0;
    let black = 0;
    for (const row of board) {
      for (const square of row) {
        if (!square) continue;
        const value = PIECE_VALUE[square.type] ?? 0;
        if (square.color === "w") white += value;
        else black += value;
      }
    }
    return { white, black, difference: white - black };
  }
}
