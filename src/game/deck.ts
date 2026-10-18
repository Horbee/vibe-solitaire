import { mulberry32 } from "./rng";
import type { Card, DrawMode, GameState } from "./types";
import { FOUNDATION_COUNT, SUITS, TABLEAU_COUNT } from "./types";

/** Ordered deck of 52 unique, face-down cards. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank, faceUp: false, id: `${suit}-${rank}` });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle driven by the seeded PRNG. Returns a new array. */
export function shuffle(deck: Card[], seed: number): Card[] {
  const rng = mulberry32(seed);
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * Deal a fresh Klondike game from a seed.
 * Tableau pile i receives i+1 cards (dealt round-robin); only each pile's
 * top card is face-up. The remaining 24 cards go to the stock.
 */
export function deal(seed: number, drawMode: DrawMode): GameState {
  const deck = shuffle(createDeck(), seed);
  const tableau: Card[][] = Array.from({ length: TABLEAU_COUNT }, () => []);

  let ci = 0;
  for (let row = 0; row < TABLEAU_COUNT; row++) {
    for (let col = row; col < TABLEAU_COUNT; col++) {
      tableau[col].push(deck[ci++]);
    }
  }
  for (const pile of tableau) {
    pile[pile.length - 1].faceUp = true;
  }

  const stock = deck.slice(ci); // already face-down; last element is the top
  const foundations: Card[][] = Array.from({ length: FOUNDATION_COUNT }, () => []);

  return {
    drawMode,
    seed,
    stock,
    waste: [],
    tableau,
    foundations,
    moves: 0,
    score: 0,
    status: "playing",
  };
}
