import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), solid()],
  server: {
    port: 5176,
    // Same-origin in dev so SameSite=Strict cookies work — the alternative
    // is HTTPS + SameSite=None and that's not worth the dev pain. `/api/*`
    // (HTTP and WS upgrades) is forwarded to the server crate's default
    // bind. Override via VITE_API_TARGET if running the server on a
    // different port.
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // wasm-pack `--target bundler` ESM build that lives at
  // js/core/wasm-web/ — handled via vite-plugin-wasm.
  optimizeDeps: {
    exclude: ["@airday/core"],
  },
});
