export type Config = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Whether the session cookie gets the Secure flag. Needs HTTPS to work in Safari. */
  cookieSecure: boolean;
};

const DEV_DATABASE_URL = "postgres://spitfin:dev-only-change-me@localhost:5432/spitfin";
const DEV_REDIS_URL = "redis://localhost:6379";

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new Error(`Invalid ${name}: ${raw}`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv =
    env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const dev = nodeEnv !== "production";
  const databaseUrl = env.DATABASE_URL ?? (dev ? DEV_DATABASE_URL : undefined);
  const redisUrl = env.REDIS_URL ?? (dev ? DEV_REDIS_URL : undefined);
  if (!databaseUrl) throw new Error("DATABASE_URL is required in production");
  if (!redisUrl) throw new Error("REDIS_URL is required in production");

  const cookieSecure = parseBool("COOKIE_SECURE", env.COOKIE_SECURE, nodeEnv === "production");

  return { nodeEnv, port, databaseUrl, redisUrl, cookieSecure };
}
