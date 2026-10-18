import { GameController } from "./controller";
import { registerPwa } from "./pwa";
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

  const renderer = await createGameRenderer(board);
  const stats = new StatsStore();
  const controller = new GameController(renderer, stats, 1);
  new HUD(controller, stats);
  new InputHandler(controller, renderer);
  renderer.start();
}

void main();
