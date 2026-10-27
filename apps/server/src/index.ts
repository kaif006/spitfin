import { loadConfig } from "./config";
import { buildApp } from "./app";
import { attachWs } from "./ws";
import { createPool } from "./db/pool";
import { createRedis } from "./redis";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const redis = createRedis(config.redisUrl);

const app = buildApp({
  logger: config.nodeEnv !== "test",
  checks: [
    { name: "postgres", check: async () => { await pool.query("select 1"); } },
    { name: "redis", check: async () => { await redis.ping(); } },
  ],
});

const wss = attachWs(app.server);

// Same bind as before (all interfaces), needed so the web container can reach us.
await app.listen({ port: config.port, host: "0.0.0.0" });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received, shutting down`);
  // Upgraded sockets are not tracked by the HTTP server, so close them by hand.
  for (const client of wss.clients) client.terminate();
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
