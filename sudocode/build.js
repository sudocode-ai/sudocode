#!/usr/bin/env node
/**
 * Build script for sudocode meta-package
 * Copies all workspace packages into node_modules for bundleDependencies
 */

import { cpSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function build() {
  try {
    console.log("Building sudocode meta-package...");

    // Clean node_modules if it exists
    const nodeModulesDir = join(__dirname, "node_modules");
    if (existsSync(nodeModulesDir)) {
      console.log("  - Cleaning existing node_modules...");
      rmSync(nodeModulesDir, { recursive: true, force: true });
    }

    // Create node_modules/@sudocode-ai directory
    const scopeDir = join(nodeModulesDir, "@sudocode-ai");
    mkdirSync(scopeDir, { recursive: true });

    // List of packages to bundle
    const packages = [
      { name: "types", dir: "types" },
      { name: "cli", dir: "cli" },
      { name: "mcp", dir: "mcp" },
      { name: "local-server", dir: "server" },
    ];

    // Pack each package and extract to node_modules
    for (const pkg of packages) {
      const pkgDir = join(rootDir, pkg.dir);
      const targetDir = join(scopeDir, pkg.name);

      console.log(`  - Bundling @sudocode-ai/${pkg.name}...`);

      // Pack the package to a temporary location
      const tempDir = join(__dirname, ".temp");
      mkdirSync(tempDir, { recursive: true });

      // npm pack returns just the filename on stdout
      const tarballName = execSync("npm pack", {
        cwd: pkgDir,
        encoding: "utf-8",
      }).trim();

      const tarballPath = join(pkgDir, tarballName);
      const tempTarballPath = join(tempDir, tarballName);

      // Move tarball to temp location
      cpSync(tarballPath, tempTarballPath);
      rmSync(tarballPath);

      // Extract tarball to target directory
      mkdirSync(targetDir, { recursive: true });
      execSync(`tar -xzf "${tempTarballPath}" -C "${targetDir}" --strip-components=1`);

      // Clean up temp tarball
      rmSync(tempTarballPath);

      console.log(`    ✓ Bundled to node_modules/@sudocode-ai/${pkg.name}`);
    }

    // Clean up temp directory
    const tempDir = join(__dirname, ".temp");
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    console.log("✓ Build complete!");
    console.log("  Meta-package ready with all dependencies bundled");
    console.log("");
    console.log("  To pack: npm pack");
    console.log("  To publish: npm publish");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
