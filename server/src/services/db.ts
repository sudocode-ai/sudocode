/**
 * Database service for sudocode server
 * Uses shared schema from @sudocode-ai/types
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  PROMPT_TEMPLATES_TABLE,
  PROMPT_TEMPLATES_INDEXES,
  EXECUTION_LOGS_TABLE,
  EXECUTION_LOGS_INDEXES,
  AGENT_REQUESTS_TABLE,
  AGENT_REQUESTS_INDEXES,
  AGENT_PATTERNS_TABLE,
  AGENT_PATTERNS_INDEXES,
  AGENT_PATTERN_RESPONSES_TABLE,
  AGENT_PATTERN_RESPONSES_INDEXES,
} from "@sudocode-ai/types/schema";
import { initializeDefaultTemplates } from "./prompt-templates.js";

/**
 * Database configuration
 */
export interface DatabaseConfig {
  path: string;
  readOnly?: boolean;
}

/**
 * Initialize database with CLI schema + server extensions
 */
export function initDatabase(config: DatabaseConfig): Database.Database {
  const { path: dbPath, readOnly = false } = config;

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Open database
  const db = new Database(dbPath, {
    readonly: readOnly,
    fileMustExist: false,
  });

  // Don't modify schema if read-only
  if (readOnly) {
    return db;
  }

  // Configure database
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");

  // Create server-specific tables
  db.exec(EXECUTIONS_TABLE);
  db.exec(PROMPT_TEMPLATES_TABLE);
  db.exec(EXECUTION_LOGS_TABLE);
  db.exec(AGENT_REQUESTS_TABLE);
  db.exec(AGENT_PATTERNS_TABLE);
  db.exec(AGENT_PATTERN_RESPONSES_TABLE);

  // Create indexes
  db.exec(EXECUTIONS_INDEXES);
  db.exec(PROMPT_TEMPLATES_INDEXES);
  db.exec(EXECUTION_LOGS_INDEXES);
  db.exec(AGENT_REQUESTS_INDEXES);
  db.exec(AGENT_PATTERNS_INDEXES);
  db.exec(AGENT_PATTERN_RESPONSES_INDEXES);

  // Initialize default prompt templates
  initializeDefaultTemplates(db);

  return db;
}

/**
 * Check if database has CLI tables
 */
export function hasCliTables(db: Database.Database): boolean {
  const result = db
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM sqlite_master
    WHERE type='table'
    AND name IN ('specs', 'issues', 'relationships', 'tags')
  `
    )
    .get() as { count: number };

  return result.count === 4;
}

/**
 * Get database info
 */
export function getDatabaseInfo(db: Database.Database) {
  const tables = db
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `
    )
    .all() as { name: string }[];

  const version = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };

  return {
    tables: tables.map((t) => t.name),
    version: version.user_version,
    hasCliTables: hasCliTables(db),
  };
}

/**
 * Close database connection
 */
export function closeDatabase(db: Database.Database): void {
  db.close();
}
