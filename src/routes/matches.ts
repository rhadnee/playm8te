import { Router } from "express";
import { v4 as uuid } from "uuid";
import { AuthService } from "../services/AuthService";
import { CompanionRepository } from "../db/repositories/CompanionRepository";
import { MatchRepository } from "../db/repositories/MatchRepository";
import { ChessAdapter } from "../game/chess/ChessAdapter";
import { DecisionLoop } from "../services/DecisionLoop";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { CreateMatchSchema, MatchIdParamSchema, SubmitMoveSchema } from "../schemas/requests";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { matchCreationRateLimiter } from "../middleware/rateLimit";
import { PlayerRef } from "../types/game";

type BroadcastFn = (matchId: string, payload: unknown) => void;

export function matchRoutes(
  authService: AuthService,
  companions: CompanionRepository,
  matchRepo: MatchRepository,
  chessAdapter: ChessAdapter,
  decisionLoop: DecisionLoop,
  broadcast: BroadcastFn
): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.post("/", matchCreationRateLimiter, validate({ body: CreateMatchSchema }), async (req, res, next) => {
    try {
      const { companionId } = req.body;
      const companion = await companions.findById(companionId);
      if (!companion) throw new NotFoundError("Companion not found");
      // A player can only play with their own companion — prevents using
      // someone else's companion (and its personality/memory) without authorization.
      if (companion.owner_id !== req.user!.id) {
        throw new ForbiddenError("You do not own this companion");
      }

      const matchId = uuid();
      const human: PlayerRef = { id: req.user!.id, kind: "human", displayName: req.user!.email };
      const companionRef: PlayerRef = { id: companion.id, kind: "ai_companion", displayName: companion.name };

      const state = chessAdapter.createMatch(matchId, [human, companionRef]);
      await matchRepo.createMatch(matchId, "chess", req.user!.id, state.players);
      await matchRepo.saveEngineState(matchId, { board: state.board, moveNumber: state.moveNumber }, "IN_PROGRESS", null);

      decisionLoop.attach(
        matchId,
        {
          companionId: companion.id,
          playerId: req.user!.id,
          personalityId: companion.personality_id,
          companionName: companion.name,
        },
        (mId, message) => broadcast(mId, { type: "companion_message", message })
      );

      res.status(201).json(state);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:matchId", validate({ params: MatchIdParamSchema }), async (req, res, next) => {
    try {
      const matchId = req.params.matchId as string;
      const isMember = await matchRepo.isUserInMatch(matchId, req.user!.id);
      if (!isMember) throw new ForbiddenError("You are not a participant in this match");
      res.json(chessAdapter.getGameState(matchId));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:matchId/moves",
    validate({ params: MatchIdParamSchema, body: SubmitMoveSchema }),
    async (req, res, next) => {
      try {
        const matchId = req.params.matchId as string;
        const isMember = await matchRepo.isUserInMatch(matchId, req.user!.id);
        if (!isMember) throw new ForbiddenError("You are not a participant in this match");

        const { from, to, promotion } = req.body;
        // req.user.id is the server-verified identity — the client cannot
        // submit a move as anyone else, unlike the earlier prototype which
        // trusted a client-supplied playerId.
        let result;
        try {
          result = chessAdapter.submitAction(matchId, req.user!.id, { from, to, promotion });
        } catch (gameErr) {
          // ChessAdapter throws plain Errors for illegal moves / wrong-turn
          // violations — these are client input problems (400), not server
          // faults (500).
          throw new ValidationError({ move: (gameErr as Error).message });
        }

        await matchRepo.saveEngineState(
          matchId,
          { board: result.state.board, moveNumber: result.state.moveNumber },
          result.state.currentPhase === "COMPLETE" ? "COMPLETE" : "IN_PROGRESS",
          result.state.currentPhase === "COMPLETE" ? classifyResult(result.events) : null
        );
        await matchRepo.appendEvents(
          matchId,
          result.events.map((e) => ({ type: e.type, actorPlayerId: e.actorPlayerId, payload: e.payload }))
        );

        if (result.state.currentPhase === "COMPLETE") {
          await recordStatistics(matchRepo, matchId, result.events);
        }

        broadcast(matchId, { type: "state_update", state: result.state, events: result.events });

        // If it's now the AI companion's turn and the match isn't over, the
        // engine (not the LLM) picks and plays its move immediately — the
        // game rules/legality live entirely in ChessAdapter, matching the
        // "AI must not enforce game legality" requirement.
        let aiMoveResult: typeof result | null = null;
        if (result.state.currentPhase !== "COMPLETE" && result.state.turnPlayerId) {
          const turnPlayer = result.state.players.find((p) => p.id === result.state.turnPlayerId);
          if (turnPlayer?.kind === "ai_companion") {
            const companionRow = await companions.findById(turnPlayer.id);
            const difficulty = companionRow?.chess_difficulty ?? "INTERMEDIATE";
            const recommendation = await chessAdapter.requestAIRecommendation?.(matchId, turnPlayer.id, difficulty);
            if (recommendation) {
              aiMoveResult = chessAdapter.submitAction(matchId, turnPlayer.id, recommendation);
              await matchRepo.saveEngineState(
                matchId,
                { board: aiMoveResult.state.board, moveNumber: aiMoveResult.state.moveNumber },
                aiMoveResult.state.currentPhase === "COMPLETE" ? "COMPLETE" : "IN_PROGRESS",
                aiMoveResult.state.currentPhase === "COMPLETE" ? classifyResult(aiMoveResult.events) : null
              );
              await matchRepo.appendEvents(
                matchId,
                aiMoveResult.events.map((e) => ({
                  type: e.type,
                  actorPlayerId: e.actorPlayerId,
                  payload: e.payload,
                }))
              );
              if (aiMoveResult.state.currentPhase === "COMPLETE") {
                await recordStatistics(matchRepo, matchId, aiMoveResult.events);
              }
              broadcast(matchId, {
                type: "state_update",
                state: aiMoveResult.state,
                events: aiMoveResult.events,
              });
            }
          }
        }

        res.json(aiMoveResult ?? result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

function classifyResult(events: Array<{ type: string }>): string {
  if (events.some((e) => e.type === "CHECKMATE")) return "checkmate";
  if (events.some((e) => e.type === "STALEMATE")) return "stalemate";
  if (events.some((e) => e.type === "MATCH_DRAWN")) return "draw";
  return "unknown";
}

async function recordStatistics(
  matchRepo: MatchRepository,
  matchId: string,
  events: Array<{ type: string; actorPlayerId: string | null }>
): Promise<void> {
  // Idempotency guard: match completion can currently be reached from more
  // than one call site in this handler (human move vs. AI auto-move); this
  // ensures stats are only ever written once per match regardless.
  const claimed = await matchRepo.claimStatsRecording(matchId);
  if (!claimed) return;

  const players = await matchRepo.findPlayers(matchId);
  const isDraw = events.some((e) => e.type === "MATCH_DRAWN");

  if (isDraw) {
    // Stalemate/draw emits MATCH_DRAWN + ROUND_ENDED but NOT PLAYER_WON /
    // PLAYER_LOST — there is no "winner" actor to read a user id from. Get
    // the human participant directly from match membership instead.
    const humanUserId = players.find((p) => p.player_kind === "human")?.user_id ?? null;
    await matchRepo.recordDraw([humanUserId]);
    return;
  }

  const winnerEvent = events.find((e) => e.type === "PLAYER_WON");
  const loserEvent = events.find((e) => e.type === "PLAYER_LOST");
  const winnerUserId = players.find((p) => p.user_id === winnerEvent?.actorPlayerId)?.user_id ?? null;
  const loserUserId = players.find((p) => p.user_id === loserEvent?.actorPlayerId)?.user_id ?? null;

  await matchRepo.recordDecisiveResult(matchId, winnerUserId, loserUserId);
}
