#!/usr/bin/env node
/**
 * Build script for @sudocode-ai/mcp
 * Bundles and minifies the MCP server using esbuild
 */

import * as esbuild from "esbuild";
import { chmodSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Common build options for bundled outputs
const bundledOptions = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  minify: true,
  sourcemap: true,
  // Keep external dependencies external (not bundled)
  external: [
    "@modelcontextprotocol/sdk",
    "@sudocode-ai/cli",
    "@sudocode-ai/types",
    "vite",
  ],
};

async function build() {
  try {
    console.log("Building MCP server...");

    // Build the main MCP server entry point (bundled for distribution)
    await esbuild.build({
      ...bundledOptions,
      entryPoints: ["src/index.ts"],
      outfile: "dist/index.js",
    });

    // Make MCP server executable (shebang is already in source file)
    const mcpPath = join(__dirname, "dist/index.js");
    chmodSync(mcpPath, 0o755);

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
    console.log("  - MCP server: dist/index.js (bundled & minified)");
    console.log("  - Type definitions: dist/**/*.d.ts");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
