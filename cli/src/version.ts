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
  // In compiled binaries (SEA/Bun), import.meta.url resolves to a virtual path.
  // Fall back to reading package.json relative to the executable.
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(path.dirname(process.execPath), "..", "package.json"),
    path.join(path.dirname(process.execPath), "package.json"),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8")).version;
    } catch {
      continue;
    }
  }
  return "0.0.0-unknown";
}

/**
 * The current CLI version
 */
export const VERSION = getVersion();
