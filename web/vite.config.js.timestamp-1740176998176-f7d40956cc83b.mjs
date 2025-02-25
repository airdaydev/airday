// vite.config.js
import { defineConfig } from "file:///Users/daniel/repos/airday/node_modules/.pnpm/vite@5.4.6_@types+node@20.12.7/node_modules/vite/dist/node/index.js";
import solidPlugin from "file:///Users/daniel/repos/airday/node_modules/.pnpm/vite-plugin-solid@2.10.2_solid-js@1.8.22_vite@5.4.6_@types+node@20.12.7_/node_modules/vite-plugin-solid/dist/esm/index.mjs";
import solidSvg from "file:///Users/daniel/repos/airday/node_modules/.pnpm/vite-plugin-solid-svg@0.8.1_solid-js@1.8.22_vite@5.4.6_@types+node@20.12.7_/node_modules/vite-plugin-solid-svg/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [solidPlugin(), solidSvg({
    defaultAsComponent: false,
    svgo: {
      svgoConfig: {
        enabled: false
      }
    }
  })],
  server: {
    port: 3e3
  },
  build: {
    target: "esnext"
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvZGFuaWVsL3JlcG9zL2FpcmRheS93ZWJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9kYW5pZWwvcmVwb3MvYWlyZGF5L3dlYi92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvZGFuaWVsL3JlcG9zL2FpcmRheS93ZWIvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCBzb2xpZFBsdWdpbiBmcm9tICd2aXRlLXBsdWdpbi1zb2xpZCc7XG5pbXBvcnQgc29saWRTdmcgZnJvbSAndml0ZS1wbHVnaW4tc29saWQtc3ZnJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3NvbGlkUGx1Z2luKCksIHNvbGlkU3ZnKHtcbiAgICBkZWZhdWx0QXNDb21wb25lbnQ6IGZhbHNlLFxuICAgIHN2Z286IHtcbiAgICAgIHN2Z29Db25maWc6IHtcbiAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICB9XG4gICAgfVxuICB9KV0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDMwMDAsXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgdGFyZ2V0OiAnZXNuZXh0JyxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE0USxTQUFTLG9CQUFvQjtBQUN6UyxPQUFPLGlCQUFpQjtBQUN4QixPQUFPLGNBQWM7QUFFckIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLFlBQVksR0FBRyxTQUFTO0FBQUEsSUFDaEMsb0JBQW9CO0FBQUEsSUFDcEIsTUFBTTtBQUFBLE1BQ0osWUFBWTtBQUFBLFFBQ1YsU0FBUztBQUFBLE1BQ1g7QUFBQSxJQUNGO0FBQUEsRUFDRixDQUFDLENBQUM7QUFBQSxFQUNGLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsRUFDVjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
