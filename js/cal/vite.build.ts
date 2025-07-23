import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  css: {
    modules: {
      // Add namespace to all generated CSS class names
      generateScopedName: "solid-tree-[name]__[local]__[hash:base64:5]",
    },
  },
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["solid-js"],
      output: {
        manualChunks(id) {
          // Optional: Customize chunk splitting
          if (id.includes("worker")) {
            return "worker";
          }
        },
      },
    },
  },
});
