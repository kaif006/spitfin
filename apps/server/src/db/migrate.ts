import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

// Any constant works. Every server process must use the same one.
const LOCK_KEY = 7260001;

// Migration files look like 001_users.sql, 002_something.sql, and so on.
const NAME_RE = /^\d{3}_[a-z0-9_]+\.sql$/;

export type Migration = { name: string; sql: string };

export async function readMigrations(
  dir: string = MIGRATIONS_DIR,
): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((n) => NAME_RE.test(n)).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(path.join(dir, name), "utf8"),
    })),
  );
}

/**
 * Applies every migration that is not yet recorded in schema_migrations.
 * - A Postgres advisory lock makes two processes take turns instead of racing.
 * - Each migration runs in its own transaction, so a failure leaves no half-applied state.
 * Returns the names of the migrations applied by this call.
 */
export async function runMigrations(
  pool: Pool,
  migrations: Migration[],
  log: (msg: string) => void = () => { },
): Promise<string[]> {
  const client = await pool.connect();
  const ran: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name       TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );
      const res = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations",
      );
      const applied = new Set(res.rows.map((r) => r.name));

      for (const m of migrations) {
        if (applied.has(m.name)) continue;
        await client.query("BEGIN");
        try {
          await client.query(m.sql);
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1)",
            [m.name],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
        ran.push(m.name);
        log(`[db] applied migration ${m.name}`);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return ran;
}
