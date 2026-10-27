import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
  });
  // Without this handler, a dropped idle connection would crash the process.
  pool.on("error", (err) => console.error("[pg] idle client error:", err.message));
  return pool;
}
