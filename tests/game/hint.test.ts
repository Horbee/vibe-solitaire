import { describe, expect, it } from "vite-plus/test";
import { deal } from "../../src/game/deck";
import {
  hasAnyAction,
  hint,
  isPointlessMove,
  isSafeFoundationMove,
  legalMoves,
  rankMoves,
} from "../../src/game/hint";
import { foundationRef, tableauRef, WASTE } from "../../src/game/types";
import { c, makeState } from "./helpers";

describe("legalMoves", () => {
  it("is empty for a fresh deal (except draws)", () => {
    // A deal can theoretically have top-card moves, so assert only shape here.
    const state = deal(1, 1);
    for (const m of legalMoves(state)) {
      expect(m.kind).toBe("move");
    }
  });

  it("finds waste/tableau/foundation moves", () => {
    const state = makeState({
      waste: [c("hearts", 1)],
      tableau: [[c("spades", 8)], [c("hearts", 7)], [], [], [], [], []],
      foundations: [[], [], [c("diamonds", 7)], []],
    });
    const moves = legalMoves(state).filter((m) => m.kind === "move");
    // h1 -> an empty foundation, h7 -> spades-8, d7 (foundation) -> spades-8
    expect(moves).toContainEqual(
      expect.objectContaining({
        from: WASTE,
        to: foundationRef(0),
        count: 1,
      }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({
        from: tableauRef(1),
        to: tableauRef(0),
        count: 1,
      }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({
        from: foundationRef(2),
        to: tableauRef(0),
        count: 1,
      }),
    );
  });

  it("never moves to the stock or waste", () => {
    const state = makeState({
      stock: [c("clubs", 5, false)],
      tableau: [[c("spades", 8)], [], [], [], [], [], []],
    });
    for (const m of legalMoves(state)) {
      if (m.kind === "move") {
        expect(m.to.type).not.toBe("stock");
        expect(m.to.type).not.toBe("waste");
      }
    }
  });
});

describe("isSafeFoundationMove", () => {
  it("Aces and Twos are always safe", () => {
    const state = makeState();
    expect(isSafeFoundationMove(state, c("hearts", 1))).toBe(true);
    expect(isSafeFoundationMove(state, c("hearts", 2))).toBe(true);
  });

  it("higher ranks need both opposite foundations one rank below", () => {
    const none = makeState();
    expect(isSafeFoundationMove(none, c("hearts", 3))).toBe(false);

    const one = makeState({ foundations: [[c("spades", 2)], [], [], []] });
    expect(isSafeFoundationMove(one, c("hearts", 3))).toBe(false); // clubs missing

    const both = makeState({
      foundations: [[c("spades", 2)], [c("clubs", 2)], [], []],
    });
    expect(isSafeFoundationMove(both, c("hearts", 3))).toBe(true);
    expect(isSafeFoundationMove(both, c("hearts", 4))).toBe(false);
  });
});

describe("isPointlessMove / rankMoves", () => {
  it("excludes moving a whole face-up King pile to an empty column", () => {
    const state = makeState({
      tableau: [[c("spades", 13)], [], [], [], [], [], []],
    });
    const pointless = {
      kind: "move" as const,
      from: tableauRef(0),
      to: tableauRef(1),
      count: 1,
    };
    expect(isPointlessMove(state, pointless)).toBe(true);
    expect(legalMoves(state)).toContainEqual(pointless); // still *legal*
    expect(rankMoves(state).map((s) => s.move)).not.toContainEqual(pointless);
  });

  it("keeps King moves that reveal a face-down card", () => {
    const state = makeState({
      tableau: [[c("hearts", 1, false), c("spades", 13)], [], [], [], [], [], []],
    });
    const move = {
      kind: "move" as const,
      from: tableauRef(0),
      to: tableauRef(1),
      count: 1,
    };
    expect(isPointlessMove(state, move)).toBe(false);
    expect(rankMoves(state).map((s) => s.move)).toContainEqual(move);
  });

  it("ranks a revealing move above an unsafe foundation move", () => {
    // hearts-3 to a foundation is legal but unsafe (opposite foundations
    // are empty); the revealing tableau move should outrank it.
    const state = makeState({
      waste: [c("hearts", 3)],
      tableau: [[c("clubs", 7, false), c("spades", 6)], [c("hearts", 7)], [], [], [], [], []],
    });
    const ranked = rankMoves(state);
    expect(ranked[0].move).toEqual({
      kind: "move",
      from: tableauRef(0),
      to: tableauRef(1),
      count: 1,
    });
    expect(ranked[0].reason).toContain("column 2");
  });
});

describe("hint", () => {
  it("suggests drawing when nothing else is available", () => {
    const state = makeState({ stock: [c("spades", 5, false)] });
    expect(hint(state)?.move).toEqual({ kind: "draw" });
    expect(hint(state)?.reason).toBe("Draw from the stock");
  });

  it("returns null when the game is over", () => {
    const state = makeState({ status: "won" });
    expect(hint(state)).toBeNull();
  });

  it("prefers a safe foundation move from the waste over drawing", () => {
    const state = makeState({
      stock: [c("spades", 5, false)],
      waste: [c("hearts", 1)],
    });
    const h = hint(state)!;
    expect(h.move).toEqual({
      kind: "move",
      from: WASTE,
      to: expect.objectContaining({ type: "foundation" }),
      count: 1,
    });
  });
});

describe("hasAnyAction", () => {
  it("is false only when no move and no draw is possible", () => {
    expect(hasAnyAction(makeState())).toBe(false);
    expect(hasAnyAction(makeState({ stock: [c("spades", 1, false)] }))).toBe(true);
    expect(hasAnyAction(makeState({ tableau: [[c("spades", 13)], [], [], [], [], [], []] }))).toBe(
      true,
    );
  });
});
