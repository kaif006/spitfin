export const SESSION_COOKIE = "sid";

/** Reads a Cookie request header. If a name appears twice, the first one wins. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === "" || out.has(name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      // Not valid percent-encoding: keep the raw text.
    }
    out.set(name, value);
  }
  return out;
}

export function getSessionId(
  header: string | undefined,
  name: string = SESSION_COOKIE,
): string | undefined {
  return parseCookies(header).get(name);
}

const SAFE_VALUE_RE = /^[A-Za-z0-9_-]+$/;

/** Builds the Set-Cookie header value that stores the session ID. */
export function sessionCookie(
  id: string,
  opts: { secure: boolean; maxAgeS: number },
): string {
  // Guard against header injection: session IDs are base64url, nothing else.
  if (!SAFE_VALUE_RE.test(id)) throw new Error("unsafe cookie value");
  const parts = [
    `${SESSION_COOKIE}=${id}`,
    "Path=/",
    `Max-Age=${Math.floor(opts.maxAgeS)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Builds the Set-Cookie header value that deletes the session cookie (logout). */
export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
