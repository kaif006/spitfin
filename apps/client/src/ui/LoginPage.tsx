import { useEffect, useState } from "preact/hooks";
import { authApi } from "../auth/session";
import type { AuthFailure, Result, Session } from "../auth/api";
import { failureMessage, fieldErrors, type FormField } from "../auth/messages";
import { Pond } from "./Pond";

type Mode = "signin" | "signup";
type Action = Mode | "guest";

type FieldProps = {
  id: string;
  label: string;
  type: "text" | "email" | "password";
  value: string;
  autocomplete: string;
  error?: string;
  hint?: string;
  onInput: (v: string) => void;
};

function Field(p: FieldProps) {
  const errId = `${p.id}-err`;

  const commonProps = {
    id: p.id,
    name: p.id,
    value: p.value,
    autocomplete: p.autocomplete,
    "aria-invalid": p.error ? ("true" as const) : undefined,
    "aria-describedby": p.error ? errId : undefined,
    onInput: (e: Event) =>
      p.onInput((e.currentTarget as HTMLInputElement).value),
  };

  return (
    <div class="field">
      <label htmlFor={p.id}>{p.label}</label>

      {p.type === "email" ? (
        <input {...commonProps} type="email" />
      ) : p.type === "password" ? (
        <input {...commonProps} type="password" />
      ) : (
        <input {...commonProps} type="text" />
      )}

      {p.hint && !p.error && <p class="hint">{p.hint}</p>}

      {p.error && (
        <p class="field-error" id={errId}>
          {p.error}
        </p>
      )}
    </div>
  );
}
export function LoginPage({ onAuthed }: { onAuthed: (s: Session) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [lock, setLock] = useState<{ action: Action; s: number } | null>(null);

  // Count a rate-limit wait down once per second.
  useEffect(() => {
    if (!lock || lock.s <= 0) return;
    const id = setTimeout(() => setLock((l) => (l ? { ...l, s: l.s - 1 } : l)), 1000);
    return () => clearTimeout(id);
  }, [lock]);

  const isLocked = (a: Action) => !!lock && lock.s > 0 && lock.action === a;

  function handleFailure(action: Action, f: AuthFailure) {
    if (f.kind === "invalid") {
      const { byField, general } = fieldErrors(f.fields);
      setErrors(byField);
      setFormError(general ?? (Object.keys(byField).length > 0 ? null : failureMessage(f)));
      return;
    }
    if (f.kind === "rate_limited") {
      setLock({ action, s: f.retryAfterS });
      return;
    }
    if (f.kind === "email_taken") {
      setErrors({ email: failureMessage(f) });
      return;
    }
    setFormError(failureMessage(f));
  }

  async function run(action: Action, call: () => Promise<Result<Session>>) {
    if (busy || isLocked(action)) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    const r = await call();
    setBusy(false);
    if (r.ok) onAuthed(r.value);
    else handleFailure(action, r.failure);
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    if (mode === "signin") void run("signin", () => authApi.login(email, password));
    else void run("signup", () => authApi.register(email, password, displayName));
  }

  function switchMode(m: Mode) {
    setMode(m);
    setErrors({});
    setFormError(null);
  }

  const signup = mode === "signup";
  const submitLabel = busy ? "One moment…" : signup ? "Create account" : "Sign in";

  return (
    <main class="login">
      <Pond />
      <section class="card">
        <h1>Spitfin</h1>
        <p class="tagline">Shoot bugs. Eat bugs. Steal bugs.</p>

        <div class="tabs">
          <button type="button" aria-pressed={!signup} onClick={() => switchMode("signin")}>
            Sign in
          </button>
          <button type="button" aria-pressed={signup} onClick={() => switchMode("signup")}>
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <Field
            id="login-email"
            label="Email"
            type="email"
            value={email}
            autocomplete="email"
            error={errors.email}
            onInput={setEmail}
          />
          {signup && (
            <Field
              id="login-name"
              label="Display name"
              type="text"
              value={displayName}
              autocomplete="nickname"
              error={errors.displayName}
              hint="3 to 16 characters."
              onInput={setDisplayName}
            />
          )}
          <Field
            id="login-password"
            label="Password"
            type="password"
            value={password}
            autocomplete={signup ? "new-password" : "current-password"}
            error={errors.password}
            hint={signup ? "At least 10 characters." : undefined}
            onInput={setPassword}
          />

          {formError && (
            <p class="msg error" role="alert">
              {formError}
            </p>
          )}
          {lock && lock.s > 0 && lock.action !== "guest" && lock.action === mode && (
            <p class="msg error">{failureMessage({ kind: "rate_limited", retryAfterS: lock.s })}</p>
          )}

          <button class="bubble-btn" type="submit" disabled={busy || isLocked(mode)}>
            {submitLabel}
          </button>
        </form>

        <p class="divider">or</p>

        <button
          class="bubble-btn secondary"
          type="button"
          disabled={busy || isLocked("guest")}
          onClick={() => void run("guest", () => authApi.guest())}
        >
          Play as guest
        </button>
        {lock && lock.s > 0 && lock.action === "guest" && (
          <p class="msg error guest-msg">{failureMessage({ kind: "rate_limited", retryAfterS: lock.s })}</p>
        )}
        <p class="hint center">No account needed.</p>
      </section>
    </main>
  );
}
