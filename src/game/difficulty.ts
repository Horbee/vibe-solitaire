import { deal } from "./deck";
import { search } from "./solve";
import type { DrawMode, GameState } from "./types";

/**
 * Difficulty grades the deal, not the rules: "easy" and "classic" scan
 * deterministic seeds until the solver proves the game winnable — cheaply
 * for easy, with real search effort for classic. "hard" is the raw seeded
 * deal with no guarantees (the historical behaviour).
 */
export type Difficulty = "easy" | "classic" | "hard";

/** Solver budget for the easy scan; solving within it counts as easy. */
export const EASY_SCAN_NODES = 400;
/** Solver budget for the classic scan (its search must work harder). */
export const CLASSIC_SCAN_NODES = 1_500;
/** Seeds to try before settling for the best winnable candidate found. */
const MAX_SCAN_ATTEMPTS = 24;
const SEED_SPACE = 2 ** 31;

export interface DealForDifficultyOptions {
  /** Overrides the default scan attempt cap (tests use fewer). */
  maxAttempts?: number;
}

/**
 * Deal a fresh game for the given difficulty, scanning forward from
 * `startSeed` (seed, seed + 1, …) when a winnability guarantee is
 * requested. Deterministic: the same arguments always yield the same
 * deal. Falls back to the best winnable candidate seen — or, in the
 * worst case, the raw deal — when the scan cap is hit.
 */
export function dealForDifficulty(
  difficulty: Difficulty,
  drawMode: DrawMode,
  startSeed: number,
  options: DealForDifficultyOptions = {},
): GameState {
  if (difficulty === "hard") return deal(startSeed, drawMode);

  const maxAttempts = options.maxAttempts ?? MAX_SCAN_ATTEMPTS;
  const budget = difficulty === "easy" ? EASY_SCAN_NODES : CLASSIC_SCAN_NODES;
  let fallback: GameState | null = null;
  let fallbackEffort = Infinity;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = (startSeed + attempt) % SEED_SPACE;
    const candidate = deal(seed, drawMode);
    const result = search(candidate, { maxNodes: budget });

    if (result.status !== "solved") continue;
    if (difficulty === "easy" || result.nodes > EASY_SCAN_NODES) {
      return candidate;
    }
    if (result.nodes < fallbackEffort) {
      fallback = candidate;
      fallbackEffort = result.nodes;
    }
  }

  return fallback ?? deal((startSeed + maxAttempts) % SEED_SPACE, drawMode);
}
