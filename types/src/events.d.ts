/**
 * Event types for the watcher system
 * These events are emitted by the CLI watcher and consumed by the server
 */

import type { Spec, Issue } from "./index.js";

/**
 * Event fired when an entity is synced between database and markdown
 */
export interface EntitySyncEvent {
  /** Type of entity that was synced */
  entityType: "spec" | "issue";

  /** ID of the entity (e.g., 'i-x7k9', 's-14sh') */
  entityId: string;

  /** Action that was performed */
  action: "created" | "updated" | "deleted" | "no-change";

  /** Absolute path to the markdown file */
  filePath: string;

  /** Absolute path to the .sudocode directory (for project identification) */
  baseDir: string;

  /** Source of the change that triggered sync */
  source: "markdown" | "jsonl" | "database";

  /** Timestamp when event occurred */
  timestamp: Date;

  /** Optional: Full entity data (avoids DB query in server) */
  entity?: Spec | Issue;

  /** Optional: Duration of sync operation in milliseconds */
  duration?: number;

  /** Optional: Whether a merge conflict was resolved */
  conflictResolved?: boolean;

  /** Version of event format */
  version: 1;
}

/**
 * Event fired when a file change is detected (before sync)
 */
export interface FileChangeEvent {
  /** Absolute path to the file */
  filePath: string;

  /** Absolute path to the .sudocode directory */
  baseDir: string;

  /** Type of file system event */
  event: "add" | "change" | "unlink";

  /** Detected entity type (if applicable) */
  entityType?: "spec" | "issue";

  /** Detected entity ID (if applicable) */
  entityId?: string;

  /** Timestamp */
  timestamp: Date;

  /** Version of event format */
  version: 1;
}
