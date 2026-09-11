import express, { Express } from "express";
import cors from "cors";
import path from "path";
import { Pool } from "pg";
import { requestContext } from "./logging/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { pingDatabase } from "./db/pool";
import { UserRepository } from "./db/repositories/UserRepository";
import { RefreshTokenRepository } from "./db/repositories/RefreshTokenRepository";
import { CompanionRepository } from "./db/repositories/CompanionRepository";
import { MatchRepository } from "./db/repositories/MatchRepository";
import { MemoryRepository } from "./db/repositories/MemoryRepository";
import { AuthService } from "./services/AuthService";
import { PersonalityService } from "./services/PersonalityService";
import { MemoryService } from "./services/MemoryService";
import { SafetyService } from "./services/SafetyService";
import { ConversationService } from "./services/ConversationService";
import { DecisionLoop } from "./services/DecisionLoop";
import { ChessAdapter } from "./game/chess/ChessAdapter";
import { StockfishEngine } from "./services/chess/StockfishEngine";
import { AIProvider } from "./services/ai/AIProvider";
import { AnthropicProvider } from "./services/ai/AnthropicProvider";
import { config } from "./config";
import { authRoutes } from "./routes/auth";
import { companionRoutes } from "./routes/companions";
import { matchRoutes } from "./routes/matches";

class DeterministicFallbackProvider implements AIProvider {
  readonly name = "fallback";
  async complete() {
    const lines = ["Good move.", "Let's see what you've got.", "Nice.", "Careful there."];
    return { text: lines[Math.floor(Math.random() * lines.length)] };
  }
}

export interface AppDependencies {
  app: Express;
  chessAdapter: ChessAdapter;
  decisionLoop: DecisionLoop;
  matchRepo: MatchRepository;
  authService: AuthService;
  conversationService: ConversationService;
}

/**
 * Builds the Express app and all in-process services. `broadcast` is
 * supplied by the caller (index.ts wires it to the WebSocket layer) so this
 * module has no direct dependency on `ws` — keeps it testable without a
 * live socket server.
 */
export function buildApp(pool: Pool, broadcast: (matchId: string, payload: unknown) => void): AppDependencies {
  const app = express();

  // In development, the frontend is typically served by this same process
  // (see express.static below) or from a local dev server on a different
  // port — permissive CORS is fine since nothing sensitive is exposed
  // locally. In production, the frontend is a separate Netlify origin, so
  // CORS is locked to exactly that origin — never a wildcard, since
  // requests carry Authorization: Bearer tokens.
  app.use(
    cors({
      origin: config.nodeEnv === "production" ? config.frontendUrl : true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json());
  app.use(requestContext);

  // Minimal Arena web client — lets a real person actually play through
  // register→create M8→chess→chat→result without needing a mobile app.
  // __dirname is dist/ at runtime (after tsc), so this resolves to
  // <project root>/public regardless of whether it's run from source or build.
  app.use(express.static(path.join(__dirname, "..", "public")));

  const users = new UserRepository(pool);
  const refreshTokens = new RefreshTokenRepository(pool);
  const companions = new CompanionRepository(pool);
  const matchRepo = new MatchRepository(pool);
  const memoryRepo = new MemoryRepository(pool);

  const authService = new AuthService(users, refreshTokens);
  const personalityService = new PersonalityService();
  const memoryService = new MemoryService(memoryRepo);
  const safetyService = new SafetyService();

  const aiProvider: AIProvider = config.ai.anthropicApiKey
    ? new AnthropicProvider(config.ai.anthropicApiKey, config.ai.model)
    : new DeterministicFallbackProvider();

  if (!config.ai.anthropicApiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      "[startup] ANTHROPIC_API_KEY not set — using DeterministicFallbackProvider. " +
        "Companion replies will be generic placeholders until a real key is configured."
    );
  }

  const conversationService = new ConversationService(aiProvider, personalityService, memoryService, safetyService);
  const chessAdapter = new ChessAdapter();
  const decisionLoop = new DecisionLoop(chessAdapter, conversationService, memoryService);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    const [dbOk, stockfishOk] = await Promise.all([pingDatabase(), StockfishEngine.isAvailable()]);
    const allOk = dbOk && stockfishOk;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ready" : "degraded",
      database: dbOk ? "healthy" : "unavailable",
      // Chess still works if Stockfish is down (ChessAdapter falls back to
      // a legal random move, and ChessContextEngine reports
      // engineAvailable: false rather than hallucinating analysis) — this
      // is reported as "degraded," not a hard failure, so the process
      // doesn't get killed just because the engine binary is temporarily
      // missing. Still returns 503 so orchestrators can page on it.
      stockfish: stockfishOk ? "healthy" : "unavailable",
    });
  });

  app.get("/api/personalities", (_req, res) => {
    res.json(personalityService.list());
  });

  app.use("/api/auth", authRoutes(authService));
  app.use("/api/companions", companionRoutes(authService, companions, personalityService));
  app.use("/api/matches", matchRoutes(authService, companions, matchRepo, chessAdapter, decisionLoop, broadcast));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, chessAdapter, decisionLoop, matchRepo, authService, conversationService };
}

/**
 * Reconstructs in-progress matches from the database into the in-memory
 * ChessAdapter after a restart, and re-attaches each one's decision loop —
 * this is what makes "core state survives restart" true rather than aspirational.
 */
export async function restoreActiveMatches(
  deps: AppDependencies,
  companions: CompanionRepository,
  broadcast: (matchId: string, payload: unknown) => void
): Promise<number> {
  const active = await deps.matchRepo.findActiveMatches();
  let restored = 0;
  for (const match of active) {
    const players = await deps.matchRepo.findPlayers(match.id);
    const white = players.find((p) => p.color === "white");
    const black = players.find((p) => p.color === "black");
    if (!white || !black) continue;

    const toPlayerRef = async (p: (typeof players)[number]) => {
      if (p.player_kind === "human") {
        return { id: p.user_id!, kind: "human" as const, displayName: p.user_id!, color: p.color };
      }
      const companion = await companions.findById(p.companion_id!);
      return {
        id: p.companion_id!,
        kind: "ai_companion" as const,
        displayName: companion?.name ?? "M8",
        color: p.color,
      };
    };

    // Engine state is persisted as { board: ChessBoardState, moveNumber }
    // (see routes/matches.ts saveEngineState calls). Older rows saved
    // before this shape existed only have the bare ChessBoardState with no
    // moveNumber recorded at all — there is no way to recover the exact
    // ply count for those from FEN alone (FEN's fullmove counter is
    // coarser than our ply-based moveNumber), so we fall back to 0 for
    // that legacy shape only, and log it rather than pretending it's
    // correct.
    const persisted = match.engine_state as
      | { board?: { fen?: string }; moveNumber?: number; fen?: string }
      | null;
    const fen = persisted?.board?.fen ?? persisted?.fen;
    if (!fen) continue; // nothing to restore from (e.g. match created but no move yet)

    let moveNumber: number;
    if (persisted?.board?.fen && typeof persisted.moveNumber === "number") {
      moveNumber = persisted.moveNumber;
    } else {
      moveNumber = 0;
      // eslint-disable-next-line no-console
      console.warn(
        `[restoreActiveMatches] match ${match.id} has legacy engine_state without a recorded moveNumber — ` +
          `restoring with moveNumber=0. Move-number display may be off for this match until it completes; ` +
          `FEN/turn/legality are still correct and unaffected.`
      );
    }

    deps.chessAdapter.restoreMatch(match.id, [await toPlayerRef(white), await toPlayerRef(black)], fen, moveNumber);

    const aiPlayer = [white, black].find((p) => p.player_kind === "ai_companion");
    const humanPlayer = [white, black].find((p) => p.player_kind === "human");
    if (aiPlayer?.companion_id && humanPlayer?.user_id) {
      const companion = await companions.findById(aiPlayer.companion_id);
      if (companion) {
        deps.decisionLoop.attach(
          match.id,
          {
            companionId: companion.id,
            playerId: humanPlayer.user_id,
            personalityId: companion.personality_id,
            companionName: companion.name,
          },
          (mId, message) => broadcast(mId, { type: "companion_message", message })
        );
      }
    }
    restored++;
  }
  return restored;
}
