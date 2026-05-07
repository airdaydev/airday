 import { defineConfig } from "vite";
  import solid from "vite-plugin-solid";
  import wasm from "vite-plugin-wasm";

  export default defineConfig({
    plugins: [wasm(), solid()],
    build: {
      target: "es2022",     // explicit; TLA is es2022
    },
    server: {
      port: 5176,
      proxy: {
        "/api": {
          target: process.env.VITE_API_TARGET ?? "http://localhost:8000",
          changeOrigin: true,
          ws: true,
        },
      },
    },
    optimizeDeps: {
      exclude: ["@airday/core"],
    },
  });
