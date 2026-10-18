import { applyMove } from "./game/moves";
import { canPlaceOnFoundation, getPile, isLegalMove } from "./game/rules";
import { deal } from "./game/deck";
import { History } from "./game/history";
import { hint as findHint } from "./game/hint";
import type { Hint } from "./game/hint";
import { autoSolve } from "./game/solve";
import type { DrawMode, GameState, Move, PileRef } from "./game/types";
import { foundationRef, FOUNDATION_COUNT, tableauRef, TABLEAU_COUNT } from "./game/types";
import { cardPlacement, nextPlacement, slotPlacement } from "./render/layout";
import type { Placement } from "./render/layout";
import type { GameRenderer } from "./render/index";
import type { StatsStore } from "./ui/statsStore";

export interface CardLocation {
  ref: PileRef;
  /** Index of the card within its pile. */
  index: number;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

type ChangeListener = () => void;

const SOLVE_STEP_MS = 300;

/**
 * Orchestrates the pure engine, the renderer, the HUD, and stats.
 * Owns the current GameState, undo/redo history, the game timer,
 * and the auto-solver.
 */
export class GameController {
  state: GameState;
  readonly history = new History();
  drawMode: DrawMode;
  solving = false;

  private readonly renderer: GameRenderer;
  private readonly stats: StatsStore;
  private readonly listeners = new Set<ChangeListener>();
  private startedAt = Date.now();
  private gameRecorded = false;
  private solveToken = 0;

  constructor(renderer: GameRenderer, stats: StatsStore, drawMode: DrawMode = 1) {
    this.renderer = renderer;
    this.stats = stats;
    this.drawMode = drawMode;
    this.state = deal(randomSeed(), drawMode);
    void this.renderer.animateDeal(this.state);
  }

  // ------------------------------------------------------------- lifecycle

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get busy(): boolean {
    return this.solving;
  }

  elapsedSec(): number {
    return Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
  }

  newGame(drawMode: DrawMode = this.drawMode): void {
    this.finishAbandonedGame();
    this.drawMode = drawMode;
    this.state = deal(randomSeed(), drawMode);
    this.history.clear();
    this.startedAt = Date.now();
    this.gameRecorded = false;
    this.solveToken++; // cancels any running solver
    this.solving = false;
    void this.renderer.animateDeal(this.state);
    this.emit();
  }

  // ----------------------------------------------------------------- moves

  /** Apply an engine move; returns false when illegal. Use the gated helpers
   * (tryMove/drawStock/undo/redo) from input paths while the solver runs. */
  apply(move: Move): boolean {
    const prev = this.state;
    const next = applyMove(prev, move);
    if (!next) return false;
    this.history.record(prev);
    this.state = next;
    void this.renderer.animateStateChange(prev, next);
    this.checkGameEnd();
    this.emit();
    return true;
  }

  undo(): boolean {
    if (this.solving) return false;
    const previous = this.history.undo(this.state);
    if (!previous) return false;
    const cur = this.state;
    this.state = previous;
    void this.renderer.animateStateChange(cur, previous);
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.solving) return false;
    const next = this.history.redo(this.state);
    if (!next) return false;
    const cur = this.state;
    this.state = next;
    void this.renderer.animateStateChange(cur, next);
    this.emit();
    return true;
  }

  tryMove(from: PileRef, to: PileRef, count: number): boolean {
    if (this.solving) return false;
    return this.apply({ kind: "move", from, to, count });
  }

  /** Draw from the stock (recycles the waste when the stock is empty). */
  drawStock(): boolean {
    if (this.solving) return false;
    return this.apply({ kind: "draw" });
  }

  /** Double-click helper: send a single card to its foundation if legal. */
  autoToFoundation(from: PileRef): boolean {
    if (this.solving) return false;
    const pile = getPile(this.state, from);
    if (pile.length === 0) return false;
    const card = pile[pile.length - 1];
    for (let f = 0; f < FOUNDATION_COUNT; f++) {
      if (canPlaceOnFoundation(card, this.state.foundations[f])) {
        return this.tryMove(from, foundationRef(f), 1);
      }
    }
    return false;
  }

  /** Force a visual resync (used after cancelled drags). */
  refresh(): void {
    this.renderer.syncState(this.state);
  }

  // ------------------------------------------------------------------ hint

  /** Flash the best suggested move; returns it (with reason) or null. */
  showHint(): Hint | null {
    if (this.solving || this.state.status !== "playing") return null;
    const h = findHint(this.state);
    if (!h) return null;
    this.renderer.flashHighlights(this.placementsForMove(h.move));
    return h;
  }

  private placementsForMove(move: Move): Placement[] {
    if (move.kind === "draw") {
      return [slotPlacement({ type: "stock", index: 0 })];
    }
    const pile = getPile(this.state, move.from);
    const idx = pile.length - move.count;
    return [
      cardPlacement(this.state, move.from, Math.max(0, idx)),
      nextPlacement(this.state, move.to),
    ];
  }

  // ----------------------------------------------------------------- solve

  /** Auto-play the game with the greedy engine strategy, animated. */
  async solve(): Promise<void> {
    if (this.solving || this.state.status !== "playing") return;
    this.solving = true;
    const token = ++this.solveToken;
    this.emit();
    try {
      const outcome = autoSolve(this.state);
      for (const move of outcome.moves) {
        if (token !== this.solveToken || this.state.status !== "playing") break;
        if (!this.apply(move)) break;
        await new Promise((r) => setTimeout(r, SOLVE_STEP_MS));
      }
    } finally {
      if (token === this.solveToken) {
        this.solving = false;
        this.emit();
      }
    }
  }

  // ------------------------------------------------------------ lookup API

  locateCard(cardId: string): CardLocation | null {
    const piles: { ref: PileRef; cards: { id: string }[] }[] = [
      { ref: { type: "stock", index: 0 }, cards: this.state.stock },
      { ref: { type: "waste", index: 0 }, cards: this.state.waste },
      ...this.state.tableau.map((cards, index) => ({
        ref: tableauRef(index),
        cards,
      })),
      ...this.state.foundations.map((cards, index) => ({
        ref: foundationRef(index),
        cards,
      })),
    ];
    for (const { ref, cards } of piles) {
      const index = cards.findIndex((c) => c.id === cardId);
      if (index >= 0) return { ref, index };
    }
    return null;
  }

  legalDropTargets(from: PileRef, count: number): PileRef[] {
    const targets: PileRef[] = [];
    for (let i = 0; i < FOUNDATION_COUNT; i++) {
      const to = foundationRef(i);
      if (isLegalMove(this.state, { kind: "move", from, to, count })) {
        targets.push(to);
      }
    }
    for (let i = 0; i < TABLEAU_COUNT; i++) {
      const to = tableauRef(i);
      if (isLegalMove(this.state, { kind: "move", from, to, count })) {
        targets.push(to);
      }
    }
    return targets;
  }

  // ----------------------------------------------------------------- stats

  private checkGameEnd(): void {
    if (this.state.status !== "won" || this.gameRecorded) return;
    this.gameRecorded = true;
    this.stats.record(this.drawMode, {
      won: true,
      seconds: this.elapsedSec(),
      score: this.state.score,
      moves: this.state.moves,
      seed: this.state.seed,
    });
  }

  private finishAbandonedGame(): void {
    if (this.gameRecorded || this.state.moves === 0) return;
    this.stats.record(this.drawMode, {
      won: false,
      seconds: this.elapsedSec(),
      score: this.state.score,
      moves: this.state.moves,
      seed: this.state.seed,
    });
  }
}
