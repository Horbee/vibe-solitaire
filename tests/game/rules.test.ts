import { describe, expect, it } from "vite-plus/test";
import {
  canPlaceOnFoundation,
  canPlaceOnTableau,
  isRun,
  isWon,
  movableCount,
} from "../../src/game/rules";
import { WASTE } from "../../src/game/types";
import { c, makeState } from "./helpers";

describe("isRun", () => {
  it("accepts a single face-up card", () => {
    expect(isRun([c("spades", 5)])).toBe(true);
  });

  it("accepts descending alternating colors", () => {
    expect(isRun([c("spades", 7), c("hearts", 6), c("clubs", 5)])).toBe(true);
  });

  it("rejects same-color sequences", () => {
    expect(isRun([c("spades", 7), c("clubs", 6)])).toBe(false);
  });

  it("rejects non-descending sequences", () => {
    expect(isRun([c("spades", 7), c("hearts", 5)])).toBe(false);
  });

  it("rejects face-down cards", () => {
    expect(isRun([c("spades", 7, false), c("hearts", 6)])).toBe(false);
  });
});

describe("canPlaceOnFoundation", () => {
  it("accepts an Ace on an empty pile", () => {
    expect(canPlaceOnFoundation(c("hearts", 1), [])).toBe(true);
  });

  it("rejects other ranks on an empty pile", () => {
    expect(canPlaceOnFoundation(c("hearts", 5), [])).toBe(false);
    expect(canPlaceOnFoundation(c("hearts", 13), [])).toBe(false);
  });

  it("builds up in suit", () => {
    const pile = [c("spades", 1), c("spades", 2)];
    expect(canPlaceOnFoundation(c("spades", 3), pile)).toBe(true);
    expect(canPlaceOnFoundation(c("clubs", 3), pile)).toBe(false); // wrong suit
    expect(canPlaceOnFoundation(c("spades", 5), pile)).toBe(false); // gap
    expect(canPlaceOnFoundation(c("spades", 2), pile)).toBe(false); // duplicate
  });
});

describe("canPlaceOnTableau", () => {
  it("accepts only a King on an empty pile", () => {
    expect(canPlaceOnTableau(c("spades", 13), [])).toBe(true);
    expect(canPlaceOnTableau(c("spades", 12), [])).toBe(false);
  });

  it("builds down in alternating colors", () => {
    const pile = [c("hearts", 9)];
    expect(canPlaceOnTableau(c("spades", 8), pile)).toBe(true);
    expect(canPlaceOnTableau(c("diamonds", 8), pile)).toBe(false); // same color
    expect(canPlaceOnTableau(c("spades", 7), pile)).toBe(false); // gap
    expect(canPlaceOnTableau(c("spades", 9), pile)).toBe(false); // same rank
  });
});

describe("movableCount", () => {
  it("is 0 for stock, 1 for waste/foundation when non-empty", () => {
    const state = makeState({
      stock: [c("spades", 3, false)],
      waste: [c("hearts", 4)],
      foundations: [[c("clubs", 1)], [], [], []],
    });
    expect(movableCount(state, { type: "stock", index: 0 })).toBe(0);
    expect(movableCount(state, WASTE)).toBe(1);
    expect(movableCount(state, { type: "foundation", index: 0 })).toBe(1);
    expect(movableCount(state, { type: "foundation", index: 1 })).toBe(0);
  });

  it("counts only the trailing face-up run of a tableau pile", () => {
    const state = makeState({
      tableau: [[c("spades", 9, false), c("hearts", 8), c("spades", 7)], [], [], [], [], [], []],
    });
    expect(movableCount(state, { type: "tableau", index: 0 })).toBe(2);
  });
});

describe("isWon", () => {
  it("is true only when all foundations hold 13 cards", () => {
    const full = Array.from({ length: 13 }, (_, i) => c("spades", i + 1));
    const state = makeState({
      foundations: [
        full,
        Array.from({ length: 13 }, (_, i) => c("hearts", i + 1)),
        Array.from({ length: 13 }, (_, i) => c("diamonds", i + 1)),
        Array.from({ length: 13 }, (_, i) => c("clubs", i + 1)),
      ],
    });
    expect(isWon(state)).toBe(true);

    const almost = makeState({ foundations: [full, [], [], []] });
    expect(isWon(almost)).toBe(false);
  });
});
