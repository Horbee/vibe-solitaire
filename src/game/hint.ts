import { formatMove } from "./format";
import {
  canDraw,
  canPlaceOnFoundation,
  canPlaceOnTableau,
  cardColor,
  getPile,
  isLegalMove,
  isRun,
  movableCount,
  topCard,
  wouldReveal,
} from "./rules";
import type { Card, GameState, Move, PileRef, Suit } from "./types";
import { foundationRef, FOUNDATION_COUNT, tableauRef, TABLEAU_COUNT, WASTE } from "./types";

/**
 * Every currently legal card move (draw excluded).
 * Includes foundation→tableau back-moves so callers can reason about
 * true legality; hinting filters those out.
 */
export function legalMoves(state: GameState): Move[] {
  if (state.status !== "playing") return [];
  const moves: Move[] = [];

  const sources: PileRef[] = [WASTE];
  for (let i = 0; i < TABLEAU_COUNT; i++) sources.push(tableauRef(i));
  for (let i = 0; i < FOUNDATION_COUNT; i++) sources.push(foundationRef(i));

  for (const from of sources) {
    const pile = getPile(state, from);
    if (pile.length === 0) continue;
    const max = movableCount(state, from);

    for (let count = max; count >= 1; count--) {
      const moving = pile.slice(pile.length - count);
      if (from.type === "tableau" && !isRun(moving)) continue;
      if (from.type === "waste" && count !== 1) break;
      if (from.type === "foundation" && count !== 1) break;

      for (let f = 0; f < FOUNDATION_COUNT; f++) {
        if (count === 1 && canPlaceOnFoundation(moving[0], state.foundations[f])) {
          moves.push({ kind: "move", from, to: foundationRef(f), count });
        }
      }
      for (let t = 0; t < TABLEAU_COUNT; t++) {
        if (from.type === "tableau" && from.index === t) continue;
        if (canPlaceOnTableau(moving[0], state.tableau[t])) {
          moves.push({ kind: "move", from, to: tableauRef(t), count });
        }
      }
    }
  }

  return moves.filter((move) => isLegalMove(state, move));
}

/**
 * A foundation move is safe when the card can never be needed underneath a
 * lower card in the tableau: Aces and Twos are always safe, and beyond that
 * both opposite-color foundations must already reach rank-1.
 */
export function isSafeFoundationMove(state: GameState, card: Card): boolean {
  if (card.rank <= 2) return true;
  const oppositeSuits: Suit[] =
    cardColor(card) === "red" ? ["spades", "clubs"] : ["hearts", "diamonds"];
  return oppositeSuits.every((suit) => {
    const pile = state.foundations.find((f) => topCard(f)?.suit === suit);
    const topRank = pile ? (topCard(pile)?.rank ?? 0) : 0;
    return topRank >= card.rank - 1;
  });
}

/** Moving an entire tableau pile onto an empty tableau is a pointless no-op. */
export function isPointlessMove(state: GameState, move: Move): boolean {
  if (move.kind !== "move") return false;
  if (move.from.type !== "tableau" || move.to.type !== "tableau") return false;
  const target = state.tableau[move.to.index];
  if (target.length > 0) return false;
  const source = state.tableau[move.from.index];
  if (move.count < source.length) return false;
  return !source.some((card) => !card.faceUp);
}

export interface ScoredMove {
  move: Move;
  score: number;
  reason: string;
}

/** Rank candidate moves for hinting; best first. */
export function rankMoves(state: GameState): ScoredMove[] {
  const scored: ScoredMove[] = [];

  for (const move of legalMoves(state)) {
    if (move.kind !== "move") continue;
    if (isPointlessMove(state, move)) continue;
    if (move.from.type === "foundation") continue; // never hint back-moves

    const source = getPile(state, move.from);
    const moving = source.slice(source.length - move.count);
    let score = 0;

    if (move.to.type === "foundation") {
      score += isSafeFoundationMove(state, moving[0]) ? 60 : 30;
    } else if (move.to.type === "tableau") {
      score += 20;
    }
    if (wouldReveal(state, move.from, move.count)) score += 45;
    if (move.from.type === "waste") score += 5;

    scored.push({ move, score, reason: formatMove(move, moving) });
  }

  // Drawing is the last resort, always available while cards remain.
  if (canDraw(state)) {
    scored.push({ move: { kind: "draw" }, score: 1, reason: "Draw from the stock" });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export interface Hint {
  move: Move;
  reason: string;
}

/** Best suggested move, or null when nothing can be done. */
export function hint(state: GameState): Hint | null {
  return rankMoves(state)[0] ?? null;
}

/** True when any action (card move or draw) is possible. */
export function hasAnyAction(state: GameState): boolean {
  return legalMoves(state).length > 0 || canDraw(state);
}
