import type { Card, GameState, Move, PileRef } from "./types";
import { samePile, SUIT_COLOR } from "./types";

export function cardColor(card: Card): "red" | "black" {
  return SUIT_COLOR[card.suit];
}

/** The pile addressed by a ref. */
export function getPile(state: GameState, ref: PileRef): Card[] {
  switch (ref.type) {
    case "stock":
      return state.stock;
    case "waste":
      return state.waste;
    case "tableau":
      return state.tableau[ref.index];
    case "foundation":
      return state.foundations[ref.index];
  }
}

export function topCard(pile: Card[]): Card | undefined {
  return pile[pile.length - 1];
}

/**
 * True when the given face-up cards form a valid tableau run:
 * descending by one rank, alternating colors. A single face-up card
 * is always a valid run.
 */
export function isRun(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  for (const card of cards) {
    if (!card.faceUp) return false;
  }
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1];
    const next = cards[i];
    if (prev.rank !== next.rank + 1) return false;
    if (cardColor(prev) === cardColor(next)) return false;
  }
  return true;
}

/** Foundation builds up in suit, starting with an Ace. */
export function canPlaceOnFoundation(card: Card, pile: Card[]): boolean {
  const top = topCard(pile);
  if (!top) return card.rank === 1;
  return card.suit === top.suit && card.rank === top.rank + 1;
}

/** Tableau builds down in alternating colors; only a King to an empty pile. */
export function canPlaceOnTableau(card: Card, pile: Card[]): boolean {
  const top = topCard(pile);
  if (!top) return card.rank === 13;
  return cardColor(card) !== cardColor(top) && card.rank === top.rank - 1;
}

/**
 * How many cards may be taken from the top of the referenced pile.
 * Stock never yields cards directly; waste and foundations yield one;
 * a tableau pile yields its trailing face-up run.
 */
export function movableCount(state: GameState, ref: PileRef): number {
  const pile = getPile(state, ref);
  switch (ref.type) {
    case "stock":
      return 0;
    case "waste":
    case "foundation":
      return pile.length > 0 ? 1 : 0;
    case "tableau": {
      let count = 0;
      for (let i = pile.length - 1; i >= 0; i--) {
        if (!pile[i].faceUp) break;
        count++;
      }
      return count;
    }
  }
}

/** True when a face-down card sits directly under the moving stack. */
export function wouldReveal(state: GameState, from: PileRef, count: number): boolean {
  if (from.type !== "tableau") return false;
  const pile = state.tableau[from.index];
  const beneath = pile[pile.length - count - 1];
  return beneath !== undefined && !beneath.faceUp;
}

/** Full legality check for a move. */
export function isLegalMove(state: GameState, move: Move): boolean {
  if (state.status !== "playing") return false;
  if (move.kind === "draw") return canDraw(state);

  const { from, to, count } = move;
  if (samePile(from, to)) return false;
  if (count < 1 || count > movableCount(state, from)) return false;

  const source = getPile(state, from);
  const moving = source.slice(source.length - count);

  if (to.type === "foundation") {
    if (count !== 1) return false;
    return canPlaceOnFoundation(moving[0], getPile(state, to));
  }
  if (to.type === "tableau") {
    if (!isRun(moving)) return false;
    return canPlaceOnTableau(moving[0], getPile(state, to));
  }
  return false; // nothing may be moved onto stock or waste
}

export function canDraw(state: GameState): boolean {
  return state.status === "playing" && (state.stock.length > 0 || state.waste.length > 0);
}

export function isWon(state: GameState): boolean {
  return state.foundations.reduce((sum, pile) => sum + pile.length, 0) === 52;
}
