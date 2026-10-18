import { describe, expect, it } from "vite-plus/test";
import { createDeck, deal, shuffle } from "../../src/game/deck";

describe("createDeck", () => {
  it("contains 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
  });

  it("starts all cards face-down", () => {
    expect(createDeck().every((c) => !c.faceUp)).toBe(true);
  });
});

describe("shuffle", () => {
  it("is deterministic for the same seed", () => {
    const a = shuffle(createDeck(), 7).map((c) => c.id);
    const b = shuffle(createDeck(), 7).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("differs for different seeds", () => {
    const a = shuffle(createDeck(), 1).map((c) => c.id);
    const b = shuffle(createDeck(), 2).map((c) => c.id);
    expect(a).not.toEqual(b);
  });

  it("is a permutation of the deck", () => {
    const shuffled = shuffle(createDeck(), 5);
    expect(shuffled.map((c) => c.id).sort()).toEqual(
      createDeck()
        .map((c) => c.id)
        .sort(),
    );
  });
});

describe("deal", () => {
  it("deals tableau piles of sizes 1..7 with only top cards face-up", () => {
    const state = deal(123, 1);
    expect(state.tableau.map((p) => p.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const pile of state.tableau) {
      expect(pile.filter((c) => c.faceUp)).toHaveLength(1);
      expect(pile[pile.length - 1].faceUp).toBe(true);
    }
  });

  it("puts 24 face-down cards in the stock", () => {
    const state = deal(123, 1);
    expect(state.stock).toHaveLength(24);
    expect(state.stock.every((c) => !c.faceUp)).toBe(true);
  });

  it("starts with empty waste and foundations, zero moves/score", () => {
    const state = deal(123, 3);
    expect(state.drawMode).toBe(3);
    expect(state.waste).toHaveLength(0);
    expect(state.foundations.flat()).toHaveLength(0);
    expect(state.moves).toBe(0);
    expect(state.score).toBe(0);
    expect(state.status).toBe("playing");
  });

  it("is reproducible for the same seed", () => {
    const flatten = (s: ReturnType<typeof deal>) =>
      [...s.stock, ...s.waste, ...s.tableau.flat(), ...s.foundations.flat()].map(
        (c) => c.id + (c.faceUp ? "+" : "-"),
      );
    expect(flatten(deal(42, 1))).toEqual(flatten(deal(42, 1)));
  });

  it("contains every card exactly once", () => {
    const state = deal(9, 1);
    const all = [
      ...state.stock,
      ...state.waste,
      ...state.tableau.flat(),
      ...state.foundations.flat(),
    ];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });
});
