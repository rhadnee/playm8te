import { spawn } from "child_process";
import { ChessDifficulty, DifficultyProfile, DIFFICULTY_PRESETS, ANALYSIS_PROFILE } from "./difficultyPresets";

export interface EngineMove {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

export interface EngineResult {
  move: EngineMove;
  /** Centipawn evaluation from the side-to-move's perspective, or null if a mate score was returned instead. */
  evaluationCp: number | null;
  /** Moves to mate (positive = side to move mates, negative = gets mated), or null if not a forced mate. */
  mateIn: number | null;
}

function resolveStockfishPath(): string {
  return process.env.STOCKFISH_PATH ?? "/usr/games/stockfish";
}
const HARD_TIMEOUT_MS = 5000; // absolute ceiling regardless of configured movetime — see AI failure behavior notes below

function parseUciMove(uci: string): EngineMove {
  // UCI move format: e2e4, or e7e8q for a promotion.
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? (uci[4] as EngineMove["promotion"]) : undefined;
  return { from, to, promotion };
}

/**
 * Thin wrapper around the Stockfish UCI process. Spawns a fresh process per
 * request rather than pooling a long-lived one — simpler and safer under
 * concurrent matches (no shared-state races between unrelated games), at
 * the cost of ~30-80ms process-startup overhead per call. Acceptable
 * against the "near-instant server acknowledgement" target for now;
 * pooling is a documented follow-up if this becomes a bottleneck under load
 * (see docs/TECHNICAL_DEBT.md).
 *
 * Per the "AI must not enforce game legality" architecture: this class only
 * ever proposes a move. It is the caller's (ChessAdapter's) job to actually
 * apply it through the real game-rules engine — Stockfish's own legality
 * guarantee is trusted for the proposal, but ChessAdapter.submitAction
 * still validates through chess.js like any other move, so a malformed or
 * stale engine response can never corrupt game state.
 */
export class StockfishEngine {
  /**
   * Returns Stockfish's chosen move for the given position, or null if the
   * engine fails/times out/returns no move — callers MUST treat null as
   * "fall back to a non-engine move", never as an error to propagate and
   * block the game on. Uses a named gameplay difficulty (weakened play).
   */
  static async getBestMove(fen: string, difficulty: ChessDifficulty): Promise<EngineResult | null> {
    return StockfishEngine.run(fen, DIFFICULTY_PRESETS[difficulty]);
  }

  /**
   * Analysis entry point — always runs at full engine strength
   * (ANALYSIS_PROFILE), regardless of the opponent's configured play
   * difficulty. Used by ChessContextEngine to produce facts (evaluation,
   * move quality) that must stay accurate even in a BEGINNER-difficulty
   * game where the companion itself is deliberately playing worse.
   */
  static async evaluate(fen: string): Promise<EngineResult | null> {
    return StockfishEngine.run(fen, ANALYSIS_PROFILE);
  }

  /**
   * Cheap liveness check: can we spawn the binary and get a UCI handshake
   * back at all? Used by /ready so the app can honestly report
   * "stockfish: unavailable" instead of silently degrading to random moves
   * without telling anyone.
   */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          proc.kill();
        } catch {
          /* already exited */
        }
        resolve(ok);
      };

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(resolveStockfishPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => finish(false), 3000);
      proc.on("error", () => finish(false));
      proc.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("uciok")) finish(true);
      });
      proc.stdin?.write("uci\n");
    });
  }

  private static async run(fen: string, profile: DifficultyProfile): Promise<EngineResult | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: EngineResult | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        try {
          proc.kill();
        } catch {
          /* already exited */
        }
        resolve(result);
      };

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(resolveStockfishPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        resolve(null);
        return;
      }

      const hardTimeout = setTimeout(() => finish(null), HARD_TIMEOUT_MS);

      let buffer = "";
      let lastEvalCp: number | null = null;
      let lastMateIn: number | null = null;

      proc.on("error", () => finish(null));

      proc.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          // Track the most recent evaluation reported during search, so we
          // can hand it to ConversationService for grounded explanations
          // ("I took because I was up material") instead of the LLM
          // guessing at the position's evaluation.
          const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
          if (scoreMatch) {
            if (scoreMatch[1] === "cp") {
              lastEvalCp = parseInt(scoreMatch[2], 10);
              lastMateIn = null;
            } else {
              lastMateIn = parseInt(scoreMatch[2], 10);
              lastEvalCp = null;
            }
          }

          if (line.startsWith("bestmove")) {
            const parts = line.trim().split(/\s+/);
            const uciMove = parts[1];
            if (!uciMove || uciMove === "(none)") {
              finish(null);
              return;
            }
            finish({ move: parseUciMove(uciMove), evaluationCp: lastEvalCp, mateIn: lastMateIn });
            return;
          }
        }
      });

      const send = (cmd: string) => proc.stdin?.write(cmd + "\n");

      send("uci");
      send(`setoption name Skill Level value ${profile.skillLevel}`);
      send(`setoption name UCI_LimitStrength value ${profile.limitStrength}`);
      if (profile.limitStrength && profile.elo) {
        send(`setoption name UCI_Elo value ${profile.elo}`);
      }
      send("isready");
      send(`position fen ${fen}`);
      send(`go movetime ${profile.movetimeMs}`);
    });
  }
}
