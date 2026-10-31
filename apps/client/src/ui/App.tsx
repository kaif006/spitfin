import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { authApi, setSession } from "../auth/session";
import type { Session } from "../auth/api";
import { failureMessage } from "../auth/messages";
import { LoginPage } from "./LoginPage";
import { Pond } from "./Pond";
import "./login.css";

type Phase =
  | { t: "checking" }
  | { t: "login" }
  | { t: "error"; message: string }
  | { t: "game"; session: Session };

function Splash({ children }: { children: ComponentChildren }) {
  return (
    <main class="splash">
      <Pond />
      <div class="card splash-card">{children}</div>
    </main>
  );
}

function GameShell({ session }: { session: Session }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The game module starts itself when it loads, so it is only imported after sign-in.
  useEffect(() => {
    import("../game").catch(() => setMsg("The game failed to load. Reload the page to try again."));
  }, []);

  async function logout() {
    setBusy(true);
    const r = await authApi.logout(session.csrfToken);
    if (r.ok) {
      setSession(null);
      location.reload();
      return;
    }
    setBusy(false);
    setMsg(failureMessage(r.failure));
  }

  return (
    <div class="session-bar">
      <span>{session.user.displayName}</span>
      <button type="button" onClick={() => void logout()} disabled={busy}>
        Log out
      </button>
      {msg && <span class="session-msg">{msg}</span>}
    </div>
  );
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ t: "checking" });

  function enter(s: Session) {
    setSession(s);
    setPhase({ t: "game", session: s });
  }

  async function check() {
    setPhase({ t: "checking" });
    const r = await authApi.me();
    if (r.ok) enter(r.value);
    else if (r.failure.kind === "unauthenticated") setPhase({ t: "login" });
    else setPhase({ t: "error", message: failureMessage(r.failure) });
  }

  useEffect(() => {
    void check();
  }, []);

  switch (phase.t) {
    case "checking":
      return (
        <Splash>
          <p>Loading…</p>
        </Splash>
      );
    case "error":
      return (
        <Splash>
          <p>{phase.message}</p>
          <button class="bubble-btn" type="button" onClick={() => void check()}>
            Try again
          </button>
        </Splash>
      );
    case "login":
      return <LoginPage onAuthed={enter} />;
    case "game":
      return <GameShell session={phase.session} />;
  }
}
