import { readFileSync, existsSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface VersionInfo {
  cli: string;
  server: string;
  frontend: string;
}

/**
 * Get version information for all packages.
 * Handles both development (monorepo) and production (installed npm package) environments.
 *
 * @param baseDir - Optional base directory for testing. Defaults to __dirname.
 * @returns Version information for CLI, server, and frontend packages
 */
export function getVersionInfo(baseDir: string = __dirname): VersionInfo {
  // Determine if we're in development (monorepo) or production (installed package)
  // In dev: baseDir is server/dist/services, workspace root has server/ and cli/ and frontend/
  // In prod: baseDir is node_modules/@sudocode-ai/local-server/dist/services
  // Check for monorepo structure by looking for both server/package.json (us) and frontend/package.json
  const projectRoot = path.join(baseDir, "../../..");
  const isDev =
    existsSync(path.join(projectRoot, "server/package.json")) &&
    existsSync(path.join(projectRoot, "frontend/package.json"));

  let cliPackage, serverPackage, frontendPackage;

  if (isDev) {
    // Development: Read from monorepo structure
    // From server/dist/services -> server/dist -> server -> workspace root
    const projectRoot = path.join(baseDir, "../../..");
    const cliPackagePath = path.join(projectRoot, "cli/package.json");
    const serverPackagePath = path.join(projectRoot, "server/package.json");
    const frontendPackagePath = path.join(
      projectRoot,
      "frontend/package.json"
    );

    cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf-8"));
    serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf-8"));
    frontendPackage = JSON.parse(readFileSync(frontendPackagePath, "utf-8"));
  } else {
    // Production: Read from installed npm packages
    // From dist/services -> dist -> local-server (package root)
    const serverPackagePath = path.join(baseDir, "../../package.json");
    serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf-8"));

    // CLI package is in node_modules (sibling to local-server)
    // From dist/services -> dist -> local-server -> @sudocode-ai -> cli
    const cliPackagePath = path.join(baseDir, "../../../cli/package.json");

    if (existsSync(cliPackagePath)) {
      cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf-8"));
    } else {
      // Fallback: use server version if CLI package not found
      cliPackage = serverPackage;
    }

    // Frontend is bundled with server, use server version
    frontendPackage = serverPackage;
  }

  return {
    cli: cliPackage.version,
    server: serverPackage.version,
    frontend: frontendPackage.version,
  };
}
