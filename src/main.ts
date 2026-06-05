import "./style.css";
import "@babylonjs/core/Shaders/default.vertex.js";
import "@babylonjs/core/Shaders/default.fragment.js";
import { AppShell } from "./AppShell";
import { AuthoringApp } from "./AuthoringApp";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const params = new URLSearchParams(window.location.search);
const app =
  params.get("tool") === "authoring"
    ? new AuthoringApp(appRoot)
    : new AppShell(appRoot);

window.addEventListener("beforeunload", () => {
  app.dispose();
});
