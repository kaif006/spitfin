import { useEffect, useState } from "preact/hooks";
import type { Session } from "../auth/api";
import { statsApi } from "../stats/api";
import type {
  LeaderboardEntry,
  MatchesPage,
  MatchRow,
  StatsFailure,
  StatsResponse,
  StatsResult,
} from "../stats/api";
import { barPercents, chartPoints, oneDecimal, ordinal, pct, signed, toPolyline } from "../stats/format";
import "./dashboard.css";

type Load<T> = { t: "loading" } | { t: "error"; failure: StatsFailure } | { t: "ready"; value: T };

function fromResult<T>(r: StatsResult<T>): Load<T> {
  return r.ok ? { t: "ready", value: r.value } : { t: "error", failure: r.failure };
}

function failText(f: StatsFailure): string {
  if (f.kind === "unauthenticated") return "Please sign in again.";
  if (f.kind === "network") return "Could not reach the server.";
  return `Something went wrong (${f.status}).`;
}

function Status<T>({ load, children }: { load: Load<T>; children: (v: T) => preact.ComponentChildren }) {
  if (load.t === "loading") return <p class="dash-note">Loading…</p>;
  if (load.t === "error") return <p class="dash-note dash-bad">{failText(load.failure)}</p>;
  return <>{children(load.value)}</>;
}

function Cards({ data }: { data: StatsResponse }) {
  const { stats: s, derived: d } = data;
  const items: [string, string][] = [
    ["Rating", String(s.rating)],
    ["Matches", String(s.matches)],
    ["Win rate", pct(d.winRate)],
    ["Best win streak", String(s.bestStreak)],
    ["Bugs per match", oneDecimal(d.avgBugsEaten)],
    ["Spit accuracy", pct(d.spitAccuracy)],
    ["Nips that landed", pct(d.nipAccuracy)],
    ["Bugs eaten", String(s.bugsEatenTotal)],
  ];
  return (
    <div class="dash-cards">
      {items.map(([label, value]) => (
        <div class="dash-stat" key={label}>
          <div class="dash-stat-value">{value}</div>
          <div class="dash-stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

function BarRows({ rows }: { rows: { label: string; value: number }[] }) {
  const widths = barPercents(rows.map((r) => r.value));
  return (
    <div class="dash-bars">
      {rows.map((r, i) => (
        <div class="dash-bar-row" key={r.label}>
          <span class="dash-bar-label">{r.label}</span>
          <span class="dash-bar-track">
            <span class="dash-bar-fill" style={`width:${widths[i] ?? 0}%`} />
          </span>
          <span class="dash-bar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function FormChart({ data }: { data: StatsResponse }) {
  if (data.form.length === 0) return <p class="dash-note">No matches yet. Find a match to start your history.</p>;
  const W = 320;
  const H = 120;
  const pts = chartPoints(data.form.map((f) => f.finalStash), W, H, 12);
  return (
    <svg class="dash-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Final stash over your last matches">
      <line class="dash-axis" x1={12} y1={H - 12} x2={W - 12} y2={H - 12} />
      <polyline class="dash-line" points={toPolyline(pts)} />
      {pts.map((p, i) => (
        <circle class="dash-dot" key={i} cx={p.x} cy={p.y} r={3} />
      ))}
    </svg>
  );
}

function MatchTable({ rows }: { rows: MatchRow[] }) {
  if (rows.length === 0) return <p class="dash-note">No matches yet.</p>;
  return (
    <div class="dash-scroll">
      <table class="dash-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Players</th>
            <th>Place</th>
            <th>Stash</th>
            <th>Eaten</th>
            <th>Spit</th>
            <th>Steals</th>
            <th>Stolen</th>
            <th>Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.matchId}>
              <td>{new Date(m.startedAt).toLocaleDateString()}</td>
              <td>{m.playerCount}</td>
              <td>{ordinal(m.placement)}</td>
              <td>{m.finalStash}</td>
              <td>{m.bugsEaten}</td>
              <td>
                {m.hits}/{m.shots}
              </td>
              <td>{m.stealsMade}</td>
              <td>{m.stolenFrom}</td>
              <td>{signed(m.ratingDelta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Board({ rows, isGuest }: { rows: LeaderboardEntry[]; isGuest: boolean }) {
  return (
    <>
      {isGuest && <p class="dash-note">Guests are not ranked. Sign up to appear on the leaderboard.</p>}
      {rows.length === 0 ? (
        <p class="dash-note">No ranked players yet.</p>
      ) : (
        <div class="dash-scroll">
          <table class="dash-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Rating</th>
                <th>Wins</th>
                <th>Matches</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rank} class={r.isYou ? "dash-you" : ""}>
                  <td>{r.rank}</td>
                  <td>
                    {r.displayName}
                    {r.isYou ? " (you)" : ""}
                  </td>
                  <td>{r.rating}</td>
                  <td>{r.wins}</td>
                  <td>{r.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Dashboard({ session, onClose }: { session: Session; onClose: () => void }) {
  const [stats, setStats] = useState<Load<StatsResponse>>({ t: "loading" });
  const [matches, setMatches] = useState<Load<MatchesPage>>({ t: "loading" });
  const [board, setBoard] = useState<Load<LeaderboardEntry[]>>({ t: "loading" });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void statsApi.stats().then((r) => live && setStats(fromResult(r)));
    void statsApi.matches(null).then((r) => live && setMatches(fromResult(r)));
    void statsApi.leaderboard().then((r) => live && setBoard(fromResult(r)));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadMore() {
    if (matches.t !== "ready" || matches.value.nextCursor === null || moreBusy) return;
    setMoreBusy(true);
    setMoreFailed(false);
    const r = await statsApi.matches(matches.value.nextCursor);
    setMoreBusy(false);
    if (r.ok) {
      setMatches({
        t: "ready",
        value: { matches: [...matches.value.matches, ...r.value.matches], nextCursor: r.value.nextCursor },
      });
    } else {
      setMoreFailed(true);
    }
  }

  return (
    <div
      class="dash"
      role="dialog"
      aria-modal="true"
      aria-label="Your stats"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="dash-panel">
        <div class="dash-head">
          <h2>{session.user.displayName}'s stats</h2>
          <button type="button" class="bubble-btn secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <Status load={stats}>
          {(data) => (
            <>
              <Cards data={data} />
              <h3>Placements</h3>
              <BarRows rows={data.placements.map((n, i) => ({ label: ordinal(i + 1), value: n }))} />
              <h3>Final stash, last {data.form.length || 30} matches</h3>
              <FormChart data={data} />
              <h3>Steals</h3>
              <BarRows
                rows={[
                  { label: "Steals made", value: data.stats.stealsTotal },
                  { label: "Stolen from you", value: data.stats.stolenTotal },
                ]}
              />
            </>
          )}
        </Status>

        <h3>Recent matches</h3>
        <Status load={matches}>
          {(page) => (
            <>
              <MatchTable rows={page.matches} />
              {moreFailed && <p class="dash-note dash-bad">Could not load more matches.</p>}
              {page.nextCursor !== null && (
                <button type="button" class="bubble-btn secondary" disabled={moreBusy} onClick={() => void loadMore()}>
                  {moreBusy ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </Status>

        <h3>Leaderboard</h3>
        <Status load={board}>{(rows) => <Board rows={rows} isGuest={session.user.isGuest} />}</Status>
      </div>
    </div>
  );
}
