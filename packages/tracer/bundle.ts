#!/usr/bin/env bun

// Bundle configuration for Tracer frontend distribution
// Run with: bun run bundle.ts

import { $ } from "bun";
import { statSync } from "fs";

const bundleConfig: Bun.BuildConfig = {
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
  splitting: false,
  external: [], // Bundle everything for ultra-light JSON tracer
};

// Bundle for different environments
async function bundle() {
  console.log("🚀 Building Tracer for frontend...");

  // 1. ESM Bundle (modern browsers)
  console.log("📦 Building ESM bundle...");
  const esmResult = await Bun.build({
    ...bundleConfig,
    naming: "tracer.esm.js",
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
    name: "tracer",
    version: "1.0.0",
    description: "Ultra-light JSON-based tracer",
    main: "tracer.cjs.js",
    module: "tracer.esm.js",
    types: "index.d.ts",
    files: ["*.js", "*.d.ts", "*.map"],
    exports: {
      ".": {
        import: "./tracer.esm.js",
        types: "./index.d.ts",
      },
    },
    keywords: ["json", "tracing", "observability", "lightweight"],
    author: "Airday",
    license: "MIT",
  };

  await Bun.write("dist/package.json", JSON.stringify(packageJson, null, 2));

  // Report bundle sizes
  console.log("✅ All bundles created successfully!");
  console.log("\nBundle outputs:");

  try {
    const esmStats = statSync("dist/tracer.esm.js");
    const esmSize = (esmStats.size / 1024).toFixed(2);
    console.log(`- tracer.esm.js (${esmSize} KB)`);

    const mapStats = statSync("dist/tracer.esm.js.map");
    const mapSize = (mapStats.size / 1024).toFixed(2);
    console.log(`- tracer.esm.js.map (${mapSize} KB)`);
  } catch (error) {
    console.log("- tracer.esm.js (size unknown)");
    console.log("- tracer.esm.js.map (size unknown)");
  }

  console.log("- package.json (Distribution metadata)");

  // Test bundles
  console.log("\n🧪 Testing bundles...");
  try {
    // Test ESM import
    const { Tracer } = await import("./dist/tracer.esm.js");
    const tracer = new Tracer("test-service");
    const span = tracer.startSpan("test-span");
    tracer.endSpan(span);
    console.log("✅ ESM bundle test passed");
  } catch (error) {
    console.error("❌ Bundle test failed:", error);
  }
}

// Run the bundler
await bundle();
