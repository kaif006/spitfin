import { createHash, timingSafeEqual } from "node:crypto";

export const CSRF_HEADER = "x-csrf-token";

/**
 * The CSRF token is derived from the session ID, so nothing extra is stored.
 * Without the ID (an HttpOnly cookie) it cannot be computed, and the hash
 * cannot be reversed into the ID.
 */
export function csrfTokenFor(sessionId: string): string {
  return createHash("sha256").update("csrf:" + sessionId).digest("base64url");
}

export function csrfTokenMatches(sessionId: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const expected = Buffer.from(csrfTokenFor(sessionId));
  const given = Buffer.from(provided);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Browsers always send Origin on cross-site POSTs. If it is present, its host
 * must be the host the request was addressed to. A missing Origin means a
 * non-browser client such as curl, which is not a CSRF vector.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // includes the literal "null" origin
  }
}
