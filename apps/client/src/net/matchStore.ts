import type { ServerErrorCode, ServerMsg, WireRank, WireRosterEntry } from "@spitfin/shared";
import type { NetStatus } from "./client";

export type Snap = Extract<ServerMsg, { t: "snap" }>;
export type Phase = "connecting" | "idle" | "queued" | "playing" | "ended" | "offline";

export interface MatchState {
  phase: Phase;
  link: NetStatus;
  waiting: number;
  you: number;
  seed: number;
  roster: WireRosterEntry[];
  ranking: WireRank[] | null;
  error: ServerErrorCode | null;
}

const initial = (): MatchState => ({
  phase: "connecting",
  link: "idle",
  waiting: 0,
  you: -1,
  seed: 0,
  roster: [],
  ranking: null,
  error: null,
});

export function createMatchStore() {
  let state = initial();
  const subs = new Set<() => void>();
  const snapSubs = new Set<(s: Snap) => void>();
  const set = (p: Partial<MatchState>) => {
    state = { ...state, ...p };
    subs.forEach((f) => f());
  };

  return {
    get state(): MatchState {
      return state;
    },
    subscribe(f: () => void): () => void {
      subs.add(f);
      return () => subs.delete(f);
    },
    onSnap(f: (s: Snap) => void): () => void {
      snapSubs.add(f);
      return () => snapSubs.delete(f);
    },
    handle(m: ServerMsg): void {
      switch (m.t) {
        case "welcome":
          if (state.phase === "connecting" || state.phase === "offline") set({ phase: "idle", error: null });
          break;
        case "queued":
          set({ phase: "queued", waiting: m.waiting, error: null });
          break;
        case "start":
          set({ phase: "playing", you: m.you, seed: m.seed, roster: m.players, ranking: null, error: null });
          break;
        case "snap":
          snapSubs.forEach((f) => f(m));
          break;
        case "end":
          set({ phase: "ended", ranking: m.ranking });
          break;
        case "error":
          set({ error: m.code });
          break;
      }
    },
    setLink(link: NetStatus): void {
      if (link === "closed") set({ link, phase: "offline" });
      else set({ link });
    },
    /** Back to the lobby screen (after the end card). */
    backToLobby(): void {
      set({ phase: "idle", ranking: null, error: null, waiting: 0 });
    },
  };
}
