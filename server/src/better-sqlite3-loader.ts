/**
 * better-sqlite3 loader with bundled binaries
 * Falls back to standard better-sqlite3 if platform package not available
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export function createDatabase(
  filename: string,
  options?: Database.Options
): Database.Database {
  try {
    const platform = `${process.platform}-${process.arch}`;
    const packageName = `@sudocode-ai/better-sqlite3-${platform}`;
    const packagePath = require.resolve(packageName);
    const binaryPath = path.join(path.dirname(packagePath), "better_sqlite3.node");

    if (fs.existsSync(binaryPath)) {
      return new Database(filename, { ...options, nativeBinding: binaryPath });
    }
  } catch {
    // Platform package not installed - use standard better-sqlite3
  }

  return new Database(filename, options);
}

export type { Database };
export default createDatabase;
