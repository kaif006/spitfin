import type { Pool } from "pg";

// Anything with a pg-style query() works, so tests can pass a fake.
export type Db = Pick<Pool, "query">;

// These are `type` aliases rather than interfaces because pg's generic
// query<R>() needs a type with an index signature.
export type User = {
  id: string;
  email: string | null;
  displayName: string;
  isGuest: boolean;
  createdAt: Date;
};

// Only login needs the hash. Never send this shape to a client.
export type UserWithHash = User & { pwHash: string | null };

const COLUMNS = `id, email, display_name AS "displayName", is_guest AS "isGuest", created_at AS "createdAt"`;
const COLUMNS_WITH_HASH = `${COLUMNS}, pw_hash AS "pwHash"`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EmailTakenError extends Error {
  constructor() {
    super("email already registered");
    this.name = "EmailTakenError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmailTaken(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint === "users_email_lower_idx";
}

export async function createUser(
  db: Db,
  input: { email: string; pwHash: string; displayName: string },
): Promise<User> {
  try {
    const res = await db.query<User>(
      `INSERT INTO users (email, pw_hash, display_name, is_guest)
       VALUES ($1, $2, $3, FALSE)
       RETURNING ${COLUMNS}`,
      [normalizeEmail(input.email), input.pwHash, input.displayName],
    );
    const row = res.rows[0];
    if (!row) throw new Error("insert returned no row");
    return row;
  } catch (err) {
    if (isEmailTaken(err)) throw new EmailTakenError();
    throw err;
  }
}

export async function createGuest(db: Db, displayName: string): Promise<User> {
  const res = await db.query<User>(
    `INSERT INTO users (display_name, is_guest)
     VALUES ($1, TRUE)
     RETURNING ${COLUMNS}`,
    [displayName],
  );
  const row = res.rows[0];
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function findUserByEmail(
  db: Db,
  email: string,
): Promise<UserWithHash | null> {
  const res = await db.query<UserWithHash>(
    `SELECT ${COLUMNS_WITH_HASH} FROM users WHERE lower(email) = $1`,
    [normalizeEmail(email)],
  );
  return res.rows[0] ?? null;
}

export async function findUserById(db: Db, id: string): Promise<User | null> {
  // A malformed id would make Postgres throw, so answer "not found" instead.
  if (!UUID_RE.test(id)) return null;
  const res = await db.query<User>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}
