import { Chess, Move } from "chess.js";
import { v4 as uuid } from "uuid";
import {
  GameAdapter,
  GameEvent,
  GameState,
  PlayerRef,
} from "../../types/game";
import { ChessAction, ChessBoardState, ChessGameEventType } from "./types";
import { StockfishEngine } from "../../services/chess/StockfishEngine";
import { ChessDifficulty, DEFAULT_DIFFICULTY } from "../../services/chess/difficultyPresets";
import { PIECE_VALUE } from "../../services/chess/pieceValues";
import { ChessContextEngine, ChessContext } from "../../services/chess/ChessContextEngine";

/**
 * Piece values are shared with ChessContextEngine via pieceValues.ts —
 * used here only for the coarse "material score" shown in GameState and
 * the cheap blunder heuristic below. ChessContextEngine's move-quality
 * classification uses actual Stockfish evaluation, not this table, for
 * anything claiming to be an authoritative "fact."
 */

interface MatchRecord {
  chess: Chess;
  players: PlayerRef[];
  matchId: string;
  events: GameEvent<ChessGameEventType>[];
  listeners: Array<(event: GameEvent<ChessGameEventType>) => void>;
  moveNumber: number;
  /** Most recent Stockfish evaluation, if any — lets ConversationService ground answers in a real evaluation instead of guessing. */
  lastEngineEval?: { evaluationCp: number | null; mateIn: number | null };
  /** Full ChessContextEngine analysis of the most recently completed move, once background analysis finishes. Null/undefined until then — consumers must handle absence rather than assume it's always ready immediately after a move. */
  lastAnalysis?: ChessContext;
  /** Bounded history of analyses keyed by ply (half-move) number, so "why did you do that two moves ago" can look further back than just the latest move without growing unbounded. */
  analysisByPly: Map<number, ChessContext>;
}

export class ChessAdapter implements GameAdapter<ChessBoardState, ChessAction, ChessGameEventType> {
  readonly gameId = "chess";
  private matches = new Map<string, MatchRecord>();

  createMatch(matchId: string, players: PlayerRef[]): GameState<ChessBoardState, ChessAction> {
    if (players.length !== 2) {
      throw new Error("Chess requires exactly 2 players (human and/or AI companion)");
    }
    const withColor: PlayerRef[] = players.map((p, i) => ({
      ...p,
      color: i === 0 ? "white" : "black",
    }));

    const record: MatchRecord = {
      chess: new Chess(),
      players: withColor,
      matchId,
      events: [],
      listeners: [],
      moveNumber: 0,
      analysisByPly: new Map(),
    };
    this.matches.set(matchId, record);

    const startEvent = this.emit(record, "ROUND_STARTED", null, { players: withColor });
    record.events.push(startEvent);

    return this.getGameState(matchId);
  }

  /**
   * Reconstructs an in-progress match from persisted state (FEN + move
   * count) after a server restart. Does NOT re-emit ROUND_STARTED or any
   * historical events — this is a silent state restore, not a replay.
   */
  restoreMatch(matchId: string, players: PlayerRef[], fen: string, moveNumber: number): void {
    const chess = new Chess();
    chess.load(fen);
    this.matches.set(matchId, {
      chess,
      players,
      matchId,
      events: [],
      listeners: [],
      moveNumber,
      analysisByPly: new Map(),
    });
  }

  getGameState(matchId: string): GameState<ChessBoardState, ChessAction> {
    const record = this.requireMatch(matchId);
    const { chess, players } = record;

    const turnPlayer = players.find((p) => p.color === (chess.turn() === "w" ? "white" : "black"));

    return {
      matchId,
      players,
      currentPhase: chess.isGameOver() ? "COMPLETE" : "IN_PROGRESS",
      turnPlayerId: turnPlayer?.id ?? null,
      board: this.toBoardState(chess),
      score: this.materialScore(chess, players),
      objectives: ["Checkmate the opposing king"],
      recentEvents: record.events.slice(-10),
      availableActions: turnPlayer ? this.getAvailableActions(matchId, turnPlayer.id) : [],
      moveNumber: record.moveNumber,
      timestamp: new Date().toISOString(),
    };
  }

  getAvailableActions(matchId: string, playerId: string): ChessAction[] {
    const record = this.requireMatch(matchId);
    const player = record.players.find((p) => p.id === playerId);
    if (!player) return [];
    if (record.chess.turn() !== (player.color === "white" ? "w" : "b")) return [];

    return record.chess.moves({ verbose: true }).map((m: Move) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion as ChessAction["promotion"],
    }));
  }

  submitAction(
    matchId: string,
    playerId: string,
    action: ChessAction
  ): { state: GameState<ChessBoardState, ChessAction>; events: GameEvent<ChessGameEventType>[] } {
    const record = this.requireMatch(matchId);
    const player = record.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`Unknown player ${playerId} for match ${matchId}`);

    const expectedTurn = player.color === "white" ? "w" : "b";
    if (record.chess.turn() !== expectedTurn) {
      throw new Error("Not this player's turn");
    }

    const materialBefore = this.totalMaterialOnBoard(record.chess);
    const fenBefore = record.chess.fen(); // captured before mutation, for background analysis below

    let move: Move;
    try {
      move = record.chess.move({ from: action.from, to: action.to, promotion: action.promotion });
    } catch {
      throw new Error(`Illegal move: ${action.from}-${action.to}`);
    }

    record.moveNumber += 1;
    const plyAtThisMove = record.moveNumber;
    const fenAfter = record.chess.fen();

    // Real per-move engine analysis (spec requirement: "after every human
    // move, analyze"). Deliberately NOT awaited — it takes ~800ms (two
    // full-strength Stockfish searches) and must never delay the move
    // response or block gameplay. Runs against captured FEN snapshots, not
    // the live record.chess reference, so it's safe even if further moves
    // happen on this match before analysis completes.
    ChessContextEngine.analyzeMove(fenBefore, move, fenAfter)
      .then((context) => {
        record.lastAnalysis = context;
        record.analysisByPly.set(plyAtThisMove, context);
        // Bound memory growth — keep a reasonable rolling window rather than every ply of an unbounded-length game.
        if (record.analysisByPly.size > 50) {
          const oldestKey = Math.min(...record.analysisByPly.keys());
          record.analysisByPly.delete(oldestKey);
        }
        this.emit(record, "MOVE_ANALYZED", playerId, {
          ply: plyAtThisMove,
          moveQuality: context.moveQuality,
          deltaCp: context.evaluation?.deltaCp ?? null,
          tacticalMotifs: context.tacticalMotifs,
        });
      })
      .catch(() => {
        // Analysis failure must never surface as a gameplay error — the
        // move already succeeded through chess.js regardless of whether
        // Stockfish is available to explain it.
      });

    const newEvents: GameEvent<ChessGameEventType>[] = [];

    newEvents.push(
      this.emit(record, "MOVE_PLAYED", playerId, {
        san: move.san,
        from: move.from,
        to: move.to,
        piece: move.piece,
      })
    );

    if (move.captured) {
      newEvents.push(
        this.emit(record, "CAPTURE_MADE", playerId, {
          captured: move.captured,
          by: move.piece,
        })
      );
    }

    if (record.chess.inCheck() && !record.chess.isGameOver()) {
      newEvents.push(this.emit(record, "CHECK_GIVEN", playerId, {}));
    }

    // Cheap blunder heuristic: material swing against the mover with no
    // recapture protection isn't modeled here (needs a real eval), so we
    // only flag "gave away material for nothing" — a capture that leaves
    // the mover down material this exchange.
    const materialAfter = this.totalMaterialOnBoard(record.chess);
    const swing = materialAfter - materialBefore;
    if (move.captured && swing < -2) {
      newEvents.push(
        this.emit(record, "PIECE_BLUNDERED", playerId, { materialSwing: swing })
      );
    }

    if (record.chess.isCheckmate()) {
      newEvents.push(this.emit(record, "CHECKMATE", playerId, {}));
      newEvents.push(this.emit(record, "PLAYER_WON", playerId, {}));
      const loser = record.players.find((p) => p.id !== playerId);
      if (loser) newEvents.push(this.emit(record, "PLAYER_LOST", loser.id, {}));
      newEvents.push(this.emit(record, "ROUND_ENDED", null, { result: "checkmate" }));
    } else if (record.chess.isStalemate()) {
      newEvents.push(this.emit(record, "STALEMATE", null, {}));
      newEvents.push(this.emit(record, "MATCH_DRAWN", null, {}));
      newEvents.push(this.emit(record, "ROUND_ENDED", null, { result: "stalemate" }));
    } else if (record.chess.isDraw()) {
      newEvents.push(this.emit(record, "MATCH_DRAWN", null, {}));
      newEvents.push(this.emit(record, "ROUND_ENDED", null, { result: "draw" }));
    }

    record.events.push(...newEvents);
    return { state: this.getGameState(matchId), events: newEvents };
  }

  onGameEvent(matchId: string, handler: (event: GameEvent<ChessGameEventType>) => void): void {
    const record = this.requireMatch(matchId);
    record.listeners.push(handler);
  }

  /** Most recent completed analysis for this match, or null if none has finished yet (e.g. no moves played, or analysis still in flight / engine unavailable). */
  getLastAnalysis(matchId: string): ChessContext | null {
    const record = this.requireMatch(matchId);
    return record.lastAnalysis ?? null;
  }

  /** Analysis for a specific ply (half-move number), or null if that ply hasn't been analyzed (too old and evicted, still in flight, or analysis failed). */
  getAnalysisForPly(matchId: string, ply: number): ChessContext | null {
    const record = this.requireMatch(matchId);
    return record.analysisByPly.get(ply) ?? null;
  }

  /**
   * Real move selection via Stockfish (see StockfishEngine). Falls back to
   * a random/capture-biased legal move ONLY if the engine fails, times out,
   * or is unavailable — this must never throw or block the game. The
   * chosen move is validated through the same submitAction/chess.js path
   * as any human move; this method only proposes, it never mutates state
   * directly, so a bad engine response can never corrupt the game.
   */
  async requestAIRecommendation(
    matchId: string,
    playerId: string,
    difficulty: ChessDifficulty = DEFAULT_DIFFICULTY
  ): Promise<ChessAction | null> {
    const actions = this.getAvailableActions(matchId, playerId);
    if (actions.length === 0) return null;

    const record = this.requireMatch(matchId);
    const fen = record.chess.fen();

    const engineResult = await StockfishEngine.getBestMove(fen, difficulty);
    if (engineResult) {
      // Confirm the engine's proposed move is actually in the legal set
      // before trusting it — defense in depth against a stale/mismatched
      // FEN or an engine bug, per "AI must not enforce game legality".
      const isLegal = actions.some(
        (a) => a.from === engineResult.move.from && a.to === engineResult.move.to
      );
      if (isLegal) {
        record.lastEngineEval = { evaluationCp: engineResult.evaluationCp, mateIn: engineResult.mateIn };
        return engineResult.move;
      }
    }

    // Fallback path: engine unavailable/timed out/returned an illegal move.
    const captures = actions.filter((a) => {
      const target = record.chess.get(a.to as any);
      return !!target;
    });
    const pool = captures.length > 0 ? captures : actions;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---- internal helpers ----

  private requireMatch(matchId: string): MatchRecord {
    const record = this.matches.get(matchId);
    if (!record) throw new Error(`No chess match found for matchId ${matchId}`);
    return record;
  }

  private emit(
    record: MatchRecord,
    type: ChessGameEventType,
    actorPlayerId: string | null,
    payload: unknown
  ): GameEvent<ChessGameEventType> {
    const event: GameEvent<ChessGameEventType> = {
      id: uuid(),
      matchId: record.matchId,
      type,
      actorPlayerId,
      payload,
      timestamp: new Date().toISOString(),
    };
    for (const listener of record.listeners) listener(event);
    return event;
  }

  private toBoardState(chess: Chess): ChessBoardState {
    const history = chess.history({ verbose: true }) as Move[];
    const last = history[history.length - 1];
    return {
      fen: chess.fen(),
      pgn: chess.pgn(),
      turn: chess.turn(),
      inCheck: chess.inCheck(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw(),
      isGameOver: chess.isGameOver(),
      lastMove: last ? { from: last.from, to: last.to, san: last.san } : null,
      capturedByWhite: history.filter((m) => m.captured && m.color === "w").map((m) => m.captured!),
      capturedByBlack: history.filter((m) => m.captured && m.color === "b").map((m) => m.captured!),
    };
  }

  private totalMaterialOnBoard(chess: Chess): number {
    const board = chess.board();
    let total = 0;
    for (const row of board) {
      for (const square of row) {
        if (square) total += PIECE_VALUE[square.type] ?? 0;
      }
    }
    return total;
  }

  private materialScore(chess: Chess, players: PlayerRef[]): Record<string, number> {
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
    const score: Record<string, number> = {};
    for (const p of players) score[p.id] = p.color === "white" ? white : black;
    return score;
  }
}
