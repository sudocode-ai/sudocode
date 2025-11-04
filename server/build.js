#!/usr/bin/env node
/**
 * Build script for @sudocode-ai/local-server
 * Bundles the server using esbuild and includes frontend static files
 */

import * as esbuild from "esbuild";
import { chmodSync, cpSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

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
    "@ag-ui/core",
    "@copilotkit/runtime",
    "@sudocode-ai/cli",
    "@sudocode-ai/types",
    "better-sqlite3",
    "cors",
    "dotenv",
    "express",
    "glob",
    "ws",
    "zod",
    "async-mutex",
  ],
};

async function build() {
  try {
    console.log("Building server...");

    // Build the main server entry point (bundled for distribution)
    console.log("  - Bundling server code with esbuild...");
    await esbuild.build({
      ...bundledOptions,
      entryPoints: ["src/index.ts"],
      outfile: "dist/index.js",
    });

    // Build the CLI entry point (bundled for distribution)
    await esbuild.build({
      ...bundledOptions,
      entryPoints: ["src/cli.ts"],
      outfile: "dist/cli.js",
    });

    // Make CLI executable (shebang is already in source file)
    const cliPath = join(__dirname, "dist/cli.js");
    chmodSync(cliPath, 0o755);
    console.log("  - Set executable permissions on cli.js");

    // Generate TypeScript declarations (still need tsc for this)
    console.log("  - Generating type declarations...");
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

    // Copy frontend static files
    const frontendDist = join(__dirname, "../frontend/dist");
    const serverPublic = join(__dirname, "dist/public");

    if (existsSync(frontendDist)) {
      console.log("  - Copying frontend static files...");
      cpSync(frontendDist, serverPublic, { recursive: true });
      console.log(`    ✓ Frontend copied to dist/public/`);
    } else {
      console.warn("    ⚠ Frontend dist not found. Build frontend first with:");
      console.warn("      npm run build --workspace=frontend");
    }

    console.log("✓ Build complete!");
    console.log("  - Server: dist/index.js (bundled & minified)");
    console.log("  - CLI: dist/cli.js (bundled & minified)");
    console.log("  - Frontend: dist/public/");
    console.log("  - Type definitions: dist/**/*.d.ts");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
