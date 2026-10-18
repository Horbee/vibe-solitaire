import { hint } from "./hint";
import { applyMove } from "./moves";
import { topCard } from "./rules";
import type { GameState, Move } from "./types";
import { foundationRef, FOUNDATION_COUNT } from "./types";

/**
 * Card fingerprint used for loop detection. Face-down tableau cards keep the
 * game interesting; a position repeats only when every pile is identical.
 */
function fingerprint(state: GameState): string {
  const pile = (cards: { id: string; faceUp: boolean }[]) =>
    cards.map((c) => (c.faceUp ? c.id : "?")).join(",");
  return [
    state.stock.length,
    pile(state.waste),
    ...state.tableau.map(pile),
    ...state.foundations.map(pile),
  ].join("|");
}

/**
 * Full auto-completion: requires stock and waste to be empty and every
 * tableau card face-up — from there repeatedly moving the lowest available
 * tableau top card onto its foundation always wins.
 * Returns the move list, or null when the precondition does not hold.
 */
export function autoCompleteMoves(state: GameState): Move[] | null {
  if (state.status !== "playing") return null;
  if (state.stock.length > 0 || state.waste.length > 0) return null;
  if (state.tableau.some((pile) => pile.some((card) => !card.faceUp))) {
    return null;
  }

  const moves: Move[] = [];
  let current = structuredClone(state);

  while (current.status === "playing") {
    const move = findNextFoundationMove(current);
    if (!move) return null; // should not happen under the precondition
    const next = applyMove(current, move);
    if (!next) return null;
    moves.push(move);
    current = next;
  }
  return moves.length > 0 ? moves : null;
}

function findNextFoundationMove(state: GameState): Move | null {
  let best: { move: Move; rank: number } | null = null;
  for (let t = 0; t < state.tableau.length; t++) {
    const card = topCard(state.tableau[t]);
    if (!card?.faceUp) continue;
    for (let f = 0; f < FOUNDATION_COUNT; f++) {
      const move: Move = {
        kind: "move",
        from: { type: "tableau", index: t },
        to: foundationRef(f),
        count: 1,
      };
      const next = applyMove(state, move);
      if (next && (best === null || card.rank < best.rank)) {
        best = { move, rank: card.rank };
      }
    }
  }
  return best?.move ?? null;
}

export interface SolveResult {
  solved: boolean;
  moves: Move[];
}

/**
 * Greedy auto-player: repeatedly takes the engine's best hint move until the
 * game is won, no moves remain, or the position loops. Not a proof-complete
 * solver — it is a fast heuristic player.
 */
export function autoSolve(state: GameState, maxMoves = 2000): SolveResult {
  const moves: Move[] = [];
  const seen = new Set<string>([fingerprint(state)]);
  let current = state;

  while (current.status === "playing" && moves.length < maxMoves) {
    const nextMove = hint(current);
    if (!nextMove) break;
    const next = applyMove(current, nextMove.move);
    if (!next) break;
    const fp = fingerprint(next);
    if (seen.has(fp)) break;
    seen.add(fp);
    moves.push(nextMove.move);
    current = next;
  }

  return { solved: current.status === "won", moves };
}
