import { describe, expect, it } from "vitest";
import { createMatchStore } from "./matchStore";

describe("match store", () => {
  it("moves through queue, start and end", () => {
    const s = createMatchStore();
    s.handle({ t: "welcome", tickHz: 30 });
    expect(s.state.phase).toBe("idle");
    s.handle({ t: "queued", waiting: 2 });
    expect(s.state).toMatchObject({ phase: "queued", waiting: 2 });
    s.handle({ t: "start", seed: 7, you: 1, players: [{ id: 0, name: "a" }, { id: 1, name: "b" }] });
    expect(s.state).toMatchObject({ phase: "playing", you: 1, seed: 7 });
    s.handle({ t: "end", ranking: [{ id: 1, rank: 1, stash: 2, eaten: 2, nips: 0 }] });
    expect(s.state.phase).toBe("ended");
    s.backToLobby();
    expect(s.state).toMatchObject({ phase: "idle", ranking: null });
  });

  it("keeps playing across a reconnect and forwards snapshots", () => {
    const s = createMatchStore();
    const ticks: number[] = [];
    s.onSnap((m) => ticks.push(m.tick));
    s.handle({ t: "start", seed: 1, you: 0, players: [{ id: 0, name: "a" }] });
    s.setLink("reconnecting");
    s.handle({ t: "welcome", tickHz: 30 });
    s.handle({ t: "snap", tick: 5, ack: 0, players: [], events: [] });
    expect(s.state.phase).toBe("playing");
    expect(ticks).toEqual([5]);
  });

  it("goes offline when the link is closed", () => {
    const s = createMatchStore();
    s.setLink("closed");
    expect(s.state.phase).toBe("offline");
  });
});
