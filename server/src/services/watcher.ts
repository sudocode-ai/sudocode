/**
 * File watcher service for the server
 * Reuses the CLI watcher with server-specific callbacks
 */

import type Database from "better-sqlite3";
import {
  startWatcher as startCliWatcher,
  type WatcherStats,
} from "@sudocode-ai/cli/dist/watcher.js";
import type { EntitySyncEvent } from "@sudocode-ai/types/events";

export interface ServerWatcherOptions {
  /**
   * Database instance
   */
  db: Database.Database;
  /**
   * Base directory to watch (e.g., .sudocode)
   */
  baseDir: string;
  /**
   * Enable reverse sync (JSONL → Markdown) when JSONL files change (default: false)
   */
  syncJSONLToMarkdown?: boolean;
  /**
   * Callback for file change events
   * This will be used to broadcast WebSocket updates
   */
  onFileChange?: (info: {
    filePath: string;
    baseDir: string;
    event: "add" | "change" | "unlink";
    entityType?: "spec" | "issue";
    entityId?: string;
    entity?: any;
    timestamp: Date;
  }) => void;
}

export interface ServerWatcherControl {
  /**
   * Stop watching files
   */
  stop: () => Promise<void>;
  /**
   * Get watcher statistics
   */
  getStats: () => WatcherStats;
}

/**
 * Start the file watcher for the server
 * This wraps the CLI watcher with server-specific logging and callbacks
 */
export function startServerWatcher(
  options: ServerWatcherOptions
): ServerWatcherControl {
  const {
    db,
    baseDir,
    syncJSONLToMarkdown = false,
    onFileChange,
  } = options;

  console.log(`[watcher] Starting file watcher for ${baseDir}`);
  if (syncJSONLToMarkdown) {
    console.log(`[watcher] Reverse sync (JSONL → Markdown) enabled`);
  }

  // Start the CLI watcher with typed callbacks
  const control = startCliWatcher({
    db,
    baseDir,
    syncJSONLToMarkdown,

    // NEW PATH: Use typed callback (preferred)
    onEntitySync: (event: EntitySyncEvent) => {
      console.log(
        `[watcher] Entity synced: ${event.entityType} ${event.entityId} (${event.action})`
      );

      if (onFileChange) {
        onFileChange({
          filePath: event.filePath,
          baseDir: event.baseDir,
          event: "change",
          entityType: event.entityType,
          entityId: event.entityId,
          entity: event.entity, // ✅ Pass through entity data
          timestamp: event.timestamp,
        });
      }
    },

    // Keep onLog for debugging
    onLog: (message) => {
      console.log(message);
    },

    onError: (error) => {
      console.error(`[watcher] Error: ${error.message}`);
    },
  });

  return {
    stop: async () => {
      console.log("[watcher] Stopping file watcher...");
      await control.stop();
    },
    getStats: control.getStats,
  };
}
