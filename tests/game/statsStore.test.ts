import { beforeEach, describe, expect, it } from "vite-plus/test";
import { StatsStore } from "../../src/ui/statsStore";

function memStorage(): Pick<Storage, "getItem" | "setItem"> & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

let storage: ReturnType<typeof memStorage>;
let store: StatsStore;

beforeEach(() => {
  storage = memStorage();
  store = new StatsStore(storage);
});

describe("StatsStore", () => {
  it("starts empty for both draw modes", () => {
    expect(store.get(1).played).toBe(0);
    expect(store.get(3).played).toBe(0);
    expect(store.get(1).bestTimeSec).toBeNull();
  });

  it("records wins with streaks and best score/time", () => {
    store.record(1, { won: true, seconds: 120, score: 700, moves: 120, seed: 1 });
    store.record(1, { won: true, seconds: 90, score: 650, moves: 110, seed: 2 });
    const m = store.get(1);
    expect(m.played).toBe(2);
    expect(m.won).toBe(2);
    expect(m.currentStreak).toBe(2);
    expect(m.bestStreak).toBe(2);
    expect(m.bestScore).toBe(700);
    expect(m.bestTimeSec).toBe(90);
  });

  it("losses reset the current streak but keep the best", () => {
    store.record(3, { won: true, seconds: 200, score: 500, moves: 150, seed: 1 });
    store.record(3, { won: false, seconds: 60, score: 100, moves: 30, seed: 2 });
    const m = store.get(3);
    expect(m.played).toBe(2);
    expect(m.won).toBe(1);
    expect(m.currentStreak).toBe(0);
    expect(m.bestStreak).toBe(1);
  });

  it("persists to storage and reloads", () => {
    store.record(1, { won: true, seconds: 45, score: 800, moves: 99, seed: 7 });
    const reloaded = new StatsStore(storage);
    expect(reloaded.get(1).won).toBe(1);
    expect(reloaded.get(1).bestTimeSec).toBe(45);
  });

  it("survives corrupt stored data", () => {
    storage.setItem("solitaire.stats.v1", "{not json");
    const s = new StatsStore(storage);
    expect(s.get(1).played).toBe(0);
  });

  it("reset clears everything", () => {
    store.record(1, { won: true, seconds: 45, score: 800, moves: 99, seed: 7 });
    store.reset();
    expect(store.get(1).played).toBe(0);
  });
});
