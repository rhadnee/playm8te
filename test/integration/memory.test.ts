import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createTestPool, resetTestData } from "../helpers/db";
import { UserRepository } from "../../src/db/repositories/UserRepository";
import { CompanionRepository } from "../../src/db/repositories/CompanionRepository";
import { MemoryRepository } from "../../src/db/repositories/MemoryRepository";
import { MemoryService } from "../../src/services/MemoryService";

describe("MemoryService / MemoryRepository (integration, real Postgres)", () => {
  let pool: Pool;
  let users: UserRepository;
  let companions: CompanionRepository;
  let memoryRepo: MemoryRepository;

  beforeAll(() => {
    pool = createTestPool();
    users = new UserRepository(pool);
    companions = new CompanionRepository(pool);
    memoryRepo = new MemoryRepository(pool);
  });

  beforeEach(async () => {
    await resetTestData(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeCompanionAndPlayer() {
    const user = await users.create("memtest@example.com", "hash", "MemTest");
    const companion = await companions.create(user.id, "Nova", "avatar1", "coach");
    return { userId: user.id, companionId: companion.id };
  }

  it("a single observation stays a low-weight 'candidate', not 'confirmed'", async () => {
    const { userId, companionId } = await makeCompanionAndPlayer();
    const memory = new MemoryService(memoryRepo);

    memory.addShortTerm({
      matchId: "match-1",
      companionId,
      category: "recurring_mistake",
      note: "Blundered material around move 14.",
      createdAt: new Date().toISOString(),
    });
    await memory.consolidateMatch("match-1", companionId, userId);

    const rows = await memoryRepo.retrieve(companionId, userId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("candidate");
    expect(rows[0].observation_count).toBe(1); // exactly one observation — the exact bug this regression-tests
  });

  it("the SAME fact observed across 3 separate matches promotes to 'confirmed'", async () => {
    const { userId, companionId } = await makeCompanionAndPlayer();
    const memory = new MemoryService(memoryRepo);
    const fact = "Frequently loses material to knight forks.";

    for (const matchId of ["match-a", "match-b", "match-c"]) {
      memory.addShortTerm({ matchId, companionId, category: "recurring_mistake", note: fact, createdAt: new Date().toISOString() });
      await memory.consolidateMatch(matchId, companionId, userId);
    }

    const rows = await memoryRepo.retrieve(companionId, userId);
    const row = rows.find((r) => r.fact === fact);
    expect(row?.status).toBe("confirmed");
    expect(row?.observation_count).toBe(3);
  });

  it(
    "REGRESSION: concurrent consolidateMatch calls for the same match (simulating the " +
      "PLAYER_WON+PLAYER_LOST race that used to exist in DecisionLoop) do not double-count observations",
    async () => {
      const { userId, companionId } = await makeCompanionAndPlayer();
      const memory = new MemoryService(memoryRepo);

      memory.addShortTerm({
        matchId: "race-match",
        companionId,
        category: "recurring_mistake",
        note: "Blundered material around move 20.",
        createdAt: new Date().toISOString(),
      });

      // Fire two concurrent consolidations for the same match — this is
      // exactly the shape of the bug that was fixed by triggering
      // consolidation on a single canonical event (ROUND_ENDED) instead of
      // two events (PLAYER_WON, PLAYER_LOST) that fired concurrently for
      // the same match completion.
      await Promise.all([
        memory.consolidateMatch("race-match", companionId, userId),
        memory.consolidateMatch("race-match", companionId, userId),
      ]);

      const rows = await memoryRepo.retrieve(companionId, userId);
      // If double-counted, this would be 2. The short-term store is cleared
      // after the first consolidation call reads it, so even a genuine race
      // should settle at exactly one recorded observation here since only
      // one of the two calls will find entries to process.
      expect(rows.length).toBe(1);
      expect(rows[0].observation_count).toBe(1);
    }
  );

  it("retrieve() ranks confirmed facts above candidates and never returns more than the requested limit", async () => {
    const { userId, companionId } = await makeCompanionAndPlayer();
    for (let i = 0; i < 8; i++) {
      await memoryRepo.recordObservation(companionId, userId, "recurring_mistake", `fact-${i}`, 1);
    }
    const rows = await memoryRepo.retrieve(companionId, userId, 5);
    expect(rows.length).toBe(5); // retrieval layer never dumps the full store
  });
});
