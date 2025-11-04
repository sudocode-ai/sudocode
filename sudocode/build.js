#!/usr/bin/env node
/**
 * Build script for sudocode meta-package
 * Copies all workspace packages into node_modules for bundleDependencies
 */

import { cpSync, mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

    // Copy each package to node_modules
    for (const pkg of packages) {
      const pkgDir = join(rootDir, pkg.dir);
      const targetDir = join(scopeDir, pkg.name);

      console.log(`  - Bundling @sudocode-ai/${pkg.name}...`);

      // Read package.json to determine what files to include
      const packageJson = JSON.parse(
        readFileSync(join(pkgDir, "package.json"), "utf-8")
      );

      // Create target directory
      mkdirSync(targetDir, { recursive: true });

      // Copy package.json and README
      cpSync(join(pkgDir, "package.json"), join(targetDir, "package.json"));
      if (existsSync(join(pkgDir, "README.md"))) {
        cpSync(join(pkgDir, "README.md"), join(targetDir, "README.md"));
      }
      if (existsSync(join(pkgDir, "LICENSE"))) {
        cpSync(join(pkgDir, "LICENSE"), join(targetDir, "LICENSE"));
      }

      // Copy files based on package.json "files" field
      const filesToInclude = packageJson.files || ["dist/**/*"];

      for (const filePattern of filesToInclude) {
        // Handle simple patterns (e.g., "dist/**/*" -> copy dist directory)
        if (filePattern.includes("**/*")) {
          const dirName = filePattern.split("/")[0];
          const srcPath = join(pkgDir, dirName);
          const destPath = join(targetDir, dirName);

          if (existsSync(srcPath)) {
            cpSync(srcPath, destPath, { recursive: true });
          }
        } else {
          // Handle direct file/directory references
          const srcPath = join(pkgDir, filePattern);
          const destPath = join(targetDir, filePattern);

          if (existsSync(srcPath)) {
            cpSync(srcPath, destPath, { recursive: true });
          }
        }
      }

      // Also copy src directory if it exists and is not in files
      if (
        existsSync(join(pkgDir, "src")) &&
        !filesToInclude.some((f) => f.includes("src"))
      ) {
        cpSync(join(pkgDir, "src"), join(targetDir, "src"), {
          recursive: true,
        });
      }

      console.log(`    ✓ Bundled to node_modules/@sudocode-ai/${pkg.name}`);
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
