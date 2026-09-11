import { Pool } from "pg";
import crypto from "crypto";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class RefreshTokenRepository {
  constructor(private pool: Pool) {}

  async store(userId: string, token: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, hashToken(token), expiresAt]
    );
  }

  async validate(token: string): Promise<{ userId: string; id: string } | null> {
    const result = await this.pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    const row = result.rows[0];
    return row ? { userId: row.user_id, id: row.id } : null;
  }

  async revoke(token: string): Promise<void> {
    await this.pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [
      hashToken(token),
    ]);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }
}
