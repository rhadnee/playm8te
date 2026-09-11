/**
 * Core, game-agnostic contracts.
 *
 * These types are deliberately generic so that a future GameAdapter for a
 * different title (not chess) can implement the same interface. Chess is the
 * first concrete implementation (see src/game/chess/ChessAdapter.ts).
 */

export type MatchPhase =
  | "WAITING_FOR_PLAYERS"
  | "IN_PROGRESS"
  | "PAUSED"
  | "COMPLETE";

export type PlayerColor = "white" | "black";

export interface PlayerRef {
  id: string;
  kind: "human" | "ai_companion";
  displayName: string;
  color?: PlayerColor;
}

/**
 * Generic, game-agnostic event names. Game-specific adapters may emit
 * additional event types (see ChessGameEventType) but MUST also map them
 * onto this base shape so downstream services (memory, analytics) can
 * reason about matches without knowing the game.
 */
export type BaseGameEventType =
  | "ROUND_STARTED"
  | "ROUND_ENDED"
  | "PLAYER_MADE_MISTAKE"
  | "PLAYER_PERFORMED_EXCEPTIONALLY"
  | "PLAYER_WON"
  | "PLAYER_LOST"
  | "MATCH_DRAWN"
  | "PLAYER_LOW_HEALTH"; // kept for interface parity with non-chess games; unused by chess

export interface GameEvent<TType extends string = BaseGameEventType, TPayload = unknown> {
  id: string;
  matchId: string;
  type: TType;
  actorPlayerId: string | null;
  payload: TPayload;
  timestamp: string; // ISO 8601
}

/**
 * Structured, deterministic game state. The language model should never be
 * asked to infer any of this — it is always computed by the game engine and
 * handed to the AI as context.
 */
export interface GameState<TBoard = unknown, TAction = unknown> {
  matchId: string;
  players: PlayerRef[];
  currentPhase: MatchPhase;
  turnPlayerId: string | null;
  board: TBoard;
  score: Record<string, number>;
  objectives: string[];
  recentEvents: GameEvent<string>[];
  availableActions: TAction[];
  moveNumber: number;
  timestamp: string;
}

/**
 * Every supported game (chess today, others later) implements this.
 * This is the seed of the future Playm8te SDK's GameAdapter interface.
 */
export interface GameAdapter<TBoard = unknown, TAction = unknown, TEventType extends string = string> {
  readonly gameId: string;

  /** Create a new match and return its initial state. */
  createMatch(matchId: string, players: PlayerRef[]): GameState<TBoard, TAction>;

  /** Current deterministic state snapshot. */
  getGameState(matchId: string): GameState<TBoard, TAction>;

  /** Legal actions for the given player right now. */
  getAvailableActions(matchId: string, playerId: string): TAction[];

  /** Apply a player or AI action; returns emitted events + new state. */
  submitAction(
    matchId: string,
    playerId: string,
    action: TAction
  ): { state: GameState<TBoard, TAction>; events: GameEvent<TEventType>[] };

  /** Subscribe to events emitted by this match. */
  onGameEvent(matchId: string, handler: (event: GameEvent<TEventType>) => void): void;

  /** Ask the AI-decision layer for a recommendation (used by AI companion or coaching). */
  requestAIRecommendation?(matchId: string, playerId: string): Promise<TAction | null>;
}
