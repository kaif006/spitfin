import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { readMigrations, runMigrations } from "./migrate.js";

function fakePool(applied: string[], failOn?: string) {
  const queries: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text.trim());
      if (failOn && text.includes(failOn)) throw new Error("boom");
      if (text.startsWith("SELECT name FROM schema_migrations")) {
        return { rows: applied.map((name) => ({ name })) };
      }
      return { rows: [] };
    }),
    release,
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, queries, release };
}

const A = { name: "001_a.sql", sql: "SELECT 1 -- a" };
const B = { name: "002_b.sql", sql: "SELECT 2 -- b" };

describe("readMigrations", () => {
  it("finds the users migration first", async () => {
    const migrations = await readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]!.name).toBe("001_users.sql");
  });

  it("numbers files consecutively from 001 with no gaps or repeats", async () => {
    const migrations = await readMigrations();
    const numbers = migrations.map((m) => Number(m.name.slice(0, 3)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("has non-empty SQL in every file", async () => {
    const migrations = await readMigrations();
    for (const m of migrations) expect(m.sql.trim().length).toBeGreaterThan(0);
  });
});

describe("runMigrations", () => {
  it("applies pending migrations in order, each in its own transaction", async () => {
    const { pool, queries } = fakePool([]);
    const ran = await runMigrations(pool, [A, B]);
    expect(ran).toEqual(["001_a.sql", "002_b.sql"]);
    expect(queries.indexOf(A.sql)).toBeGreaterThan(-1);
    expect(queries.indexOf(A.sql)).toBeLessThan(queries.indexOf(B.sql));
    expect(queries.filter((q) => q === "BEGIN")).toHaveLength(2);
    expect(queries.filter((q) => q === "COMMIT")).toHaveLength(2);
    expect(
      queries.filter((q) => q.startsWith("INSERT INTO schema_migrations")),
    ).toHaveLength(2);
  });

  it("skips migrations that are already recorded", async () => {
    const { pool, queries } = fakePool(["001_a.sql"]);
    const ran = await runMigrations(pool, [A, B]);
    expect(ran).toEqual(["002_b.sql"]);
    expect(queries).not.toContain(A.sql);
  });

  it("rolls back, unlocks and releases the connection when a migration fails", async () => {
    const { pool, queries, release } = fakePool([], "BAD");
    const bad = { name: "001_bad.sql", sql: "BAD SQL" };
    await expect(runMigrations(pool, [bad])).rejects.toThrow("boom");
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(queries[queries.length - 1]).toMatch(/^SELECT pg_advisory_unlock/);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does nothing, but still unlocks and releases, when nothing is pending", async () => {
    const { pool, queries, release } = fakePool(["001_a.sql"]);
    const ran = await runMigrations(pool, [A]);
    expect(ran).toEqual([]);
    expect(queries).not.toContain("BEGIN");
    expect(queries[queries.length - 1]).toMatch(/^SELECT pg_advisory_unlock/);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
