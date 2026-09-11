import { Pool } from "pg";
import { PlayerRef } from "../../types/game";

export interface MatchRow {
  id: string;
  game_id: string;
  status: string;
  engine_state: unknown;
  result: string | null;
  created_by: string;
}

export interface MatchPlayerRow {
  match_id: string;
  player_kind: "human" | "ai_companion";
  user_id: string | null;
  companion_id: string | null;
  color: "white" | "black";
}

export class MatchRepository {
  constructor(private pool: Pool) {}

  async createMatch(matchId: string, gameId: string, createdBy: string, players: PlayerRef[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO matches (id, game_id, status, engine_state, started_at, created_by)
         VALUES ($1, $2, 'IN_PROGRESS', '{}'::jsonb, now(), $3)`,
        [matchId, gameId, createdBy]
      );
      for (const p of players) {
        await client.query(
          `INSERT INTO match_players (match_id, player_kind, user_id, companion_id, color)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            matchId,
            p.kind,
            p.kind === "human" ? p.id : null,
            p.kind === "ai_companion" ? p.id : null,
            p.color,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async saveEngineState(
    matchId: string,
    engineState: unknown,
    status: "IN_PROGRESS" | "COMPLETE",
    result: string | null
  ): Promise<void> {
    await this.pool.query(
      `UPDATE matches SET engine_state = $2, status = $3, result = $4,
         ended_at = CASE WHEN $3 = 'COMPLETE' THEN now() ELSE ended_at END
       WHERE id = $1`,
      [matchId, JSON.stringify(engineState), status, result]
    );
  }

  async appendEvents(
    matchId: string,
    events: Array<{ type: string; actorPlayerId: string | null; payload: unknown }>
  ): Promise<void> {
    if (events.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of events) {
        await client.query(
          `INSERT INTO game_events (match_id, type, actor_player_id, payload) VALUES ($1, $2, $3, $4)`,
          [matchId, e.type, e.actorPlayerId, JSON.stringify(e.payload)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findMatch(matchId: string): Promise<MatchRow | null> {
    const result = await this.pool.query<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [matchId]);
    return result.rows[0] ?? null;
  }

  async findPlayers(matchId: string): Promise<MatchPlayerRow[]> {
    const result = await this.pool.query<MatchPlayerRow>(
      `SELECT * FROM match_players WHERE match_id = $1`,
      [matchId]
    );
    return result.rows;
  }

  async isUserInMatch(matchId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2`,
      [matchId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findActiveMatches(): Promise<MatchRow[]> {
    const result = await this.pool.query<MatchRow>(
      `SELECT * FROM matches WHERE status = 'IN_PROGRESS'`
    );
    return result.rows;
  }

  /**
   * Atomically claims the right to record statistics for this match exactly
   * once. Returns true only for the caller that wins the race (first to set
   * stats_recorded_at); all other/duplicate calls get false and must skip.
   * Exists because match-completion can be reached from more than one code
   * path (human move, AI auto-move) and match completion logic should not
   * have to be perfectly single-entry to stay correct.
   */
  async claimStatsRecording(matchId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE matches SET stats_recorded_at = now() WHERE id = $1 AND stats_recorded_at IS NULL RETURNING id`,
      [matchId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Records a decisive result (one winner, one loser). Do not call this for
   * a draw — use recordDraw instead. Keeping these as separate methods
   * (rather than one function with an isDraw flag threaded through shared
   * winner/loser params) avoids the bug this replaced: passing a
   * draw-participant id through the same "winnerUserId" parameter used for
   * decisive wins caused that branch to fire unconditionally and credit a
   * win *and* a draw for the same match.
   */
  async recordDecisiveResult(matchId: string, winnerUserId: string | null, loserUserId: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (winnerUserId) {
        await client.query(
          `INSERT INTO player_statistics (user_id, matches_played, matches_won)
           VALUES ($1, 1, 1)
           ON CONFLICT (user_id) DO UPDATE SET
             matches_played = player_statistics.matches_played + 1,
             matches_won = player_statistics.matches_won + 1,
             updated_at = now()`,
          [winnerUserId]
        );
      }
      if (loserUserId) {
        await client.query(
          `INSERT INTO player_statistics (user_id, matches_played, matches_lost)
           VALUES ($1, 1, 1)
           ON CONFLICT (user_id) DO UPDATE SET
             matches_played = player_statistics.matches_played + 1,
             matches_lost = player_statistics.matches_lost + 1,
             updated_at = now()`,
          [loserUserId]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async recordDraw(userIds: Array<string | null>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const userId of userIds.filter((id): id is string => Boolean(id))) {
        await client.query(
          `INSERT INTO player_statistics (user_id, matches_played, matches_drawn)
           VALUES ($1, 1, 1)
           ON CONFLICT (user_id) DO UPDATE SET
             matches_played = player_statistics.matches_played + 1,
             matches_drawn = player_statistics.matches_drawn + 1,
             updated_at = now()`,
          [userId]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
