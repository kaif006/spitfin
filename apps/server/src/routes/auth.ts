import { randomInt } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createGuest,
  createUser,
  EmailTakenError,
  findUserByEmail,
  findUserById,
  type Db,
  type User,
} from "../db/users.js";
import {
  clearSessionCookie,
  getSessionId,
  sessionCookie,
} from "../security/cookies.js";
import {
  CSRF_HEADER,
  csrfTokenFor,
  csrfTokenMatches,
  originAllowed,
} from "../security/csrf.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import {
  destroySession,
  getSession,
  rotateSession,
  SESSION_MAX_AGE_S,
  type SessionStore,
} from "../security/session.js";
import { issueTicket, TICKET_TTL_S, type TicketStore } from "../security/ticket.js";
import { parseLogin, parseRegister } from "../security/validation.js";

export type AuthDeps = {
  db: Db;
  redis: SessionStore & TicketStore;
  cookieSecure: boolean;
};

// What a client may see about a user. Never includes the password hash.
function publicUser(u: User) {
  return { id: u.id, email: u.email, displayName: u.displayName, isGuest: u.isGuest };
}

// Replaces any session the browser sent, then sets the new cookie.
// The cookie lasts the full 30 days; the server enforces the 7 day idle limit.
async function startSession(
  deps: AuthDeps,
  req: FastifyRequest,
  reply: FastifyReply,
  user: User,
) {
  const { id } = await rotateSession(deps.redis, getSessionId(req.headers.cookie), user.id);
  reply.header(
    "Set-Cookie",
    sessionCookie(id, { secure: deps.cookieSecure, maxAgeS: SESSION_MAX_AGE_S }),
  );
  return { user: publicUser(user), csrfToken: csrfTokenFor(id) };
}

async function authenticate(
  deps: AuthDeps,
  req: FastifyRequest,
): Promise<{ sid: string; user: User } | null> {
  const sid = getSessionId(req.headers.cookie);
  if (sid === undefined) return null;
  const session = await getSession(deps.redis, sid);
  if (session === null) return null;
  const user = await findUserById(deps.db, session.userId);
  if (user === null) {
    // The account is gone, so the session must go too.
    await destroySession(deps.redis, sid);
    return null;
  }
  return { sid, user };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  void app.register(
    async (api) => {
      // Applies to every route in this scope.
      api.addHook("onRequest", (req, reply, done) => {
        reply.header("Cache-Control", "no-store");
        const mutating = req.method !== "GET" && req.method !== "HEAD";
        if (mutating && !originAllowed(req.headers.origin, req.headers.host)) {
          void reply.code(403).send({ error: "forbidden_origin" });
          return;
        }
        done();
      });

      api.post("/register", async (req, reply) => {
        const parsed = parseRegister(req.body);
        if (!parsed.ok) {
          return reply.code(400).send({ error: "invalid", fields: parsed.errors });
        }
        const { email, password, displayName } = parsed.value;
        const pwHash = await hashPassword(password);
        let user: User;
        try {
          user = await createUser(deps.db, { email, pwHash, displayName });
        } catch (err) {
          if (err instanceof EmailTakenError) {
            return reply.code(409).send({ error: "email_taken" });
          }
          throw err;
        }
        return reply.code(201).send(await startSession(deps, req, reply, user));
      });

      api.post("/login", async (req, reply) => {
        const parsed = parseLogin(req.body);
        if (!parsed.ok) {
          return reply.code(400).send({ error: "invalid", fields: parsed.errors });
        }
        const user = await findUserByEmail(deps.db, parsed.value.email);
        // Unknown emails still pay the hashing cost, so timing does not leak them.
        const ok = await verifyPassword(user?.pwHash ?? null, parsed.value.password);
        if (user === null || !ok) {
          return reply.code(401).send({ error: "invalid_credentials" });
        }
        return reply.code(200).send(await startSession(deps, req, reply, user));
      });

      api.post("/guest", async (req, reply) => {
        const name = `Guest-${String(randomInt(0, 10_000)).padStart(4, "0")}`;
        const user = await createGuest(deps.db, name);
        return reply.code(201).send(await startSession(deps, req, reply, user));
      });

      api.get("/me", async (req, reply) => {
        const auth = await authenticate(deps, req);
        if (auth === null) return reply.code(401).send({ error: "unauthenticated" });
        return { user: publicUser(auth.user), csrfToken: csrfTokenFor(auth.sid) };
      });

      api.post("/logout", async (req, reply) => {
        const sid = getSessionId(req.headers.cookie);
        if (sid !== undefined) {
          if (!csrfTokenMatches(sid, req.headers[CSRF_HEADER])) {
            return reply.code(403).send({ error: "bad_csrf" });
          }
          await destroySession(deps.redis, sid);
        }
        reply.header("Set-Cookie", clearSessionCookie(deps.cookieSecure));
        return reply.code(204).send();
      });

      api.post("/ws-ticket", async (req, reply) => {
        const auth = await authenticate(deps, req);
        if (auth === null) return reply.code(401).send({ error: "unauthenticated" });
        if (!csrfTokenMatches(auth.sid, req.headers[CSRF_HEADER])) {
          return reply.code(403).send({ error: "bad_csrf" });
        }
        const ticket = await issueTicket(deps.redis, auth.user.id);
        return { ticket, expiresInS: TICKET_TTL_S };
      });
    },
    { prefix: "/api/auth" },
  );
}
