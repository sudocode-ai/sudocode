/**
 * Version utilities
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the CLI version from package.json
 */
export function getVersion(): string {
  // In development (running from src/), go up one level
  // In production (running from dist/), go up one level
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson.version;
}

/**
 * The current CLI version
 */
export const VERSION = getVersion();
