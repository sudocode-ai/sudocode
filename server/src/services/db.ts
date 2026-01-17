/**
 * Database service for sudocode server
 * Uses shared schema from @sudocode-ai/types
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as schema from "@sudocode-ai/types/schema";
import {
  runMigrations,
  runDataplaneMigrationsIfAvailable,
} from "@sudocode-ai/types/migrations";
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

  // Apply database configuration
  db.exec(schema.DB_CONFIG);

  // Create all tables (CLI + server-specific)
  for (const table of schema.ALL_TABLES) {
    db.exec(table);
  }

  // Run any pending migrations BEFORE creating indexes
  // (migrations might alter table schemas that indexes depend on)
  runMigrations(db);

  // Run dataplane migrations (if dataplane is installed)
  // Note: This is async but we fire-and-forget since dataplane
  // migrations don't affect sudocode's core tables
  runDataplaneMigrationsIfAvailable(db, "dp_").catch((err) => {
    console.warn("Failed to run dataplane migrations:", err);
  });

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
 * Initialize database with CLI schema + server extensions (async version)
 * Use this when you need to ensure dataplane migrations are complete before proceeding.
 */
export async function initDatabaseAsync(
  config: DatabaseConfig
): Promise<Database.Database> {
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

  // Apply database configuration
  db.exec(schema.DB_CONFIG);

  // Create all tables (CLI + server-specific)
  for (const table of schema.ALL_TABLES) {
    db.exec(table);
  }

  // Run any pending migrations BEFORE creating indexes
  // (migrations might alter table schemas that indexes depend on)
  runMigrations(db);

  // Run dataplane migrations (if dataplane is installed)
  await runDataplaneMigrationsIfAvailable(db, "dp_");

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
