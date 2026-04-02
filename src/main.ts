import "./style.css";
import { GameApp } from "./game/GameApp";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

appRoot.innerHTML = `
  <div class="app-shell">
    <canvas class="game-canvas" aria-label="Falling Orchestra playfield"></canvas>
    <div class="ui-root"></div>
  </div>
`;

const canvas = appRoot.querySelector<HTMLCanvasElement>(".game-canvas");
const uiRoot = appRoot.querySelector<HTMLDivElement>(".ui-root");

if (!canvas || !uiRoot) {
  throw new Error("Required app elements were not created");
}

const game = new GameApp(canvas, uiRoot);
game.start();

window.addEventListener("beforeunload", () => {
  game.dispose();
});
