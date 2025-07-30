#!/usr/bin/env bun
import dts from "bun-plugin-dts";

// Bundle configuration for Tracer frontend distribution
// Run with: bun run bundle.ts

import { $ } from "bun";
import { statSync } from "fs";
import pkg from "./package.json";

const bundleConfig: Bun.BuildConfig = {
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
  splitting: false,
  plugins: [dts({})],
  external: ["@airday/tracer"],
};

// Bundle for different environments
async function bundle() {
  console.log("🚀 Building Tracer for frontend...");

  // 1. ESM Bundle (modern browsers)
  console.log("📦 Building ESM bundle...");
  const esmResult = await Bun.build({
    ...bundleConfig,
    naming: "index.esm.js",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  if (!esmResult.success) {
    console.error("❌ ESM build failed:", esmResult.logs);
    process.exit(1);
  }

  // Generate package.json for distribution
  const packageJson = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: "index.esm.js",
    module: "index.esm.js",
    types: "index.d.ts",
    files: ["*.js", "*.d.ts", "*.map"],
    exports: {
      ".": {
        import: "./index.esm.js",
        types: "./index.d.ts",
      },
    },
    keywords: ["json", "tracing", "observability", "lightweight"],
    author: pkg.author,
    license: pkg.license,
  };

  await Bun.write("dist/package.json", JSON.stringify(packageJson, null, 2));

  // Report bundle sizes
  console.log("✅ All bundles created successfully!");
  console.log("\nBundle outputs:");

  try {
    const esmStats = statSync("dist/index.esm.js");
    const esmSize = (esmStats.size / 1024).toFixed(2);
    console.log(`- index.esm.js (${esmSize} KB)`);

    const mapStats = statSync("dist/index.esm.js.map");
    const mapSize = (mapStats.size / 1024).toFixed(2);
    console.log(`- index.esm.js.map (${mapSize} KB)`);
  } catch (error) {
    console.log("- index.esm.js (size unknown)");
    console.log("- index.esm.js.map (size unknown)");
  }

  console.log("- package.json (Distribution metadata)");

  // Test bundles
  console.log("\n🧪 Testing bundles...");
  // try {
  //   // Test ESM import
  //   const { Core } = await import("./dist/index.esm.js");
  //   const tracer = new Tracer("airday_tracer_tests");
  //   const span = tracer.startSpan("test-span");
  //   tracer.endSpan(span);
  //   console.log("✅ ESM bundle test passed");
  //   await tracer.shutdown();
  // } catch (error) {
  //   console.error("❌ Bundle test failed:", error);
  // }
}

// Run the bundler
await bundle();
