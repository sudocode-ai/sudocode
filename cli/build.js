#!/usr/bin/env node
/**
 * Build script for @sudocode-ai/cli
 * Bundles and minifies the CLI using esbuild
 */

import * as esbuild from "esbuild";
import { chmodSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Common build options
const commonOptions = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  minify: true,
  sourcemap: true,
  // Keep external dependencies external (not bundled)
  external: [
    "@sudocode-ai/types",
    "better-sqlite3",
    "chalk",
    "chokidar",
    "cli-table3",
    "commander",
    "gray-matter",
    "vite",
  ],
};

async function build() {
  try {
    console.log("Building CLI...");

    // Build the main CLI entry point
    await esbuild.build({
      ...commonOptions,
      entryPoints: ["src/cli.ts"],
      outfile: "dist/cli.js",
    });

    // Make CLI executable (shebang is already in source file)
    const cliPath = join(__dirname, "dist/cli.js");
    chmodSync(cliPath, 0o755);

    // Build the main library export (for programmatic use)
    await esbuild.build({
      ...commonOptions,
      entryPoints: ["src/index.ts"],
      outfile: "dist/index.js",
    });

    // Generate TypeScript declarations (still need tsc for this)
    console.log("Generating type declarations...");
    const { exec } = await import("child_process");
    await new Promise((resolve, reject) => {
      exec("npx tsc --emitDeclarationOnly", (error, stdout, stderr) => {
        if (error) {
          console.error(stderr);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });

    console.log("✓ Build complete!");
    console.log("  - CLI: dist/cli.js (minified)");
    console.log("  - Library: dist/index.js (minified)");
    console.log("  - Type definitions: dist/**/*.d.ts");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
