import { canDraw, isWon } from "./rules";
import { legalMoves, isPointlessMove, scoreMove } from "./hint";
import { applyMove, applyMoveInPlace, cloneState } from "./moves";
import { canPlaceOnFoundation, getPile, topCard } from "./rules";
import type { GameState, Move, PileRef } from "./types";
import { foundationRef, FOUNDATION_COUNT, tableauRef, WASTE } from "./types";

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

/**
 * Search-ordered candidate moves: the same heuristic priorities as hints
 * (foundation placements and reveals first, draws last, never pulling
 * back from a foundation), but without any UI reason strings.
 */
function orderedMoves(state: GameState): Move[] {
  const scored: { move: Move; score: number }[] = [];
  for (const move of legalMoves(state)) {
    if (move.kind !== "move") continue;
    if (isPointlessMove(state, move)) continue;
    if (move.from.type === "foundation") continue;
    scored.push({ move, score: scoreMove(state, move) });
  }
  if (canDraw(state)) {
    scored.push({ move: { kind: "draw" }, score: 1 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.move);
}

export interface SearchResult {
  /** "solved": a winning line was found. "budget": search gave up. */
  status: "solved" | "budget";
  /** Winning move line when solved; empty otherwise. */
  moves: Move[];
  /** Positions expanded — a deterministic effort proxy for difficulty. */
  nodes: number;
}

export interface SearchOptions {
  maxNodes?: number;
}

/** Default search budget; deals needing more are treated as unsolved. */
export const SEARCH_MAX_NODES = 1_500;

/**
 * Depth-first winnability search with fingerprint loop detection and a
 * node budget. "solved" is a proof of winnability (its move line replays
 * to a win through applyMove); "budget" is unknown, not a proof of loss.
 */
export function search(state: GameState, options: SearchOptions = {}): SearchResult {
  const maxNodes = options.maxNodes ?? SEARCH_MAX_NODES;
  const seen = new Set<string>();
  const path: Move[] = [];
  let nodes = 0;

  type Probe = "win" | "dead" | "budget";
  const dfs = (s: GameState): Probe => {
    if (s.status === "won") return "win";
    const fp = fingerprint(s);
    if (seen.has(fp)) return "dead";
    seen.add(fp);
    if (++nodes > maxNodes) return "budget";
    for (const move of orderedMoves(s)) {
      const next = cloneState(s);
      applyMoveInPlace(next, move);
      if (isWon(next)) next.status = "won";
      path.push(move);
      const probe = dfs(next);
      if (probe === "win" || probe === "budget") return probe;
      path.pop();
    }
    return "dead";
  };

  return dfs(state) === "win"
    ? { status: "solved", moves: path, nodes }
    : { status: "budget", moves: [], nodes };
}

/**
 * Right-click collection: repeatedly move the lowest-ranked exposed card
 * (waste top or any tableau top) onto a foundation until nothing more
 * qualifies. Never draws from the stock. Bounded by 52 placements, so it
 * always terminates. Returns the move list (possibly empty).
 */
export function autoCollectMoves(state: GameState): Move[] {
  if (state.status !== "playing") return [];
  const moves: Move[] = [];
  let current = state;

  for (let i = 0; i < 52; i++) {
    const nextMove = lowestRankedFoundationMove(current);
    if (!nextMove) return moves;
    const next = applyMove(current, nextMove);
    if (!next) return moves;
    moves.push(nextMove);
    current = next;
    if (current.status === "won") return moves;
  }
  return moves;
}

/** The legal foundation move using the lowest-ranked exposed card. */
function lowestRankedFoundationMove(state: GameState): Move | null {
  let best: Move | null = null;
  let bestRank = Infinity;

  const sources: PileRef[] = [
    WASTE,
    ...Array.from({ length: state.tableau.length }, (_, i) => tableauRef(i)),
  ];
  for (const from of sources) {
    const card = topCard(getPile(state, from));
    if (!card?.faceUp || card.rank >= bestRank) continue;
    for (let f = 0; f < FOUNDATION_COUNT; f++) {
      if (canPlaceOnFoundation(card, state.foundations[f])) {
        best = { kind: "move", from, to: foundationRef(f), count: 1 };
        bestRank = card.rank;
        break;
      }
    }
  }
  return best;
}
