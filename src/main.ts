import "./style.css";
import "@babylonjs/core/Shaders/default.vertex.js";
import "@babylonjs/core/Shaders/default.fragment.js";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const params = new URLSearchParams(window.location.search);
let app: { dispose(): void } | undefined;

const boot = async (): Promise<void> => {
  if (params.get("tool") === "authoring") {
    const { AuthoringApp } = await import("./AuthoringApp");
    app = new AuthoringApp(appRoot);
    return;
  }

  const { AppShell } = await import("./AppShell");
  app = new AppShell(appRoot);
};

void boot();

window.addEventListener("beforeunload", () => {
  app?.dispose();
});
