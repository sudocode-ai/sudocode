/**
 * ID generation utilities
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type Database from "better-sqlite3";
import type { Config } from "@sudocode-ai/types";
import { VERSION } from "./version.js";

/**
 * Generate next spec ID based on database contents
 */
export function generateSpecId(
  db: Database.Database,
  outputDir: string
): string {
  const config = readConfig(outputDir);
  const nextNumber = getNextSpecNumber(db);

  return `${config.id_prefix.spec}-${String(nextNumber).padStart(3, "0")}`;
}

/**
 * Generate next issue ID based on database contents
 */
export function generateIssueId(
  db: Database.Database,
  outputDir: string
): string {
  const config = readConfig(outputDir);
  const nextNumber = getNextIssueNumber(db);

  return `${config.id_prefix.issue}-${String(nextNumber).padStart(3, "0")}`;
}

/**
 * Get next spec number from database
 * Strategy:
 * 1. Find the latest spec by created_at
 * 2. Extract number from its ID
 * 3. Increment by 1
 * 4. Fallback to count + 1 if extraction fails
 */
function getNextSpecNumber(db: Database.Database): number {
  const stmt = db.prepare(`
    SELECT id FROM specs
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const latest = stmt.get() as { id: string } | undefined;

  if (latest) {
    const match = latest.id.match(/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10) + 1;
    }
  }

  // Fallback: count + 1
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM specs`);
  const result = countStmt.get() as { count: number };
  return result.count + 1;
}

/**
 * Get next issue number from database
 * Strategy:
 * 1. Find the latest issue by created_at
 * 2. Extract number from its ID
 * 3. Increment by 1
 * 4. Fallback to count + 1 if extraction fails
 */
function getNextIssueNumber(db: Database.Database): number {
  const stmt = db.prepare(`
    SELECT id FROM issues
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const latest = stmt.get() as { id: string } | undefined;

  if (latest) {
    const match = latest.id.match(/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10) + 1;
    }
  }

  // Fallback: count + 1
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM issues`);
  const result = countStmt.get() as { count: number };
  return result.count + 1;
}

/**
 * Read config file (version-controlled)
 */
function readConfig(outputDir: string): Config {
  const configPath = path.join(outputDir, "config.json");

  if (!fs.existsSync(configPath)) {
    // Create default config if not exists
    const defaultConfig: Config = {
      version: VERSION,
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    writeConfig(outputDir, defaultConfig);
    return defaultConfig;
  }

  const content = fs.readFileSync(configPath, "utf8");
  return JSON.parse(content) as Config;
}

/**
 * Write config file (version-controlled)
 */
function writeConfig(outputDir: string, config: Config): void {
  const configPath = path.join(outputDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Get current config
 */
export function getConfig(outputDir: string): Config {
  return readConfig(outputDir);
}

/**
 * Update config (version-controlled)
 */
export function updateConfig(
  outputDir: string,
  updates: Partial<Config>
): void {
  const config = readConfig(outputDir);
  Object.assign(config, updates);
  writeConfig(outputDir, config);
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
