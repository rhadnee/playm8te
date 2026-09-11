import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({
  connectionString: config.database.url || undefined,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] unexpected idle client error:", err);
});

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
