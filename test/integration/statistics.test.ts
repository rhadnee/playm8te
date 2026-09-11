import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createTestPool, resetTestData } from "../helpers/db";
import { UserRepository } from "../../src/db/repositories/UserRepository";
import { MatchRepository } from "../../src/db/repositories/MatchRepository";
import { PlayerRef } from "../../src/types/game";

describe("MatchRepository statistics (integration, real Postgres)", () => {
  let pool: Pool;
  let users: UserRepository;
  let matchRepo: MatchRepository;

  beforeAll(() => {
    pool = createTestPool();
    users = new UserRepository(pool);
    matchRepo = new MatchRepository(pool);
  });

  beforeEach(async () => {
    await resetTestData(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedMatch() {
    const user = await users.create("stats@example.com", "hash", "Stats");
    const matchId = "11111111-1111-1111-1111-111111111111";
    const players: PlayerRef[] = [
      { id: user.id, kind: "human", displayName: "Stats", color: "white" },
      { id: "22222222-2222-2222-2222-222222222222", kind: "ai_companion", displayName: "Nova", color: "black" },
    ];
    // companion_id FK requires a real companion row; skip FK by using a
    // human-only pair isn't representative, so create a minimal companion.
    await pool.query(
      `INSERT INTO companions (id, owner_id, name, avatar_key, personality_id) VALUES ($1, $2, 'Nova', 'a1', 'coach')`,
      ["22222222-2222-2222-2222-222222222222", user.id]
    );
    await matchRepo.createMatch(matchId, "chess", user.id, players);
    return { userId: user.id, matchId };
  }

  it(
    "REGRESSION: recordDraw does not also credit a win — a draw increments " +
      "matches_played and matches_drawn only, never matches_won",
    async () => {
      const { userId } = await seedMatch();
      await matchRepo.recordDraw([userId]);

      const result = await pool.query(
        "SELECT matches_played, matches_won, matches_lost, matches_drawn FROM player_statistics WHERE user_id = $1",
        [userId]
      );
      const row = result.rows[0];
      expect(row.matches_played).toBe(1);
      expect(row.matches_won).toBe(0); // this was the actual bug: used to be 1
      expect(row.matches_lost).toBe(0);
      expect(row.matches_drawn).toBe(1);
    }
  );

  it("recordDecisiveResult credits exactly one win and one loss, never a draw", async () => {
    const { userId, matchId } = await seedMatch();
    await matchRepo.recordDecisiveResult(matchId, userId, null);

    const result = await pool.query(
      "SELECT matches_played, matches_won, matches_lost, matches_drawn FROM player_statistics WHERE user_id = $1",
      [userId]
    );
    const row = result.rows[0];
    expect(row.matches_played).toBe(1);
    expect(row.matches_won).toBe(1);
    expect(row.matches_lost).toBe(0);
    expect(row.matches_drawn).toBe(0);
  });

  it(
    "REGRESSION: claimStatsRecording only allows exactly one caller to proceed for a given match, " +
      "even under concurrent calls",
    async () => {
      const { matchId } = await seedMatch();
      const results = await Promise.all([
        matchRepo.claimStatsRecording(matchId),
        matchRepo.claimStatsRecording(matchId),
        matchRepo.claimStatsRecording(matchId),
      ]);
      const trueCount = results.filter(Boolean).length;
      expect(trueCount).toBe(1); // exactly one claim should succeed
    }
  );
});
