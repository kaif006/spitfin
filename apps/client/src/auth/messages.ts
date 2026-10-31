import type { AuthFailure, FieldError } from "./api";

export type FormField = "email" | "password" | "displayName";

const FIELD_TEXT: Record<FormField, Record<string, string>> = {
  email: {
    required: "Enter your email address.",
    invalid: "That does not look like a valid email address.",
    too_long: "That email address is too long.",
  },
  password: {
    required: "Enter a password.",
    too_short: "Use at least 10 characters.",
    too_long: "Use at most 128 characters.",
    invalid: "That password contains characters we cannot accept.",
  },
  displayName: {
    required: "Choose a display name.",
    too_short: "Use at least 3 characters.",
    too_long: "Use at most 16 characters.",
    invalid: "Use letters, numbers and single spaces, _ or - between words.",
  },
};

const GENERAL_FIELD_TEXT = "Please check what you entered and try again.";

function isFormField(f: string): f is FormField {
  return f === "email" || f === "password" || f === "displayName";
}

export function fieldErrors(fields: FieldError[]): {
  byField: Partial<Record<FormField, string>>;
  general: string | null;
} {
  const byField: Partial<Record<FormField, string>> = {};
  let general: string | null = null;
  for (const { field, code } of fields) {
    if (isFormField(field)) {
      const text: string | undefined = FIELD_TEXT[field][code];
      if (text) {
        byField[field] ??= text;
        continue;
      }
    }
    general = GENERAL_FIELD_TEXT;
  }
  return { byField, general };
}

export function formatWait(s: number): string {
  if (s < 60) return s === 1 ? "1 second" : `${s} seconds`;
  const m = Math.ceil(s / 60);
  return m === 1 ? "1 minute" : `${m} minutes`;
}

export function failureMessage(f: AuthFailure): string {
  switch (f.kind) {
    case "invalid":
      return "Please check the highlighted fields.";
    case "invalid_credentials":
      return "That email and password do not match.";
    case "email_taken":
      return "That email is already registered. Try signing in instead.";
    case "rate_limited":
      return `Too many attempts. Try again in ${formatWait(f.retryAfterS)}.`;
    case "unauthenticated":
      return "Your session has expired. Please sign in again.";
    case "forbidden":
      return "The request was blocked. Reload the page and try again.";
    case "network":
      return "Cannot reach the server. Check your connection and try again.";
    case "server":
      return "Something went wrong on our side. Try again in a moment.";
  }
}
