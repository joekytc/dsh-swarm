import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "LlmWikiGraphEngine",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "engine.esm.js" : "engine.iife.js")
    },
    sourcemap: true
  }
});
