#!/usr/bin/env node
/**
 * Sync dependencies script for sudocode meta-package
 * Automatically collects all dependencies from bundled packages
 * and updates the meta-package's package.json
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Packages that will be bundled in the meta-package
const BUNDLED_PACKAGES = [
  { name: "@sudocode-ai/types", dir: "types" },
  { name: "@sudocode-ai/cli", dir: "cli" },
  { name: "@sudocode-ai/mcp", dir: "mcp" },
  { name: "@sudocode-ai/local-server", dir: "server" },
];

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writePackageJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

const QUIET = process.argv.includes("--quiet");

if (!QUIET) {
  console.log("Syncing meta-package dependencies...");
  console.log("");
}

// Collect all dependencies from bundled packages
const allDependencies = {};

for (const pkg of BUNDLED_PACKAGES) {
  const pkgPath = join(rootDir, pkg.dir, "package.json");
  const pkgJson = readPackageJson(pkgPath);

  if (!QUIET) {
    console.log(`Collecting from ${pkg.name}...`);
  }

  if (pkgJson.dependencies) {
    for (const [name, version] of Object.entries(pkgJson.dependencies)) {
      // Skip circular references to other bundled packages
      if (BUNDLED_PACKAGES.some((p) => p.name === name)) {
        continue;
      }

      // If we've seen this dependency before, use the higher version
      if (allDependencies[name]) {
        // Simple version comparison (may need semver for complex cases)
        if (version !== allDependencies[name]) {
          console.log(
            `  ⚠ Version conflict for ${name}: ${allDependencies[name]} vs ${version}`
          );
          // Keep the higher version (simplistic comparison)
          if (version > allDependencies[name]) {
            allDependencies[name] = version;
          }
        }
      } else {
        allDependencies[name] = version;
      }
    }
  }
}

// Add the bundled packages themselves
for (const pkg of BUNDLED_PACKAGES) {
  const pkgPath = join(rootDir, pkg.dir, "package.json");
  const pkgJson = readPackageJson(pkgPath);
  allDependencies[pkg.name] = `^${pkgJson.version}`;
}

if (!QUIET) {
  console.log("");
  console.log(
    `Total dependencies collected: ${Object.keys(allDependencies).length}`
  );
  console.log("");
}

// Read meta-package package.json
const metaPackagePath = join(rootDir, "sudocode", "package.json");
const metaPackageJson = readPackageJson(metaPackagePath);

// Update dependencies
metaPackageJson.dependencies = BUNDLED_PACKAGES.map((p) => p.name).sort();

// Write back to file
writePackageJson(metaPackagePath, metaPackageJson);

if (!QUIET) {
  console.log("✓ Meta-package dependencies updated!");
  console.log("");
  console.log("Dependencies:");
  for (const [name, version] of Object.entries(allDependencies).sort()) {
    console.log(`  - ${name}@${version}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. Review the changes: git diff sudocode/package.json");
  console.log("  2. Build meta-package: npm run build --workspace=sudocode");
  console.log("  3. Test locally: npm pack --workspace=sudocode");
} else {
  console.log("✓ Dependencies synced");
}
