export type PublicUser = {
  id: string;
  email: string | null;
  displayName: string;
  isGuest: boolean;
};
export type Session = { user: PublicUser; csrfToken: string };
export type FieldError = { field: string; code: string };

export type AuthFailure =
  | { kind: "invalid"; fields: FieldError[] }
  | { kind: "invalid_credentials" }
  | { kind: "email_taken" }
  | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "network" }
  | { kind: "server"; status: number };

export type Result<T> = { ok: true; value: T } | { ok: false; failure: AuthFailure };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const JSON_HEADERS = { "Content-Type": "application/json" };
const DEFAULT_RETRY_S = 30;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function parseSession(body: unknown): Session | null {
  if (!isRecord(body) || typeof body.csrfToken !== "string") return null;
  const u = body.user;
  if (
    !isRecord(u) ||
    typeof u.id !== "string" ||
    typeof u.displayName !== "string" ||
    typeof u.isGuest !== "boolean" ||
    !(typeof u.email === "string" || u.email === null)
  ) {
    return null;
  }
  return {
    user: { id: u.id, email: u.email, displayName: u.displayName, isGuest: u.isGuest },
    csrfToken: body.csrfToken,
  };
}

function toFailure(res: Response, body: unknown): AuthFailure {
  const err = isRecord(body) && typeof body.error === "string" ? body.error : "";
  switch (res.status) {
    case 400: {
      if (err === "invalid" && isRecord(body) && Array.isArray(body.fields)) {
        const fields: FieldError[] = [];
        for (const f of body.fields) {
          if (isRecord(f) && typeof f.field === "string" && typeof f.code === "string") {
            fields.push({ field: f.field, code: f.code });
          }
        }
        return { kind: "invalid", fields };
      }
      return { kind: "server", status: 400 };
    }
    case 401:
      return err === "invalid_credentials" ? { kind: "invalid_credentials" } : { kind: "unauthenticated" };
    case 403:
      return { kind: "forbidden" };
    case 409:
      return { kind: "email_taken" };
    case 429: {
      const fromBody = isRecord(body) && typeof body.retryAfterS === "number" ? body.retryAfterS : NaN;
      const fromHeader = Number(res.headers.get("Retry-After"));
      const secs = [fromBody, fromHeader].find((n) => Number.isFinite(n) && n > 0) ?? DEFAULT_RETRY_S;
      return { kind: "rate_limited", retryAfterS: Math.ceil(secs) };
    }
    default:
      return { kind: "server", status: res.status };
  }
}

const fail = (failure: AuthFailure): { ok: false; failure: AuthFailure } => ({ ok: false, failure });

export function createAuthApi(fetchFn?: FetchLike) {
  const doFetch: FetchLike = fetchFn ?? ((input, init) => fetch(input, init));

  async function send(path: string, init: RequestInit): Promise<{ res: Response; body: unknown } | null> {
    try {
      const res = await doFetch(path, init);
      return { res, body: await readJson(res) };
    } catch {
      return null;
    }
  }

  async function sessionCall(path: string, init: RequestInit): Promise<Result<Session>> {
    const r = await send(path, init);
    if (!r) return fail({ kind: "network" });
    if (!r.res.ok) return fail(toFailure(r.res, r.body));
    const session = parseSession(r.body);
    return session ? { ok: true, value: session } : fail({ kind: "server", status: r.res.status });
  }

  const postJson = (path: string, payload: unknown) =>
    sessionCall(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });

  return {
    me: () => sessionCall("/api/auth/me", { method: "GET" }),
    login: (email: string, password: string) => postJson("/api/auth/login", { email, password }),
    register: (email: string, password: string, displayName: string) =>
      postJson("/api/auth/register", { email, password, displayName }),
    guest: () => sessionCall("/api/auth/guest", { method: "POST" }),

    async logout(csrfToken: string): Promise<Result<null>> {
      const r = await send("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
      if (!r) return fail({ kind: "network" });
      return r.res.ok ? { ok: true, value: null } : fail(toFailure(r.res, r.body));
    },

    async wsTicket(csrfToken: string): Promise<Result<string>> {
      const r = await send("/api/auth/ws-ticket", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
      if (!r) return fail({ kind: "network" });
      if (!r.res.ok) return fail(toFailure(r.res, r.body));
      const ticket = isRecord(r.body) ? r.body.ticket : undefined;
      return typeof ticket === "string" ? { ok: true, value: ticket } : fail({ kind: "server", status: r.res.status });
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
