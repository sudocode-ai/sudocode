/**
 * Utility to get the SUDOCODE directory path
 * Respects SUDOCODE_DIR environment variable for testing
 */

import * as path from "path";

export function getSudocodeDir(): string {
  return process.env.SUDOCODE_DIR || path.join(process.cwd(), ".sudocode");
}
