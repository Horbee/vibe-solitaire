import { GameController } from "./controller";
import { registerPwa } from "./pwa";
import { createSoundEngine } from "./audio/index";
import { createGameRenderer } from "./render/index";
import { InputHandler } from "./render/input";
import { HUD } from "./ui/hud";
import { StatsStore } from "./ui/statsStore";
import "./style.css";

async function main(): Promise<void> {
  registerPwa();
  const app = document.querySelector<HTMLDivElement>("#app")!;

  const hud = document.createElement("div");
  hud.id = "hud";
  const board = document.createElement("div");
  board.id = "board";
  app.append(hud, board);

  const sounds = createSoundEngine();
  // Browsers block audio until a user gesture; unlock on any pointerdown
  // (idempotent — also re-unlocks after the tab was suspended).
  document.addEventListener("pointerdown", () => sounds.resume(), { capture: true });

  const renderer = await createGameRenderer(board, sounds);
  const stats = new StatsStore();
  const controller = new GameController(renderer, stats, 1, sounds);
  new HUD(controller, stats, sounds);
  new InputHandler(controller, renderer, sounds);
  renderer.start();
}

void main();
