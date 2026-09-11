import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config, assertProductionConfig } from "./config";
import { pool, pingDatabase } from "./db/pool";
import { CompanionRepository } from "./db/repositories/CompanionRepository";
import { buildApp, restoreActiveMatches } from "./app";
import { logger } from "./logging/logger";
import { ChatMessageSchema } from "./schemas/requests";

assertProductionConfig();

const matchSockets = new Map<string, Set<WebSocket>>();

function broadcastToMatch(matchId: string, payload: unknown): void {
  const sockets = matchSockets.get(matchId);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

async function main(): Promise<void> {
  const dbOk = await pingDatabase();
  if (!dbOk) {
    logger.error("Cannot reach the database at startup — check DATABASE_URL. Exiting.");
    process.exit(1);
  }

  const deps = buildApp(pool, broadcastToMatch);
  const companions = new CompanionRepository(pool);

  const restoredCount = await restoreActiveMatches(deps, companions, broadcastToMatch);
  logger.info({ restoredCount }, "restored in-progress matches from database after startup");

  const server = http.createServer(deps.app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (socket, req) => {
    // WebSocket connections aren't subject to the cors() middleware above
    // (that only governs HTTP requests) — browsers don't enforce
    // same-origin restrictions on WS the way they do on fetch/XHR, so this
    // is manual origin validation, production-only. In development the
    // frontend may be served from several different local origins
    // (same-process, a static file server, etc.), so this only tightens in
    // production, where the frontend origin is known and fixed.
    if (config.nodeEnv === "production" && config.frontendUrl) {
      const origin = req.headers.origin;
      if (origin !== config.frontendUrl) {
        socket.close(1008, "origin not allowed");
        return;
      }
    }

    const url = new URL(req.url ?? "", "http://localhost");
    const matchId = url.searchParams.get("matchId");
    const token = url.searchParams.get("token");

    if (!matchId || !token) {
      socket.close(1008, "matchId and token query params are required");
      return;
    }

    let userId: string;
    try {
      const payload = deps.authService.verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      socket.close(1008, "invalid or expired token");
      return;
    }

    const isMember = await deps.matchRepo.isUserInMatch(matchId, userId);
    if (!isMember) {
      socket.close(1008, "not a participant in this match");
      return;
    }

    const set = matchSockets.get(matchId) ?? new Set<WebSocket>();
    set.add(socket);
    matchSockets.set(matchId, set);
    logger.info({ matchId, userId }, "websocket connected");

    socket.on("close", () => {
      set.delete(socket);
      logger.info({ matchId, userId }, "websocket disconnected");
    });

    socket.on("message", async (raw) => {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "malformed JSON" }));
          return;
        }

        const msg = parsed as { type?: string; text?: string };
        if (msg.type !== "player_chat") return;

        const validation = ChatMessageSchema.safeParse({ text: msg.text });
        if (!validation.success) {
          socket.send(JSON.stringify({ type: "error", message: "invalid chat payload" }));
          return;
        }

        const players = await deps.matchRepo.findPlayers(matchId);
        const companionPlayer = players.find((p) => p.player_kind === "ai_companion");
        if (!companionPlayer?.companion_id) return;
        const companion = await companions.findById(companionPlayer.companion_id);
        if (!companion) return;

        const state = deps.chessAdapter.getGameState(matchId);
        const chessContext = deps.chessAdapter.getLastAnalysis(matchId);
        const reply = await deps.conversationService.respondToPlayerMessage(
          {
            companionId: companion.id,
            playerId: userId,
            personalityId: companion.personality_id,
            companionName: companion.name,
          },
          validation.data.text,
          state,
          chessContext
        );
        broadcastToMatch(matchId, { type: "companion_message", message: reply });
      } catch (err) {
        logger.error({ err, matchId }, "failed to handle websocket message");
      }
    });
  });

  server.listen(config.port, () => {
    logger.info({ port: config.port }, "Playm8te MVP server listening");
  });

  // Managed hosts (Render, Railway, Fly.io) send SIGTERM before killing a
  // container on redeploy/scale-down — without handling it, in-flight
  // requests and open WebSocket connections get dropped abruptly instead
  // of closed cleanly, and the DB pool never gets a chance to close its
  // connections.
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down gracefully");

    // Stop accepting new HTTP connections.
    server.close(() => logger.info("http server closed"));

    // Close all live WebSocket connections with a clean code so clients
    // know to reconnect rather than treating it as an error.
    for (const sockets of matchSockets.values()) {
      for (const socket of sockets) {
        socket.close(1001, "server shutting down");
      }
    }
    wss.close();

    try {
      await pool.end();
      logger.info("database pool closed");
    } catch (err) {
      logger.error({ err }, "error closing database pool during shutdown");
    }

    // Give in-flight logs/sockets a brief moment to flush before exiting.
    setTimeout(() => process.exit(0), 300).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
