import type { Card, GameState, Suit } from "../../src/game/types";

/** Build a card for hand-crafted states. Face-up by default. */
export function c(suit: Suit, rank: number, faceUp = true): Card {
  return { suit, rank, faceUp, id: `${suit}-${rank}` };
}

interface StateOverrides {
  stock?: Card[];
  waste?: Card[];
  tableau?: Card[][];
  foundations?: Card[][];
  drawMode?: 1 | 3;
  moves?: number;
  score?: number;
  status?: "playing" | "won";
}

/** Fresh playing state with sensible empty piles, overridable per test. */
export function makeState(overrides: StateOverrides = {}): GameState {
  return {
    drawMode: overrides.drawMode ?? 1,
    seed: 1,
    stock: overrides.stock ?? [],
    waste: overrides.waste ?? [],
    tableau: overrides.tableau ?? [[], [], [], [], [], [], []],
    foundations: overrides.foundations ?? [[], [], [], []],
    moves: overrides.moves ?? 0,
    score: overrides.score ?? 0,
    status: overrides.status ?? "playing",
  };
}
