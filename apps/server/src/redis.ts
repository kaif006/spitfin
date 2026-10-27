import { Redis } from "ioredis";

export function createRedis(url: string): Redis {
  // Fail commands fast when Redis is down instead of queueing them forever.
  const redis = new Redis(url, { maxRetriesPerRequest: 2 });

  // ioredis emits an error on every retry; log only the first one per outage.
  let down = false;
  redis.on("error", (err) => {
    if (!down) {
      down = true;
      console.error("[redis] error:", err.message);
    }
  });
  redis.on("ready", () => {
    if (down) console.log("[redis] recovered");
    down = false;
  });
  return redis;
}
