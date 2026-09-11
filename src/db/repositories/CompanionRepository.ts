import { Pool } from "pg";
import { ChessDifficulty, DEFAULT_DIFFICULTY } from "../../services/chess/difficultyPresets";

export interface CompanionRow {
  id: string;
  owner_id: string;
  name: string;
  avatar_key: string;
  voice_key: string | null;
  personality_id: string;
  chess_difficulty: ChessDifficulty;
  created_at: Date;
}

export class CompanionRepository {
  constructor(private pool: Pool) {}

  async create(
    ownerId: string,
    name: string,
    avatarKey: string,
    personalityId: string,
    voiceKey?: string,
    chessDifficulty: ChessDifficulty = DEFAULT_DIFFICULTY
  ): Promise<CompanionRow> {
    const result = await this.pool.query<CompanionRow>(
      `INSERT INTO companions (owner_id, name, avatar_key, voice_key, personality_id, chess_difficulty)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [ownerId, name, avatarKey, voiceKey ?? null, personalityId, chessDifficulty]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<CompanionRow | null> {
    const result = await this.pool.query<CompanionRow>(`SELECT * FROM companions WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async listForOwner(ownerId: string): Promise<CompanionRow[]> {
    const result = await this.pool.query<CompanionRow>(
      `SELECT * FROM companions WHERE owner_id = $1 ORDER BY created_at DESC`,
      [ownerId]
    );
    return result.rows;
  }

  async isOwnedBy(companionId: string, ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM companions WHERE id = $1 AND owner_id = $2`,
      [companionId, ownerId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
