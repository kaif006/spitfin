import { useEffect, useState } from "preact/hooks";
import { match, net } from "../net/match";
import type { MatchState } from "../net/matchStore";

function useMatch(): MatchState {
  const [s, setS] = useState(match.state);
  useEffect(() => {
    setS(match.state);
    return match.subscribe(() => setS(match.state));
  }, []);
  return s;
}

const box =
  "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 32px;background:rgba(20,20,20,.85);" +
  "color:#fff;font:600 16px/1.6 system-ui,sans-serif;border-radius:12px;text-align:center;min-width:240px;z-index:10;";

export function LobbyPanel() {
  const s = useMatch();

  useEffect(() => {
    net.connect();
    return () => net.disconnect();
  }, []);

  if (s.phase === "playing") {
    return s.link === "reconnecting" ? (
      <div style="position:fixed;top:8px;left:8px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.8);font:12px system-ui">
        reconnecting…
      </div>
    ) : null;
  }

  if (s.phase === "ended") {
    const names = new Map(s.roster.map((p) => [p.id, p.name]));
    const mine = (s.ranking ?? []).find((r) => r.id === s.you);
    const title = !mine ? "Time!" : mine.rank === 1 ? "You win!" : "Time!";
    return (
      <div style={box}>
        <div style="font-size:24px;margin-bottom:8px">{title}</div>
        {(s.ranking ?? []).map((r) => (
          <div
            key={r.id}
            style={r.id === s.you ? "color:#ffd76a" : ""}
          >
            #{r.rank} {names.get(r.id) ?? `Fish ${r.id}`}
            {r.id === s.you ? " (you)" : ""}: stash {r.stash}, eaten {r.eaten}, nips {r.nips}
          </div>
        ))}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button type="button" class="bubble-btn" onClick={() => { match.backToLobby(); net.join(); }}>
            Play again
          </button>
          <button type="button" class="bubble-btn secondary" onClick={() => match.backToLobby()}>
            Back to lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={box}>
      {s.phase === "connecting" && <div>Connecting…</div>}
      {s.phase === "offline" && (
        <>
          <div>Disconnected</div>
          <button type="button" class="bubble-btn" onClick={() => net.connect()}>
            Reconnect
          </button>
        </>
      )}
      {s.phase === "idle" && (
        <>
          <div>Ready to play?</div>
          <div style="font-weight:400;opacity:.8;margin-bottom:8px">
            WASD move · click spit · Space nip
          </div>
          <button type="button" class="bubble-btn" onClick={() => net.join()}>
            Find match
          </button>
        </>
      )}
      {s.phase === "queued" && (
        <>
          <div>Waiting for players…</div>
          <div style="font-weight:400;opacity:.8;margin-bottom:8px">
            {s.waiting} in queue (2–4 players needed)
          </div>          <button type="button" class="bubble-btn" onClick={() => { net.leave(); match.backToLobby(); }}>
            Cancel
          </button>
        </>
      )}
      {s.error === "already_playing" && <div>You are already in a match on another tab.</div>}
      {s.error && s.error !== "already_playing" && (
        <div style="font-weight:400;color:#ff9a8f;margin-top:8px">Error: {s.error}</div>
      )}
    </div>
  );
}
