export type ChessDifficulty = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";

export interface DifficultyProfile {
  /** Stockfish Skill Level (0-20). Lower = weaker/more human-like mistakes. */
  skillLevel: number;
  /** Caps Stockfish's actual playing strength independent of Skill Level. */
  limitStrength: boolean;
  /** Only used when limitStrength is true. Range 1320-3190 per Stockfish 16. */
  elo?: number;
  /** Time budget per move in milliseconds — bounds worst-case latency. */
  movetimeMs: number;
}

/**
 * Difficulty is data, not branching logic — adding a fifth tier or
 * retuning an existing one is a one-line change here, not a code change in
 * StockfishEngine or ChessAdapter.
 */
export const DIFFICULTY_PRESETS: Record<ChessDifficulty, DifficultyProfile> = {
  BEGINNER: { skillLevel: 1, limitStrength: true, elo: 1350, movetimeMs: 300 },
  INTERMEDIATE: { skillLevel: 8, limitStrength: true, elo: 1700, movetimeMs: 600 },
  ADVANCED: { skillLevel: 15, limitStrength: true, elo: 2200, movetimeMs: 1000 },
  EXPERT: { skillLevel: 20, limitStrength: false, movetimeMs: 1500 },
};

export const DEFAULT_DIFFICULTY: ChessDifficulty = "INTERMEDIATE";

/**
 * Used exclusively for post-move ANALYSIS (evaluation, move-quality
 * classification), never for gameplay. Analysis must always run at full
 * engine strength regardless of the opponent's configured play strength —
 * a BEGINNER-difficulty game should still get accurate "was that a
 * blunder?" facts, not weakened analysis that matches how badly the
 * companion itself plays.
 */
export const ANALYSIS_PROFILE: DifficultyProfile = {
  skillLevel: 20,
  limitStrength: false,
  movetimeMs: 400, // shorter than EXPERT gameplay movetime — analysis runs twice per move (before+after) and must stay responsive
};
