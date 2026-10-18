import { describe, expect, it } from "vite-plus/test";
import { applyMove } from "../../src/game/moves";
import { autoCollectMoves, autoCompleteMoves, autoSolve } from "../../src/game/solve";
import { foundationRef } from "../../src/game/types";
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

describe("autoCollectMoves", () => {
  it("collects a trivially winnable game to victory", () => {
    const state = nearWon();
    const moves = autoCollectMoves(state);
    expect(moves).toHaveLength(4);

    let current = state;
    for (const m of moves) current = applyMove(current, m)!;
    expect(current.status).toBe("won");
  });

  it("moves lowest-ranked cards first, mixing waste and tableau", () => {
    const state = makeState({
      waste: [c("spades", 2)],
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const moves = autoCollectMoves(state);
    // Ace from the tableau first, then the Two from the waste.
    expect(moves).toEqual([
      {
        kind: "move",
        from: { type: "tableau", index: 0 },
        to: foundationRef(0),
        count: 1,
      },
      { kind: "move", from: { type: "waste", index: 0 }, to: foundationRef(0), count: 1 },
    ]);
  });

  it("returns an empty list when nothing can go to a foundation", () => {
    const state = makeState({
      waste: [c("spades", 7)],
      tableau: [[c("hearts", 5)], [c("clubs", 9)], [], [], [], [], []],
    });
    expect(autoCollectMoves(state)).toEqual([]);
  });

  it("stops mid-run when no further card qualifies", () => {
    // A♥ can go up; 3♦ cannot (no 2♦ underneath).
    const state = makeState({
      tableau: [[c("hearts", 1)], [c("diamonds", 3)], [], [], [], [], []],
    });
    const moves = autoCollectMoves(state);
    expect(moves).toHaveLength(1);
    const after = applyMove(state, moves[0])!;
    expect(after.foundations[0].map((x) => x.id)).toEqual(["hearts-1"]);
    expect(after.tableau[1][0].id).toBe("diamonds-3"); // left behind
  });

  it("never draws from the stock", () => {
    const state = makeState({
      stock: [c("hearts", 1, false)], // an Ace, but face-down in the stock
    });
    expect(autoCollectMoves(state)).toEqual([]);
  });

  it("is empty once the game is over", () => {
    expect(autoCollectMoves({ ...nearWon(), status: "won" })).toEqual([]);
  });
});
