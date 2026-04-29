import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), solid()],
  server: {
    port: 5173,
  },
  // wasm-pack `--target bundler` ESM build that lives at
  // js/core/wasm-web/ — handled via vite-plugin-wasm.
  optimizeDeps: {
    exclude: ["@airday/core"],
  },
});
