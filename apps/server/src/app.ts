import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthRoutes, type AuthDeps } from "./routes/auth.js";
import { registerStatsRoutes, type CacheStore } from "./routes/stats.js";

export type HealthCheck = { name: string; check: () => Promise<void> };

export type AppOptions = {
  checks?: HealthCheck[];
  logger?: boolean;
  readyTimeoutMs?: number;
  auth?: AuthDeps;
  cache?: CacheStore;
  trustProxy?: boolean;
};

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      () => { clearTimeout(timer); resolve(); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const { checks = [], logger = false, readyTimeoutMs = 2000, auth, cache, trustProxy = false } = opts;
  // 16 KB body cap: auth requests are tiny JSON, anything bigger is abuse.
  const app = Fastify({ logger, bodyLimit: 16 * 1024, trustProxy });

  app.get("/healthz", async (_req, reply) => reply.type("text/plain").send("ok"));

  app.get("/readyz", async (_req, reply) => {
    const results = await Promise.all(
      checks.map(async (c): Promise<[string, "ok" | "down"]> => {
        try {
          await withTimeout(c.check(), readyTimeoutMs);
          return [c.name, "ok"];
        } catch {
          return [c.name, "down"];
        }
      }),
    );
    const ok = results.every(([, status]) => status === "ok");
    return reply.code(ok ? 200 : 503).send({ ok, checks: Object.fromEntries(results) });
  });

  if (auth) registerAuthRoutes(app, auth);
  if (auth && cache) registerStatsRoutes(app, { auth, cache });

  return app;
}
