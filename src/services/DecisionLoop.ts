import { GameAdapter, GameEvent } from "../types/game";

type AnyGameEvent = GameEvent<string>;
import { ConversationService, CompanionContext } from "./ConversationService";
import { MemoryService } from "./MemoryService";

/**
 * The AI must NOT reason on every frame/event. This is the relevance
 * filter: only these event types are worth a companion reaction. Everything
 * else (e.g. routine MOVE_PLAYED with nothing notable) is dropped here,
 * before it ever reaches the AI provider.
 */
const REACTION_WORTHY_EVENTS = new Set([
  "CHECK_GIVEN",
  "CHECKMATE",
  "STALEMATE",
  "PIECE_BLUNDERED",
  "GOOD_TACTIC_FOUND",
  "PLAYER_WON",
  "PLAYER_LOST",
  "MATCH_DRAWN",
  "ROUND_STARTED",
]);

export type CompanionMessageHandler = (matchId: string, message: string) => void;

/**
 * Wires a GameAdapter's event stream to the AI decision loop for a single
 * match: GAME EVENT -> RELEVANCE FILTER -> AI DECISION -> COMMUNICATION -> MEMORY UPDATE.
 */
export class DecisionLoop {
  constructor(
    private gameAdapter: GameAdapter,
    private conversationService: ConversationService,
    private memoryService: MemoryService
  ) {}

  attach(matchId: string, ctx: CompanionContext, onMessage: CompanionMessageHandler): void {
    this.gameAdapter.onGameEvent(matchId, (event: AnyGameEvent) => {
      // Fire-and-forget; gameplay must never block on AI response generation.
      this.handleEvent(matchId, ctx, event, onMessage).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[DecisionLoop] failed to handle event ${event.type} for match ${matchId}:`, err);
      });
    });
  }

  private async handleEvent(
    matchId: string,
    ctx: CompanionContext,
    event: AnyGameEvent,
    onMessage: CompanionMessageHandler
  ): Promise<void> {
    // RELEVANCE FILTER
    if (!REACTION_WORTHY_EVENTS.has(event.type)) return;

    // Only react to events relevant to the human player's side of the board
    // (i.e. don't narrate every single thing symmetrically for both players
    // in a human-vs-human-plus-companion setup). MVP: react to all for now,
    // refine targeting once multiple companions coexist in one match.

    const state = this.gameAdapter.getGameState(matchId);

    // AI DECISION + PLAYER COMMUNICATION
    const message = await this.conversationService.reactToEvent(ctx, event, state);
    onMessage(matchId, message);

    // MEMORY UPDATE
    if (event.type === "PIECE_BLUNDERED") {
      this.memoryService.addShortTerm({
        matchId,
        companionId: ctx.companionId,
        category: "recurring_mistake",
        note: `Blundered material around move ${state.moveNumber}.`,
        createdAt: new Date().toISOString(),
      });
    }
    // MEMORY UPDATE.
    // Consolidate on ROUND_ENDED only — a match emits exactly one of these
    // per completion. Previously this fired on PLAYER_WON/PLAYER_LOST too,
    // but a checkmate emits BOTH for the same match, and since event
    // handlers run concurrently (fire-and-forget, see attach() above), both
    // handlers read the same short-term entries before either cleared them
    // — double-counting every observation. ROUND_ENDED is the single
    // canonical "this match just ended" signal.
    if (event.type === "ROUND_ENDED") {
      await this.memoryService.consolidateMatch(matchId, ctx.companionId, ctx.playerId);
    }
  }
}
