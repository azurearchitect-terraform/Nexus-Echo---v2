import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nexus/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@nexus/ai": path.resolve(__dirname, "../../packages/ai/src/index.ts"),
      "@nexus/rag": path.resolve(__dirname, "../../packages/rag/src/index.ts"),
      "@nexus/plugin-sdk": path.resolve(__dirname, "../../packages/plugin-sdk/src/index.ts"),
      "@nexus/plugin-meeting-intelligence": path.resolve(__dirname, "../../plugins/meeting-intelligence/src/index.ts"),
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env["TAURI_ENV_PLATFORM"] === "windows" ? "chrome105" : "safari13",
    minify: !process.env["TAURI_ENV_DEBUG"] ? "esbuild" : false,
    sourcemap: !!process.env["TAURI_ENV_DEBUG"],
  },
});
