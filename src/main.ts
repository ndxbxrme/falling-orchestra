import "./style.css";
import "@babylonjs/core/Shaders/default.vertex.js";
import "@babylonjs/core/Shaders/default.fragment.js";
import { AppShell } from "./AppShell";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const app = new AppShell(appRoot);

window.addEventListener("beforeunload", () => {
  app.dispose();
});
