import { Pool } from "pg";

export interface MemoryRow {
  id: string;
  companion_id: string;
  player_id: string;
  category: string;
  fact: string;
  status: "candidate" | "confirmed";
  weight: number;
  observation_count: number;
  updated_at: Date;
}

const CONFIRMATION_THRESHOLD = 3;

export class MemoryRepository {
  constructor(private pool: Pool) {}

  async recordObservation(
    companionId: string,
    playerId: string,
    category: string,
    fact: string,
    weightIncrement = 1
  ): Promise<MemoryRow> {
    const result = await this.pool.query<MemoryRow>(
      `INSERT INTO companion_memories (companion_id, player_id, category, fact, weight, observation_count, status)
       VALUES ($1, $2, $3, $4, $5, 1, 'candidate')
       ON CONFLICT (companion_id, player_id, category, fact) DO UPDATE SET
         weight = companion_memories.weight + $5,
         observation_count = companion_memories.observation_count + 1,
         status = CASE WHEN companion_memories.observation_count + 1 >= $6 THEN 'confirmed' ELSE companion_memories.status END,
         updated_at = now()
       RETURNING *`,
      [companionId, playerId, category, fact, weightIncrement, CONFIRMATION_THRESHOLD]
    );
    return result.rows[0];
  }

  async retrieve(companionId: string, playerId: string, limit = 5): Promise<MemoryRow[]> {
    const result = await this.pool.query<MemoryRow>(
      `SELECT * FROM companion_memories
       WHERE companion_id = $1 AND player_id = $2
       ORDER BY (status = 'confirmed') DESC, weight DESC, updated_at DESC
       LIMIT $3`,
      [companionId, playerId, limit]
    );
    return result.rows;
  }
}
