import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { authApi, setSession } from "../auth/session";
import type { Session } from "../auth/api";
import { failureMessage } from "../auth/messages";
import { LoginPage } from "./LoginPage";
import { Pond } from "./Pond";
import { LobbyPanel } from "./LobbyPanel";
import { Dashboard } from "./Dashboard";
import { match } from "../net/match";
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
  const [showStats, setShowStats] = useState(false);
  const [playing, setPlaying] = useState(match.state.phase === "playing");

  // The game module starts itself when it loads, so it is only imported after sign-in.
  useEffect(() => {
    import("../game").catch(() => setMsg("The game failed to load. Reload the page to try again."));
  }, []);

  useEffect(() => {
    setPlaying(match.state.phase === "playing");
    return match.subscribe(() => setPlaying(match.state.phase === "playing"));
  }, []);

  // A match that starts while the stats are open takes over the screen.
  useEffect(() => {
    if (playing) setShowStats(false);
  }, [playing]);

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
    <>
      <LobbyPanel />
      {showStats && !playing && <Dashboard session={session} onClose={() => setShowStats(false)} />}
      <div class="session-bar">
        <span>{session.user.displayName}</span>
        {!playing && (
          <button type="button" onClick={() => setShowStats(true)}>
            Stats
          </button>
        )}
        <button type="button" onClick={() => void logout()} disabled={busy}>
          Log out
        </button>
        {msg && <span class="session-msg">{msg}</span>}
      </div>
    </>
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
