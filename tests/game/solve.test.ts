import { describe, expect, it } from "vite-plus/test";
import { applyMove } from "../../src/game/moves";
import { autoCompleteMoves, autoSolve } from "../../src/game/solve";
import { c, makeState } from "./helpers";

const fullFoundation = (suit: "spades" | "hearts" | "diamonds" | "clubs", toRank = 13) =>
  Array.from({ length: toRank }, (_, i) => c(suit, i + 1));

/** Near-won: foundations at 12 each, the four Kings on the tableau. */
function nearWon() {
  return makeState({
    tableau: [
      [c("spades", 13)],
      [c("hearts", 13)],
      [c("diamonds", 13)],
      [c("clubs", 13)],
      [],
      [],
      [],
    ],
    foundations: [
      fullFoundation("spades", 12),
      fullFoundation("hearts", 12),
      fullFoundation("diamonds", 12),
      fullFoundation("clubs", 12),
    ],
  });
}

describe("autoCompleteMoves", () => {
  it("returns null when preconditions are not met", () => {
    expect(
      autoCompleteMoves(makeState({ stock: [c("spades", 5, false)], ...nearWonPiles() })),
    ).toBeNull();
    expect(
      autoCompleteMoves(
        makeState({
          tableau: [[c("spades", 13, false)], [], [], [], [], [], []],
          foundations: nearWon().foundations,
        }),
      ),
    ).toBeNull();
  });

  it("produces a move list that wins a trivially winnable game", () => {
    const state = nearWon();
    const moves = autoCompleteMoves(state)!;
    expect(moves).toHaveLength(4);

    let current = state;
    for (const m of moves) {
      const next = applyMove(current, m);
      expect(next).not.toBeNull();
      current = next!;
    }
    expect(current.status).toBe("won");
  });
});

function nearWonPiles() {
  const n = nearWon();
  return { tableau: n.tableau, foundations: n.foundations };
}

describe("autoSolve", () => {
  it("solves a trivially winnable position", () => {
    const result = autoSolve(nearWon());
    expect(result.solved).toBe(true);
    expect(result.moves).toHaveLength(4);
  });

  it("reports an already-won game as solved with no moves", () => {
    const result = autoSolve(makeState({ status: "won" }));
    expect(result).toEqual({ solved: true, moves: [] });
  });

  it("terminates on cycling positions without winning", () => {
    const state = makeState({
      stock: [c("hearts", 1, false), c("spades", 2, false)],
    });
    const result = autoSolve(state);
    expect(result.solved).toBe(false);
    expect(result.moves.length).toBeLessThan(50);
  });
});
