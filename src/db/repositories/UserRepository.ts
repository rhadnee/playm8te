import { Pool } from "pg";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: Date;
}

export class UserRepository {
  constructor(private pool: Pool) {}

  async create(email: string, passwordHash: string, displayName: string): Promise<UserRow> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *`,
      [email, passwordHash, displayName]
    );
    return result.rows[0];
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }
}
