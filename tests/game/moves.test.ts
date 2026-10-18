import { describe, expect, it } from "vite-plus/test";
import { deal } from "../../src/game/deck";
import { applyMove } from "../../src/game/moves";
import type { GameState } from "../../src/game/types";
import { foundationRef, SCORE, tableauRef, WASTE } from "../../src/game/types";
import { c, makeState } from "./helpers";

describe("applyMove: draw", () => {
  it("draw 1 turns the stock top onto the waste face-up", () => {
    const stock = [c("spades", 1, false), c("hearts", 2, false)];
    const state = makeState({ stock });
    const next = applyMove(state, { kind: "draw" })!;
    expect(next.stock).toHaveLength(1);
    expect(next.waste.map((x) => x.id)).toEqual(["hearts-2"]);
    expect(next.waste[0].faceUp).toBe(true);
    expect(next.moves).toBe(1);
  });

  it("draw 3 turns three cards at once", () => {
    const stock = [1, 2, 3, 4, 5].map((r) => c("spades", r, false));
    const state = makeState({ stock, drawMode: 3 });
    const next = applyMove(state, { kind: "draw" })!;
    expect(next.stock.map((x) => x.rank)).toEqual([1, 2]);
    expect(next.waste.map((x) => x.rank)).toEqual([5, 4, 3]);
  });

  it("draw takes the remainder when fewer than the mode remain", () => {
    const stock = [c("spades", 1, false), c("spades", 2, false)];
    const state = makeState({ stock, drawMode: 3 });
    const next = applyMove(state, { kind: "draw" })!;
    expect(next.stock).toHaveLength(0);
    expect(next.waste).toHaveLength(2);
  });

  it("recycles the waste onto the stock face-down, preserving deal order", () => {
    const waste = [c("clubs", 1), c("clubs", 2), c("clubs", 3)];
    const state = makeState({ waste });
    const recycled = applyMove(state, { kind: "draw" })!;
    expect(recycled.waste).toHaveLength(0);
    expect(recycled.stock).toHaveLength(3);
    expect(recycled.stock.every((x) => !x.faceUp)).toBe(true);
    // First draw after recycling must yield the first card originally wasted.
    const redrawn = applyMove(recycled, { kind: "draw" })!;
    expect(redrawn.waste[0].id).toBe("clubs-1");
  });

  it("penalizes recycling in draw-3 mode, score floored at 0", () => {
    const waste = [c("clubs", 1)];
    const state = makeState({ waste, drawMode: 3, score: 50 });
    const next = applyMove(state, { kind: "draw" })!;
    expect(next.score).toBe(0); // 50 - 100 clamped
    const rich = applyMove(makeState({ waste, drawMode: 3, score: 150 }), { kind: "draw" })!;
    expect(rich.score).toBe(150 + SCORE.recycleWasteDraw3);
  });

  it("is free to recycle in draw-1 mode", () => {
    const state = makeState({ waste: [c("clubs", 1)], score: 10 });
    expect(applyMove(state, { kind: "draw" })!.score).toBe(10);
  });

  it("returns null when both stock and waste are empty", () => {
    expect(applyMove(makeState(), { kind: "draw" })).toBeNull();
  });
});

describe("applyMove: card moves", () => {
  it("moves waste top onto a tableau pile (+5)", () => {
    const state = makeState({
      waste: [c("hearts", 7)],
      tableau: [[c("spades", 8)], [], [], [], [], [], []],
    });
    const next = applyMove(state, {
      kind: "move",
      from: WASTE,
      to: tableauRef(0),
      count: 1,
    })!;
    expect(next.waste).toHaveLength(0);
    expect(next.tableau[0].map((x) => x.id)).toEqual(["spades-8", "hearts-7"]);
    expect(next.score).toBe(SCORE.wasteToTableau);
  });

  it("moves an Ace from waste to an empty foundation (+10)", () => {
    const state = makeState({ waste: [c("hearts", 1)] });
    const next = applyMove(state, {
      kind: "move",
      from: WASTE,
      to: foundationRef(0),
      count: 1,
    })!;
    expect(next.foundations[0][0].id).toBe("hearts-1");
    expect(next.score).toBe(SCORE.toFoundation);
  });

  it("moves a tableau run onto another pile", () => {
    const state = makeState({
      tableau: [
        [c("hearts", 9, false), c("spades", 8), c("hearts", 7)],
        [c("diamonds", 9)],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const next = applyMove(state, {
      kind: "move",
      from: tableauRef(0),
      to: tableauRef(1),
      count: 2,
    })!;
    expect(next.tableau[1].map((x) => x.id)).toEqual(["diamonds-9", "spades-8", "hearts-7"]);
  });

  it("flips the newly exposed tableau card (+5)", () => {
    const state = makeState({
      tableau: [[c("hearts", 9, false), c("spades", 8)], [c("diamonds", 9)], [], [], [], [], []],
    });
    const next = applyMove(state, {
      kind: "move",
      from: tableauRef(0),
      to: tableauRef(1),
      count: 1,
    })!;
    expect(next.tableau[0][0].faceUp).toBe(true);
    expect(next.score).toBe(SCORE.flipTableauCard);
  });

  it("moving a foundation card back to tableau costs 15", () => {
    const state = makeState({
      foundations: [[c("spades", 1), c("spades", 2)], [], [], []],
      tableau: [[c("hearts", 3)], [], [], [], [], [], []],
      score: 20,
    });
    const next = applyMove(state, {
      kind: "move",
      from: foundationRef(0),
      to: tableauRef(0),
      count: 1,
    })!;
    expect(next.foundations[0]).toHaveLength(1);
    expect(next.tableau[0].map((x) => x.id)).toEqual(["hearts-3", "spades-2"]);
    expect(next.score).toBe(20 + SCORE.foundationToTableau);
  });

  it("sets status to won on the final foundation move", () => {
    const kings = ["hearts", "diamonds", "clubs"] as const;
    const state = makeState({
      tableau: [[c("spades", 13)], [], [], [], [], [], []],
      foundations: [
        Array.from({ length: 12 }, (_, i) => c("spades", i + 1)),
        ...kings.map((s) => Array.from({ length: 13 }, (_, i) => c(s, i + 1))),
      ],
    });
    const next = applyMove(state, {
      kind: "move",
      from: tableauRef(0),
      to: foundationRef(0),
      count: 1,
    })!;
    expect(next.status).toBe("won");
  });

  it("never mutates the input state", () => {
    const state = makeState({
      waste: [c("hearts", 7)],
      tableau: [[c("spades", 8)], [], [], [], [], [], []],
    });
    const snapshot = structuredClone(state);
    applyMove(state, { kind: "move", from: WASTE, to: tableauRef(0), count: 1 });
    expect(state).toEqual(snapshot);
  });
});

describe("applyMove: rejects illegal moves", () => {
  const base: () => GameState = () =>
    makeState({
      waste: [c("hearts", 7)],
      tableau: [
        [c("hearts", 9, false), c("spades", 8), c("hearts", 7)],
        [c("diamonds", 9)],
        [],
        [],
        [],
        [],
        [],
      ],
    });

  it("rejects a move that breaks tableau rules", () => {
    const state = base();
    // hearts-7 onto diamonds-9: rank gap (needs 8)
    expect(
      applyMove(state, {
        kind: "move",
        from: tableauRef(0),
        to: tableauRef(1),
        count: 1,
      }),
    ).toBeNull();
  });

  it("rejects moving more cards than are movable", () => {
    const state = base();
    expect(
      applyMove(state, {
        kind: "move",
        from: tableauRef(0),
        to: tableauRef(1),
        count: 3,
      }),
    ).toBeNull(); // only 2 are face-up
    expect(
      applyMove(state, {
        kind: "move",
        from: WASTE,
        to: tableauRef(1),
        count: 2,
      }),
    ).toBeNull();
  });

  it("rejects moving within the same pile", () => {
    const state = base();
    expect(
      applyMove(state, {
        kind: "move",
        from: tableauRef(0),
        to: tableauRef(0),
        count: 1,
      }),
    ).toBeNull();
  });

  it("rejects a run onto a foundation", () => {
    const state = base();
    expect(
      applyMove(state, {
        kind: "move",
        from: tableauRef(0),
        to: foundationRef(0),
        count: 2,
      }),
    ).toBeNull();
  });

  it("rejects non-Ace to an empty foundation", () => {
    const state = base();
    expect(
      applyMove(state, {
        kind: "move",
        from: WASTE,
        to: foundationRef(0),
        count: 1,
      }),
    ).toBeNull();
  });

  it("rejects any move after the game is won", () => {
    const state = { ...base(), status: "won" as const };
    expect(applyMove(state, { kind: "draw" })).toBeNull();
    expect(applyMove(state, { kind: "move", from: WASTE, to: tableauRef(0), count: 1 })).toBeNull();
  });
});

describe("applyMove on a real deal", () => {
  it("counts moves across a sequence", () => {
    let state = deal(2024, 1);
    for (let i = 0; i < 5; i++) state = applyMove(state, { kind: "draw" })!;
    expect(state.moves).toBe(5);
    expect(state.waste).toHaveLength(5);
    expect(state.stock).toHaveLength(19);
  });
});
