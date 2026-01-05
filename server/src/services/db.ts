/**
 * Database service for sudocode server
 * Uses shared schema from @sudocode-ai/types
 */

import type Database from "better-sqlite3";
import createDatabase from "../better-sqlite3-loader.js";
import * as path from "path";
import * as fs from "fs";
import * as schema from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";
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
  const db = createDatabase(dbPath, {
    readonly: readOnly,
    fileMustExist: false,
  });

  // Don't modify schema if read-only
  if (readOnly) {
    return db;
  }

  // Apply database configuration
  db.exec(schema.DB_CONFIG);

  // Create all tables (CLI + server-specific)
  for (const table of schema.ALL_TABLES) {
    db.exec(table);
  }

  // Run any pending migrations BEFORE creating indexes
  // (migrations might alter table schemas that indexes depend on)
  runMigrations(db);

  // Create all indexes (CLI + server-specific)
  for (const indexes of schema.ALL_INDEXES) {
    db.exec(indexes);
  }

  // Create all views
  for (const view of schema.ALL_VIEWS) {
    db.exec(view);
  }

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
