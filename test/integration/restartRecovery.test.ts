import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createTestPool, resetTestData } from "../helpers/db";
import { buildApp, restoreActiveMatches, AppDependencies } from "../../src/app";
import { CompanionRepository } from "../../src/db/repositories/CompanionRepository";
import request from "supertest";

describe("Restart recovery (integration, real Postgres)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await resetTestData(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function registerAndSetup(appDeps: AppDependencies, email: string) {
    const reg = await request(appDeps.app)
      .post("/api/auth/register")
      .send({ email, password: "correcthorsebattery", displayName: "Restart" });
    const token = reg.body.accessToken as string;

    const companionRes = await request(appDeps.app)
      .post("/api/companions")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nova", avatarKey: "a1", personalityId: "coach", chessDifficulty: "BEGINNER" });

    const matchRes = await request(appDeps.app)
      .post("/api/matches")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: companionRes.body.id });

    return { token, matchId: matchRes.body.matchId as string };
  }

  it(
    "REGRESSION: moveNumber survives a simulated restart, not just FEN/turn " +
      "(previously hardcoded to 0 on every restore)",
    async () => {
      // Simulate "server instance A": build the app, play two real moves
      // (one human, one AI auto-move happens server-side in the same
      // request), so moveNumber should be 2 by the time we "restart."
      const instanceA = buildApp(pool, () => {});
      const { token, matchId } = await registerAndSetup(instanceA, "restart-a@example.com");

      const moveRes = await request(instanceA.app)
        .post(`/api/matches/${matchId}/moves`)
        .set("Authorization", `Bearer ${token}`)
        .send({ from: "e2", to: "e4" });

      expect(moveRes.status).toBe(200);
      const moveNumberBeforeRestart = moveRes.body.state.moveNumber;
      // Human move + AI auto-move = 2 plies, not 1 and not the old bug's 0.
      expect(moveNumberBeforeRestart).toBe(2);
      const fenBeforeRestart = moveRes.body.state.board.fen;
      const turnBeforeRestart = moveRes.body.state.turnPlayerId;

      // Simulate "server instance B" — a completely fresh ChessAdapter with
      // no in-memory state, exactly like a real process restart. The only
      // thing carried over is what's in Postgres.
      const instanceB = buildApp(pool, () => {});
      const companions = new CompanionRepository(pool);
      const restoredCount = await restoreActiveMatches(instanceB, companions, () => {});
      expect(restoredCount).toBeGreaterThanOrEqual(1);

      const stateAfterRestart = instanceB.chessAdapter.getGameState(matchId);
      expect(stateAfterRestart.board.fen).toBe(fenBeforeRestart);
      expect(stateAfterRestart.turnPlayerId).toBe(turnBeforeRestart);
      // This is the specific regression this test guards: before the fix,
      // this was always 0 after a restore, regardless of how many moves
      // had actually been played.
      expect(stateAfterRestart.moveNumber).toBe(moveNumberBeforeRestart);

      // And play must be able to continue correctly post-restart.
      const continueRes = await request(instanceB.app)
        .post(`/api/matches/${matchId}/moves`)
        .set("Authorization", `Bearer ${token}`)
        .send({ from: "g1", to: "f3" });
      expect(continueRes.status).toBe(200);
      expect(continueRes.body.state.moveNumber).toBe(4); // 2 before restart + this move + AI's reply
    }
  );

  it("a match with zero moves played restores correctly with moveNumber 0 (not skipped, not a false pass)", async () => {
    const instanceA = buildApp(pool, () => {});
    const { matchId } = await registerAndSetup(instanceA, "restart-zero@example.com");
    const freshState = instanceA.chessAdapter.getGameState(matchId);

    const instanceB = buildApp(pool, () => {});
    const companions = new CompanionRepository(pool);
    const restoredCount = await restoreActiveMatches(instanceB, companions, () => {});
    expect(restoredCount).toBeGreaterThanOrEqual(1);

    // Match creation persists the starting position immediately (see
    // routes/matches.ts), so a zero-move match restores with the starting
    // FEN and moveNumber 0 — it should NOT be skipped as "nothing to
    // restore," and moveNumber must be genuinely 0, not just defaulted.
    const restoredState = instanceB.chessAdapter.getGameState(matchId);
    expect(restoredState.board.fen).toBe(freshState.board.fen);
    expect(restoredState.moveNumber).toBe(0);
  });
});
