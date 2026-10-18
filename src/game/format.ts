import type { Card, Move, PileRef, Suit } from "./types";

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const RANK_NAME: Record<number, string> = {
  1: "A",
  11: "J",
  12: "Q",
  13: "K",
};

export function rankName(rank: number): string {
  return RANK_NAME[rank] ?? String(rank);
}

/** Short card label, e.g. "K♠". */
export function formatCard(card: Card): string {
  return `${rankName(card.rank)}${SUIT_SYMBOL[card.suit]}`;
}

function pileName(ref: PileRef): string {
  switch (ref.type) {
    case "stock":
      return "the stock";
    case "waste":
      return "the waste";
    case "tableau":
      return `column ${ref.index + 1}`;
    case "foundation":
      return "a foundation";
  }
}

/** Human-readable move description for hint display. */
export function formatMove(move: Move, moving: Card[]): string {
  if (move.kind === "draw") return "Draw from the stock";
  const bottom = moving[0];
  const label =
    moving.length > 1 ? `${formatCard(bottom)} (+${moving.length - 1})` : formatCard(bottom);
  return `Move ${label} to ${pileName(move.to)}`;
}
