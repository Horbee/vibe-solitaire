import type { GameState } from "./types";

/**
 * Undo/redo over immutable GameState snapshots.
 * `record` is called with the state *before* a move is applied.
 */
export class History {
  private past: GameState[] = [];
  private future: GameState[] = [];

  record(before: GameState): void {
    this.past.push(before);
    this.future = [];
  }

  undo(current: GameState): GameState | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: GameState): GameState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
