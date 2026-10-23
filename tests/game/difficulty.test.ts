import { describe, expect, it } from "vite-plus/test";
import { deal } from "../../src/game/deck";
import { dealForDifficulty } from "../../src/game/difficulty";
import { applyMove } from "../../src/game/moves";
import { search } from "../../src/game/solve";
import type { GameState } from "../../src/game/types";

/** Independent proof that a deal is winnable: replay a found winning
 * line through the real applyMove and check the game ends "won". */
function winnable(state: GameState): boolean {
  const result = search(state, { maxNodes: 1_500 });
  if (result.status !== "solved") return false;
  let current = state;
  for (const move of result.moves) {
    const next = applyMove(current, move);
    if (!next) return false;
    current = next;
  }
  return current.status === "won";
}

describe("dealForDifficulty", () => {
  it("easy deals a proven-winnable game", () => {
    const state = dealForDifficulty("easy", 1, 1);
    expect(winnable(state)).toBe(true);
  }, 30_000);

  it("classic deals a proven-winnable game", () => {
    const state = dealForDifficulty("classic", 1, 1);
    expect(winnable(state)).toBe(true);
  }, 60_000);

  it("hard deals the raw seeded deal with no guarantees", () => {
    expect(dealForDifficulty("hard", 3, 12345)).toEqual(deal(12345, 3));
  });

  it("is deterministic for the same start seed", () => {
    const a = dealForDifficulty("easy", 1, 7);
    const b = dealForDifficulty("easy", 1, 7);
    expect(a.seed).toBe(b.seed);
  }, 30_000);
});
