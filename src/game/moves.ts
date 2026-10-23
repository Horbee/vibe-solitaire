import { canDraw, getPile, isLegalMove, isWon } from "./rules";
import type { Card, GameState, Move } from "./types";
import { SCORE } from "./types";

/**
 * Deep-clone a state with structuredClone semantics but far lower cost,
 * so the solver's search can afford one clone per explored edge.
 */
export function cloneState(state: GameState): GameState {
  const card = (c: Card): Card => ({ ...c });
  return {
    drawMode: state.drawMode,
    seed: state.seed,
    stock: state.stock.map(card),
    waste: state.waste.map(card),
    tableau: state.tableau.map((pile) => pile.map(card)),
    foundations: state.foundations.map((pile) => pile.map(card)),
    moves: state.moves,
    score: state.score,
    status: state.status,
  };
}

/**
 * Mutating move core, shared by applyMove and the solver's search.
 * Legality is the caller's responsibility (applyMove checks first;
 * the search only feeds it moves from legalMoves/canDraw).
 */
export function applyMoveInPlace(state: GameState, move: Move): void {
  if (move.kind === "draw") {
    applyDraw(state);
  } else {
    applyCardMove(state, move);
  }
}

/**
 * Apply a move, returning the next state, or null when the move is illegal.
 * Input state is never mutated; the result is a fresh clone.
 *
 * "draw" doubles as recycle: drawing from an empty stock turns the whole
 * waste pile back onto the stock (face-down, deal order preserved).
 */
export function applyMove(state: GameState, move: Move): GameState | null {
  if (!isLegalMove(state, move)) return null;
  const next = cloneState(state);
  next.moves += 1;
  applyMoveInPlace(next, move);

  next.score = Math.max(0, next.score);
  if (isWon(next)) next.status = "won";
  return next;
}

function applyDraw(state: GameState): void {
  if (!canDraw(state)) return;

  if (state.stock.length > 0) {
    const count = Math.min(state.drawMode, state.stock.length);
    for (let i = 0; i < count; i++) {
      const card = state.stock.pop()!;
      card.faceUp = true;
      state.waste.push(card);
    }
    return;
  }

  // Recycle: flip the waste pile back onto the stock.
  state.stock = state.waste.reverse().map((card) => {
    card.faceUp = false;
    return card;
  });
  state.waste = [];
  if (state.drawMode === 3) state.score += SCORE.recycleWasteDraw3;
}

function applyCardMove(state: GameState, move: Extract<Move, { kind: "move" }>): void {
  const source = getPile(state, move.from);
  const target = getPile(state, move.to);
  const moving = source.splice(source.length - move.count, move.count);
  target.push(...moving);

  if (move.to.type === "foundation") state.score += SCORE.toFoundation;
  if (move.from.type === "waste" && move.to.type === "tableau") {
    state.score += SCORE.wasteToTableau;
  }
  if (move.from.type === "foundation" && move.to.type === "tableau") {
    state.score += SCORE.foundationToTableau;
  }

  // Flip the newly exposed tableau card.
  if (move.from.type === "tableau" && source.length > 0) {
    const exposed = source[source.length - 1];
    if (!exposed.faceUp) {
      exposed.faceUp = true;
      state.score += SCORE.flipTableauCard;
    }
  }
}
