export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Color = "red" | "black";

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

export const SUIT_COLOR: Record<Suit, Color> = {
  spades: "black",
  clubs: "black",
  hearts: "red",
  diamonds: "red",
};

/** Rank 1 = Ace ... 11 = Jack, 12 = Queen, 13 = King */
export interface Card {
  suit: Suit;
  rank: number;
  faceUp: boolean;
  /** Unique identity, e.g. "hearts-13" */
  id: string;
}

export type DrawMode = 1 | 3;

export type GameStatus = "playing" | "won";

export type PileType = "stock" | "waste" | "tableau" | "foundation";

export interface PileRef {
  type: PileType;
  index: number;
}

export const TABLEAU_COUNT = 7;
export const FOUNDATION_COUNT = 4;

export const STOCK: PileRef = { type: "stock", index: 0 };
export const WASTE: PileRef = { type: "waste", index: 0 };

export function tableauRef(index: number): PileRef {
  return { type: "tableau", index };
}

export function foundationRef(index: number): PileRef {
  return { type: "foundation", index };
}

export function samePile(a: PileRef, b: PileRef): boolean {
  return a.type === b.type && a.index === b.index;
}

export type Move = { kind: "draw" } | { kind: "move"; from: PileRef; to: PileRef; count: number };

export interface GameState {
  readonly drawMode: DrawMode;
  /** Seed used to shuffle this deal. */
  readonly seed: number;
  /** Face-down draw pile; top card is the last element. */
  stock: Card[];
  /** Face-up discard pile; top card is the last element. */
  waste: Card[];
  /** 7 tableau piles; top card of each pile is the last element. */
  tableau: Card[][];
  /** 4 foundation piles; top card of each pile is the last element. */
  foundations: Card[][];
  moves: number;
  score: number;
  status: GameStatus;
}

/** Standard (Windows-style) Klondike scoring. */
export const SCORE = {
  toFoundation: 10,
  wasteToTableau: 5,
  flipTableauCard: 5,
  foundationToTableau: -15,
  recycleWasteDraw3: -100,
} as const;
