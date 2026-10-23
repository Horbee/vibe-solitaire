import type { GameState, PileRef } from "../game/types";

/**
 * World-space layout of the Klondike board. Units: one card is
 * CARD_W wide and CARD_H tall. Everything is centered on the origin;
 * +Z is up out of the table plane (the camera orbits above it).
 */
export const CARD_W = 1;
export const CARD_H = 1.4;
export const CARD_GAP = 0.28;
export const ROW_GAP = 0.45;
export const OVERLAP_DOWN = 0.16; // face-down cards in a tableau pile
export const OVERLAP_UP = 0.34; // face-up cards in a tableau pile
export const LAYER_Z = 0.004; // spacing between stacked cards
export const DRAG_Z = 0.9; // height at which dragged cards hover
export const WASTE_SPREAD = 0.27; // horizontal fan of the last waste cards

const COLUMN_STEP = CARD_W + CARD_GAP;
const COLUMN_X = (col: number) => (col - 3) * COLUMN_STEP;

/** Board content bounds (before margins), needed for camera fitting. */
export const BOARD_W = 7 * CARD_W + 6 * CARD_GAP;
export const BOARD_MARGIN = 0.35;

const TOP_ROW_Y = 2.62; // center y of stock/waste/foundation row
const TABLEAU_TOP_Y = TOP_ROW_Y - (CARD_H / 2 + ROW_GAP + CARD_H / 2);

/**
 * Deterministic hash in [-1, 1] for per-slot jitter. Stacks get a tiny
 * random-looking offset so cards never sit pixel-perfectly on top of each
 * other — but stable, so pose-diffing animations don't re-jitter.
 */
function stackJitter(pileIndex: number, stackIndex: number, salt: number): number {
  const seed = pileIndex * 374761393 + stackIndex * 668265263 + salt * 1274126177;
  const mixed = Math.sin(seed * 1e-7) * 43758.5453;
  return (mixed - Math.floor(mixed)) * 2 - 1;
}

// A tableau pile can hold at most 6 face-down + 13 face-up cards.
const MAX_TABLEAU_DEPTH = 6 * OVERLAP_DOWN + 12 * OVERLAP_UP;

export const BOARD_TOP = TOP_ROW_Y + CARD_H / 2;
export const BOARD_BOTTOM = TABLEAU_TOP_Y - MAX_TABLEAU_DEPTH - CARD_H / 2;
export const BOARD_H = BOARD_TOP - BOARD_BOTTOM;
export const BOARD_CENTER_Y = (BOARD_TOP + BOARD_BOTTOM) / 2;

/** Never zoom tighter than this much content height. */
const MIN_CONTENT_H = 5.5;

/**
 * Bottom edge of the actual content in play (deepest tableau card),
 * used for dynamic camera fitting: landscape views zoom in on the cards
 * instead of reserving space for the worst-case tableau depth. Clamped
 * so a shallow tableau doesn't zoom in too far.
 */
export function contentBottom(state: GameState): number {
  let bottom = TABLEAU_TOP_Y - CARD_H / 2; // empty tableau still shows its row
  for (let col = 0; col < state.tableau.length; col++) {
    const pile = state.tableau[col];
    if (pile.length === 0) continue;
    const last = cardPlacement(state, { type: "tableau", index: col }, pile.length - 1);
    bottom = Math.min(bottom, last.y - CARD_H / 2);
  }
  // Enforce a minimum content height: a shallow game still shows at
  // least MIN_CONTENT_H world units instead of zooming up close.
  return Math.min(bottom, BOARD_TOP - MIN_CONTENT_H);
}

export interface Placement {
  x: number;
  y: number;
  z: number;
}

function topRowPlacement(col: number): Placement {
  return { x: COLUMN_X(col), y: TOP_ROW_Y, z: 0.02 };
}

/** Placement of every pile's base (slot position) on the board. */
export function slotPlacement(ref: PileRef): Placement {
  switch (ref.type) {
    case "stock":
      return topRowPlacement(0);
    case "waste":
      return topRowPlacement(1);
    case "tableau":
      return { x: COLUMN_X(ref.index), y: TABLEAU_TOP_Y, z: 0.02 };
    case "foundation":
      return topRowPlacement(ref.index + 3);
  }
}

/**
 * Placement of the card at `stackIndex` within the referenced pile.
 * Tableau piles fan downward; deeper cards sit at higher z.
 */
export function cardPlacement(state: GameState, ref: PileRef, stackIndex: number): Placement {
  const base = slotPlacement(ref);
  let z = base.z + stackIndex * LAYER_Z;

  if (ref.type === "tableau") {
    const pile = state.tableau[ref.index];
    let y = base.y;
    for (let i = 0; i < stackIndex; i++) {
      y -= pile[i].faceUp ? OVERLAP_UP : OVERLAP_DOWN;
    }
    // Slight per-pile z raise keeps piles from z-fighting their slots.
    z += ref.index * 0.001;
    const jx = stackIndex === 0 ? 0 : stackJitter(ref.index, stackIndex, 1) * 0.018;
    const jy = stackIndex === 0 ? 0 : stackJitter(ref.index, stackIndex, 2) * 0.012;
    return { x: base.x + jx, y: y + jy, z };
  }
  if (ref.type === "foundation") {
    z += 0.05 + ref.index * 0.001;
    const jx = stackIndex === 0 ? 0 : stackJitter(ref.index + 10, stackIndex, 1) * 0.015;
    const jy = stackIndex === 0 ? 0 : stackJitter(ref.index + 10, stackIndex, 2) * 0.015;
    return { x: base.x + jx, y: base.y + jy, z };
  }
  if (ref.type === "waste") {
    // Fan out the visible tail of the waste (up to 3 cards).
    const showCount = Math.min(3, state.waste.length);
    const offsetIdx = stackIndex - (state.waste.length - showCount);
    const x = base.x + (offsetIdx > 0 ? offsetIdx * WASTE_SPREAD : 0);
    return { x, y: base.y, z: z + 0.03 };
  }
  return { x: base.x, y: base.y, z };
}

/** All pile refs that have a slot on the board (for empty-slot rendering). */
export function allSlots(): PileRef[] {
  const refs: PileRef[] = [{ type: "stock", index: 0 }];
  for (let i = 0; i < 4; i++) refs.push({ type: "foundation", index: i });
  for (let i = 0; i < 7; i++) refs.push({ type: "tableau", index: i });
  return refs;
}

/** Where the next card dropped onto `ref` would land. */
export function nextPlacement(state: GameState, ref: PileRef): Placement {
  if (ref.type !== "tableau") return slotPlacement(ref);
  const pile = state.tableau[ref.index];
  if (pile.length === 0) return slotPlacement(ref);
  const top = cardPlacement(state, ref, pile.length - 1);
  const overlap = pile[pile.length - 1].faceUp ? OVERLAP_UP : 0.16;
  return { x: top.x, y: top.y - overlap, z: top.z };
}
