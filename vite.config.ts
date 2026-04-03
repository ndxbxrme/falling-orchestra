import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  build: {
    chunkSizeWarningLimit: 1400,
  },
}));
