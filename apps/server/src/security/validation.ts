import { normalizeEmail } from "../db/users.js";

export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 16;

export type ErrorCode = "required" | "invalid" | "too_short" | "too_long";
export type FieldName = "body" | "email" | "password" | "displayName";
export type FieldError = { field: FieldName; code: ErrorCode };
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
};
export type LoginInput = { email: string; password: string };

type Check = { value: string } | { code: ErrorCode };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
// Letters or digits, with single spaces, underscores or hyphens between groups.
const DISPLAY_NAME_RE = /^[\p{L}\p{N}]+(?:[ _-][\p{L}\p{N}]+)*$/u;

// Length in Unicode code points, which is how Postgres char_length counts.
function length(s: string): number {
  return Array.from(s).length;
}

function checkEmail(raw: unknown): Check {
  if (typeof raw !== "string") return { code: "required" };
  const email = normalizeEmail(raw);
  if (email === "") return { code: "required" };
  if (email.length > EMAIL_MAX) return { code: "too_long" };
  if (CONTROL_RE.test(email) || !EMAIL_RE.test(email)) return { code: "invalid" };
  return { value: email };
}

// Passwords are normalized (NFKC) so the same typed password always gives the
// same hash, but they are never trimmed. Login skips the minimum so it never
// reveals the password rules.
function checkPassword(raw: unknown, enforceMin: boolean): Check {
  if (typeof raw !== "string" || raw === "") return { code: "required" };
  const password = raw.normalize("NFKC");
  const n = length(password);
  if (n > PASSWORD_MAX) return { code: "too_long" };
  if (enforceMin && n < PASSWORD_MIN) return { code: "too_short" };
  return { value: password };
}

function checkDisplayName(raw: unknown): Check {
  if (typeof raw !== "string") return { code: "required" };
  const name = raw.normalize("NFKC").trim();
  if (name === "") return { code: "required" };
  const n = length(name);
  if (n < DISPLAY_NAME_MIN) return { code: "too_short" };
  if (n > DISPLAY_NAME_MAX) return { code: "too_long" };
  if (!DISPLAY_NAME_RE.test(name)) return { code: "invalid" };
  return { value: name };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function failures(checks: [FieldName, Check][]): FieldError[] {
  const errors: FieldError[] = [];
  for (const [field, check] of checks) {
    if ("code" in check) errors.push({ field, code: check.code });
  }
  return errors;
}

// Only called once failures() found nothing, so every check holds a value.
function valueOf(check: Check): string {
  return "value" in check ? check.value : "";
}

const BAD_BODY = { ok: false, errors: [{ field: "body", code: "invalid" }] } as const;

export function parseRegister(body: unknown): Result<RegisterInput> {
  if (!isRecord(body)) return { ok: false, errors: [...BAD_BODY.errors] };
  const email = checkEmail(body["email"]);
  const password = checkPassword(body["password"], true);
  const displayName = checkDisplayName(body["displayName"]);
  const errors = failures([
    ["email", email],
    ["password", password],
    ["displayName", displayName],
  ]);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      email: valueOf(email),
      password: valueOf(password),
      displayName: valueOf(displayName),
    },
  };
}

export function parseLogin(body: unknown): Result<LoginInput> {
  if (!isRecord(body)) return { ok: false, errors: [...BAD_BODY.errors] };
  const email = checkEmail(body["email"]);
  const password = checkPassword(body["password"], false);
  const errors = failures([
    ["email", email],
    ["password", password],
  ]);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { email: valueOf(email), password: valueOf(password) },
  };
}
