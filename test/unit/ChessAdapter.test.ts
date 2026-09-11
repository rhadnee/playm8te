import { describe, it, expect } from "vitest";
import { ChessAdapter } from "../../src/game/chess/ChessAdapter";
import { PlayerRef } from "../../src/types/game";

function makeMatch() {
  const adapter = new ChessAdapter();
  const white: PlayerRef = { id: "white-1", kind: "human", displayName: "White" };
  const black: PlayerRef = { id: "black-1", kind: "ai_companion", displayName: "Black" };
  const state = adapter.createMatch("m1", [white, black]);
  return { adapter, white, black, state };
}

describe("ChessAdapter", () => {
  it("starts a match with correct initial state", () => {
    const { state } = makeMatch();
    expect(state.currentPhase).toBe("IN_PROGRESS");
    expect(state.turnPlayerId).toBe("white-1");
    expect(state.board.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(state.availableActions.length).toBe(20); // 20 legal opening moves for white
  });

  it("accepts a legal move and updates state/turn", () => {
    const { adapter } = makeMatch();
    const result = adapter.submitAction("m1", "white-1", { from: "e2", to: "e4" });
    expect(result.state.board.fen).toContain("4P3");
    expect(result.state.turnPlayerId).toBe("black-1");
    expect(result.events.map((e) => e.type)).toContain("MOVE_PLAYED");
  });

  it("rejects an illegal move", () => {
    const { adapter } = makeMatch();
    expect(() => adapter.submitAction("m1", "white-1", { from: "e2", to: "e5" })).toThrow(/Illegal move/);
  });

  it("rejects a move submitted out of turn", () => {
    const { adapter } = makeMatch();
    expect(() => adapter.submitAction("m1", "black-1", { from: "e7", to: "e5" })).toThrow(/turn/);
  });

  it("detects checkmate and emits the correct event cascade (Scholar's Mate)", () => {
    const { adapter } = makeMatch();
    adapter.submitAction("m1", "white-1", { from: "e2", to: "e4" });
    adapter.submitAction("m1", "black-1", { from: "e7", to: "e5" });
    adapter.submitAction("m1", "white-1", { from: "f1", to: "c4" });
    adapter.submitAction("m1", "black-1", { from: "b8", to: "c6" });
    adapter.submitAction("m1", "white-1", { from: "d1", to: "h5" });
    adapter.submitAction("m1", "black-1", { from: "g8", to: "f6" });
    const result = adapter.submitAction("m1", "white-1", { from: "h5", to: "f7" });

    const types = result.events.map((e) => e.type);
    expect(types).toContain("CHECKMATE");
    expect(types).toContain("PLAYER_WON");
    expect(types).toContain("PLAYER_LOST");
    expect(types).toContain("ROUND_ENDED");
    expect(result.state.currentPhase).toBe("COMPLETE");

    const wonEvent = result.events.find((e) => e.type === "PLAYER_WON");
    const lostEvent = result.events.find((e) => e.type === "PLAYER_LOST");
    expect(wonEvent?.actorPlayerId).toBe("white-1");
    expect(lostEvent?.actorPlayerId).toBe("black-1");
  });

  it("does not emit PLAYER_WON/PLAYER_LOST for a stalemate — only MATCH_DRAWN", () => {
    const adapter = new ChessAdapter();
    const white: PlayerRef = { id: "w", kind: "human", displayName: "W", color: "white" };
    const black: PlayerRef = { id: "b", kind: "ai_companion", displayName: "B", color: "black" };
    // Black king cornered on a8; white queen one move from delivering the
    // classic queen stalemate (Qb1-b6: covers a7/b7/b8, king not in check).
    const setupFen = "k7/8/8/8/8/8/8/1Q5K w - - 0 1";
    adapter.restoreMatch("m2", [white, black], setupFen, 0);

    const result = adapter.submitAction("m2", "w", { from: "b1", to: "b6" });

    const types = result.events.map((e) => e.type);
    expect(result.state.board.isStalemate).toBe(true);
    expect(types).toContain("STALEMATE");
    expect(types).toContain("MATCH_DRAWN");
    expect(types).toContain("ROUND_ENDED");
    expect(types).not.toContain("PLAYER_WON");
    expect(types).not.toContain("PLAYER_LOST");
  });

  it("AI recommendation always returns a currently-legal move (via real Stockfish)", async () => {
    const { adapter } = makeMatch();
    adapter.submitAction("m1", "white-1", { from: "e2", to: "e4" });
    const state = adapter.getGameState("m1");
    const recommendation = await adapter.requestAIRecommendation("m1", "black-1", "EXPERT");
    expect(recommendation).not.toBeNull();
    const legal = state.availableActions.some(
      (a) => a.from === recommendation!.from && a.to === recommendation!.to
    );
    expect(legal).toBe(true);
  });

  it("REGRESSION: falls back to a legal random move if the engine is unavailable, never throws", async () => {
    const originalPath = process.env.STOCKFISH_PATH;
    process.env.STOCKFISH_PATH = "/nonexistent/binary";
    try {
      const { adapter } = makeMatch();
      const state = adapter.getGameState("m1");
      const recommendation = await adapter.requestAIRecommendation("m1", "black-1", "EXPERT");
      // black has no legal moves yet (white hasn't moved) — expect null, not a throw
      expect(recommendation).toBeNull();

      adapter.submitAction("m1", "white-1", { from: "e2", to: "e4" });
      const stateAfter = adapter.getGameState("m1");
      const fallbackMove = await adapter.requestAIRecommendation("m1", "black-1", "EXPERT");
      expect(fallbackMove).not.toBeNull();
      const legal = stateAfter.availableActions.some(
        (a) => a.from === fallbackMove!.from && a.to === fallbackMove!.to
      );
      expect(legal).toBe(true);
    } finally {
      if (originalPath === undefined) delete process.env.STOCKFISH_PATH;
      else process.env.STOCKFISH_PATH = originalPath;
    }
  });

  it("EXPERT difficulty finds a genuine mate-in-1 (Scholar's Mate finishing move)", async () => {
    const adapter = new ChessAdapter();
    const white: PlayerRef = { id: "w", kind: "ai_companion", displayName: "W", color: "white" };
    const black: PlayerRef = { id: "b", kind: "human", displayName: "B", color: "black" };
    // Position one move before Scholar's Mate (Qxf7#).
    const fen = "rnbqkb1r/pppp1ppp/5n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    adapter.restoreMatch("m4", [white, black], fen, 3);
    const recommendation = await adapter.requestAIRecommendation("m4", "w", "EXPERT");
    expect(recommendation).toEqual({ from: "h5", to: "f7" });
  });

  it("restoreMatch reconstructs a position from FEN with correct turn/color mapping", () => {
    const adapter = new ChessAdapter();
    const white: PlayerRef = { id: "w1", kind: "human", displayName: "W", color: "white" };
    const black: PlayerRef = { id: "b1", kind: "ai_companion", displayName: "B", color: "black" };
    // Position after 1. e4 c6 (Caro-Kann) — black to move next... actually white to move.
    const fen = "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    adapter.restoreMatch("m3", [white, black], fen, 2);
    const state = adapter.getGameState("m3");
    expect(state.turnPlayerId).toBe("w1");
    expect(state.board.fen).toBe(fen);
    // Confirm play can continue correctly from the restored position.
    const result = adapter.submitAction("m3", "w1", { from: "g1", to: "f3" });
    expect(result.state.turnPlayerId).toBe("b1");
  });
});
