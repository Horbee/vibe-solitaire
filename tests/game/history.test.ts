import { describe, expect, it } from "vite-plus/test";
import { History } from "../../src/game/history";
import { applyMove } from "../../src/game/moves";
import { c, makeState } from "./helpers";

describe("History", () => {
  it("undo restores the previous state, redo reapplies", () => {
    const h = new History();
    const s0 = makeState({ stock: [c("spades", 1, false)] });
    h.record(s0);
    const s1 = applyMove(s0, { kind: "draw" })!;

    expect(h.canUndo).toBe(true);
    const back = h.undo(s1)!;
    expect(back).toEqual(s0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    const fwd = h.redo(back)!;
    expect(fwd).toEqual(s1);
    expect(h.canRedo).toBe(false);
  });

  it("returns null when nothing to undo/redo", () => {
    const h = new History();
    const s0 = makeState();
    expect(h.undo(s0)).toBeNull();
    expect(h.redo(s0)).toBeNull();
  });

  it("a new move clears the redo stack", () => {
    const h = new History();
    const s0 = makeState({ stock: [c("spades", 1, false)] });
    h.record(s0);
    const s1 = applyMove(s0, { kind: "draw" })!;
    h.undo(s1);
    expect(h.canRedo).toBe(true);
    h.record(s0);
    expect(h.canRedo).toBe(false);
  });

  it("supports long undo chains", () => {
    const h = new History();
    let state = makeState({ stock: [1, 2, 3, 4].map((r) => c("spades", r, false)) });
    const states = [state];
    for (let i = 0; i < 4; i++) {
      h.record(state);
      state = applyMove(state, { kind: "draw" })!;
      states.push(state);
    }
    for (let i = 4; i > 0; i--) {
      expect(state.moves).toBe(i);
      state = h.undo(state)!;
    }
    expect(state.moves).toBe(0);
    expect(state.waste).toHaveLength(0);
    expect(states[0]).toEqual(state);
  });

  it("clear empties both stacks", () => {
    const h = new History();
    h.record(makeState());
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
