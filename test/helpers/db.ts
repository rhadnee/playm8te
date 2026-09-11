import { Pool } from "pg";
import presets from "../../src/personalities/presets.json";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/playm8te_test";

export function createTestPool(): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL });
}

/**
 * Clears all mutable data between tests. NOTE: TRUNCATE ... CASCADE on
 * `users` also wipes `companion_personalities` (owner_id references users,
 * even for the NULL-owner built-in preset rows) — so this re-seeds the
 * presets afterward. Discovered the hard way during manual testing; see
 * docs/TECHNICAL_DEBT.md.
 */
export async function resetTestData(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE
      ai_conversations,
      game_events,
      match_players,
      matches,
      companion_memories,
      companions,
      refresh_tokens,
      users
    RESTART IDENTITY CASCADE
  `);
  for (const preset of presets as Array<{ id: string }>) {
    await pool.query(
      `INSERT INTO companion_personalities (id, owner_id, config) VALUES ($1, NULL, $2)
       ON CONFLICT (id) DO NOTHING`,
      [preset.id, JSON.stringify(preset)]
    );
  }
}
