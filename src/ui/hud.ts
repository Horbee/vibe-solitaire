import type { GameController } from "../controller";
import { CLASSIC_SCAN_NODES } from "../game/difficulty";
import type { Difficulty } from "../game/difficulty";
import type { StatsStore } from "./statsStore";
import type { SoundEngine } from "../audio/index";

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  classic: "Classic",
  hard: "Hard",
};
const DIFFICULTY_ORDER: Difficulty[] = ["easy", "classic", "hard"];

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Modal {
  root: HTMLDivElement;
  close: () => void;
}

function makeModal(title: string): Modal {
  const root = el("div", "modal-overlay");
  root.hidden = true;
  const box = el("div", "modal");
  box.append(el("h2", "", title));
  root.append(box);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  const close = () => {
    root.hidden = true;
  };
  document.getElementById("app")!.append(root);
  return { root, close };
}

/** DOM overlay: stat readouts, action buttons, hint toast, modals. */
export class HUD {
  private scoreEl: HTMLElement;
  private timeEl: HTMLElement;
  private movesEl: HTMLElement;
  private solverEl: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private hintBtn: HTMLButtonElement;
  private difficultyBtn: HTMLButtonElement;
  private drawBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private toastEl: HTMLDivElement;
  private winModal: Modal;
  private statsModal: Modal;
  private toastTimer: number | undefined;
  private winShownForSeed: number | null = null;
  private readonly controller: GameController;
  private readonly stats: StatsStore;
  private readonly sounds?: SoundEngine;

  constructor(controller: GameController, stats: StatsStore, sounds?: SoundEngine) {
    this.controller = controller;
    this.stats = stats;
    this.sounds = sounds;
    const hud = document.getElementById("hud")!;

    this.scoreEl = el("strong", "", "0");
    this.timeEl = el("strong", "", "0:00");
    this.movesEl = el("strong", "", "0");
    this.solverEl = el("strong", "", "—");
    const statsBar = el("div", "stats");
    statsBar.append(
      this.stat("Score", this.scoreEl),
      this.stat("Time", this.timeEl),
      this.stat("Moves", this.movesEl),
      this.stat("Solver", this.solverEl),
    );

    const newBtn = this.button("New", () => this.onNewGame());
    this.drawBtn = this.button("", () => this.onToggleDrawMode());
    this.difficultyBtn = this.button("", () => this.onToggleDifficulty());
    this.undoBtn = this.button("Undo", () => controller.undo());
    this.redoBtn = this.button("Redo", () => controller.redo());
    this.hintBtn = this.button("Hint", () => this.onHint());
    const statsBtn = this.button("Stats", () => this.showStats());
    this.soundBtn = this.button("", () => this.onToggleSound());
    this.soundBtn.hidden = !sounds;
    this.soundBtn.title = "Toggle sound";

    const actions = el("div", "actions");
    const restartBtn = this.button("Restart", () => this.onRestart());
    restartBtn.title = "Replay this exact deal from the start";
    actions.append(
      newBtn,
      restartBtn,
      this.drawBtn,
      this.difficultyBtn,
      this.undoBtn,
      this.redoBtn,
      this.hintBtn,
      statsBtn,
      this.soundBtn,
    );

    hud.append(statsBar, el("div", "spacer"), actions);

    this.toastEl = el("div", "toast");
    this.toastEl.hidden = true;
    document.getElementById("app")!.append(this.toastEl);

    this.winModal = makeModal("You won! 🎉");
    this.statsModal = makeModal("Statistics");

    controller.onChange(() => this.update());
    controller.onMessage((text) => this.toast(text));
    window.addEventListener("keydown", (e) => this.onKeydown(e));
    setInterval(() => this.updateTime(), 500);
    this.update();
  }

  // ------------------------------------------------------------------ DOM

  private stat(label: string, value: HTMLElement): HTMLElement {
    const span = el("span", "stat");
    span.append(document.createTextNode(`${label} `), value);
    return span;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = el("button", "", label);
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ---------------------------------------------------------------- update

  private update(): void {
    const { controller } = this;
    const { state } = controller;
    this.scoreEl.textContent = String(state.score);
    this.movesEl.textContent = String(state.moves);
    const { dealGrade } = controller;
    this.solverEl.textContent =
      dealGrade.status === "solved" ? String(dealGrade.nodes) : `>${CLASSIC_SCAN_NODES}`;
    this.solverEl.title =
      dealGrade.status === "solved"
        ? `Debug: the solver proved this deal winnable in ${dealGrade.nodes} search nodes`
        : `Debug: no win found within ${CLASSIC_SCAN_NODES} nodes (unknown, not proven unwinnable)`;
    this.updateTime();

    this.undoBtn.disabled = !controller.history.canUndo || controller.busy;
    this.redoBtn.disabled = !controller.history.canRedo || controller.busy;
    this.hintBtn.disabled = state.status !== "playing" || controller.busy;
    this.drawBtn.textContent = `Draw ${controller.drawMode === 1 ? 1 : 3}`;
    this.difficultyBtn.textContent = DIFFICULTY_LABEL[controller.difficulty];
    this.soundBtn.textContent = this.sounds?.muted === true ? "🔇" : "🔊";

    if (state.status === "won") this.showWin();
  }

  private updateTime(): void {
    this.timeEl.textContent = formatTime(this.controller.elapsedSec());
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const modalOpen = !this.winModal.root.hidden || !this.statsModal.root.hidden;

    // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (!modalOpen) {
        if (e.shiftKey) this.controller.redo();
        else this.controller.undo();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      if (!modalOpen) this.controller.redo();
      return;
    }

    switch (e.key.toLowerCase()) {
      case "escape":
        this.winModal.close();
        this.statsModal.close();
        break;
      case "n":
        if (!modalOpen) this.onNewGame();
        break;
      case "u":
        if (!modalOpen) this.controller.undo();
        break;
      case "r":
      case "y":
        if (!modalOpen) this.controller.redo();
        break;
      case "h":
        if (!modalOpen) this.onHint();
        break;
    }
  }

  // --------------------------------------------------------------- actions

  private onNewGame(): void {
    const { controller } = this;
    const inProgress = controller.state.moves > 0 && controller.state.status === "playing";
    if (inProgress && !window.confirm("Abandon this game and start a new one?")) {
      return;
    }
    this.winModal.close();
    this.winShownForSeed = null;
    controller.newGame();
  }

  private onRestart(): void {
    const { controller } = this;
    const inProgress = controller.state.moves > 0 && controller.state.status === "playing";
    if (inProgress && !window.confirm("Restart this deal? (current game will end)")) {
      return;
    }
    this.winModal.close();
    this.winShownForSeed = null;
    controller.restart();
  }

  private onToggleDrawMode(): void {
    const { controller } = this;
    const next = controller.drawMode === 1 ? 3 : 1;
    if (
      controller.state.moves > 0 &&
      controller.state.status === "playing" &&
      !window.confirm(`Start a new Draw ${next} game? (current game will end)`)
    ) {
      return;
    }
    this.winModal.close();
    this.winShownForSeed = null;
    controller.newGame(next);
  }

  private onToggleDifficulty(): void {
    const { controller } = this;
    const current = DIFFICULTY_ORDER.indexOf(controller.difficulty);
    const next = DIFFICULTY_ORDER[(current + 1) % DIFFICULTY_ORDER.length];
    const hint =
      next === "easy"
        ? " (solver-verified winnable)"
        : next === "classic"
          ? " (winnable, but harder)"
          : " (random deal)";
    if (
      controller.state.moves > 0 &&
      controller.state.status === "playing" &&
      !window.confirm(`Start a new ${DIFFICULTY_LABEL[next]} game${hint}? (current game will end)`)
    ) {
      return;
    }
    this.winModal.close();
    this.winShownForSeed = null;
    controller.newGame(controller.drawMode, next);
  }

  private onToggleSound(): void {
    if (!this.sounds) return;
    this.sounds.setMuted(!this.sounds.muted);
    this.update();
  }

  private onHint(): void {
    const hint = this.controller.showHint();
    this.toast(hint ? hint.reason : "No moves available");
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, 2600);
  }

  // ---------------------------------------------------------------- modals

  private showWin(): void {
    const { state } = this.controller;
    if (this.winShownForSeed === state.seed) return;
    this.winShownForSeed = state.seed;

    const box = this.winModal.root.querySelector(".modal")!;
    box.querySelectorAll(".modal-body").forEach((n) => n.remove());
    const body = el("div", "modal-body");
    body.append(
      el(
        "p",
        "",
        `Score: ${state.score} · Moves: ${state.moves} · Time: ${formatTime(this.controller.elapsedSec())}`,
      ),
    );
    const actions = el("div", "modal-actions");
    const again = this.button("New Game", () => {
      this.winModal.close();
      this.winShownForSeed = null;
      this.controller.newGame();
    });
    const close = this.button("Admire board", () => this.winModal.close());
    actions.append(again, close);
    body.append(actions);
    box.append(body);
    this.winModal.root.hidden = false;
  }

  private showStats(): void {
    const box = this.statsModal.root.querySelector(".modal")!;
    box.querySelectorAll(".modal-body").forEach((n) => n.remove());
    const body = el("div", "modal-body");

    const all = this.stats.all();
    const table = el("table", "stats-table") as HTMLTableElement;
    table.innerHTML = `
      <thead><tr>
        <th></th><th>Draw 1</th><th>Draw 3</th>
      </tr></thead>
      <tbody>
        <tr><td>Played</td><td>${all["1"].played}</td><td>${all["3"].played}</td></tr>
        <tr><td>Won</td><td>${all["1"].won}</td><td>${all["3"].won}</td></tr>
        <tr><td>Win %</td><td>${winPct(all["1"].played, all["1"].won)}</td><td>${winPct(all["3"].played, all["3"].won)}</td></tr>
        <tr><td>Current streak</td><td>${all["1"].currentStreak}</td><td>${all["3"].currentStreak}</td></tr>
        <tr><td>Best streak</td><td>${all["1"].bestStreak}</td><td>${all["3"].bestStreak}</td></tr>
        <tr><td>Best score</td><td>${all["1"].bestScore ?? "—"}</td><td>${all["3"].bestScore ?? "—"}</td></tr>
        <tr><td>Best time</td><td>${all["1"].bestTimeSec !== null ? formatTime(all["1"].bestTimeSec) : "—"}</td><td>${all["3"].bestTimeSec !== null ? formatTime(all["3"].bestTimeSec) : "—"}</td></tr>
      </tbody>`;
    body.append(table);

    const actions = el("div", "modal-actions");
    const reset = this.button("Reset", () => {
      if (window.confirm("Reset all statistics?")) {
        this.stats.reset();
        this.showStats();
      }
    });
    const close = this.button("Close", () => this.statsModal.close());
    actions.append(reset, close);
    body.append(actions);
    box.append(body);
    this.statsModal.root.hidden = false;
  }
}

function winPct(played: number, won: number): string {
  return played === 0 ? "—" : `${Math.round((won / played) * 100)}%`;
}
