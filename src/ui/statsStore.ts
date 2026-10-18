import type { DrawMode } from "../game/types";

export interface GameResult {
  won: boolean;
  seconds: number;
  score: number;
  moves: number;
  seed: number;
}

export interface ModeStats {
  played: number;
  won: number;
  currentStreak: number;
  bestStreak: number;
  bestScore: number | null;
  /** Best winning time in seconds. */
  bestTimeSec: number | null;
}

export type Stats = Record<"1" | "3", ModeStats>;

const STORAGE_KEY = "solitaire.stats.v1";

function emptyModeStats(): ModeStats {
  return {
    played: 0,
    won: 0,
    currentStreak: 0,
    bestStreak: 0,
    bestScore: null,
    bestTimeSec: null,
  };
}

/** localStorage-backed per-draw-mode statistics. */
export class StatsStore {
  private stats: Stats;
  private readonly storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage) {
    this.storage = storage;
    this.stats = this.load();
  }

  private load(): Stats {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return { "1": emptyModeStats(), "3": emptyModeStats() };
      const parsed = JSON.parse(raw) as Partial<Stats>;
      return {
        "1": { ...emptyModeStats(), ...parsed["1"] },
        "3": { ...emptyModeStats(), ...parsed["3"] },
      };
    } catch {
      return { "1": emptyModeStats(), "3": emptyModeStats() };
    }
  }

  private save(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
    } catch {
      // Storage full or unavailable (private mode etc.): stats are best-effort.
    }
  }

  get(mode: DrawMode): ModeStats {
    return { ...this.stats[String(mode) as "1" | "3"] };
  }

  all(): Stats {
    return { "1": this.get(1), "3": this.get(3) };
  }

  record(mode: DrawMode, result: GameResult): void {
    const m = this.stats[String(mode) as "1" | "3"];
    m.played += 1;
    if (result.won) {
      m.won += 1;
      m.currentStreak += 1;
      m.bestStreak = Math.max(m.bestStreak, m.currentStreak);
      m.bestScore = m.bestScore === null ? result.score : Math.max(m.bestScore, result.score);
      m.bestTimeSec =
        m.bestTimeSec === null ? result.seconds : Math.min(m.bestTimeSec, result.seconds);
    } else {
      m.currentStreak = 0;
    }
    this.save();
  }

  reset(): void {
    this.stats = { "1": emptyModeStats(), "3": emptyModeStats() };
    this.save();
  }
}
