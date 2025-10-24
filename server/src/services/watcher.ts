/**
 * File watcher service for the server
 * Reuses the CLI watcher with server-specific callbacks
 */

import type Database from "better-sqlite3";
import {
  startWatcher as startCliWatcher,
  type WatcherStats,
} from "@sudocode/cli/dist/watcher.js";

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
   * Debounce delay in milliseconds (default: 2000)
   */
  debounceDelay?: number;
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
    event: "add" | "change" | "unlink";
    entityType?: "spec" | "issue";
    entityId?: string;
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
    debounceDelay = 2000,
    syncJSONLToMarkdown = false,
    onFileChange,
  } = options;

  console.log(`[watcher] Starting file watcher for ${baseDir}`);
  console.log(`[watcher] Debounce delay: ${debounceDelay}ms`);
  if (syncJSONLToMarkdown) {
    console.log(`[watcher] Reverse sync (JSONL → Markdown) enabled`);
  }

  // Start the CLI watcher with server-specific callbacks
  const control = startCliWatcher({
    db,
    baseDir,
    debounceDelay,
    syncJSONLToMarkdown,
    onLog: (message) => {
      console.log(message);

      // Extract entity info from log messages if available
      // Log format: "[watch] <event> <path>" or "[watch] Synced <type> <id> (<action>)"
      if (onFileChange) {
        // TODO: Use something more robust than regex parsing here.
        const syncMatch = message.match(
          /\[watch\] Synced (spec|issue) ([A-Z]+-\d+) \((created|updated)\)/
        );
        if (syncMatch) {
          const [, entityType, entityId] = syncMatch;
          onFileChange({
            filePath: "", // Path not available in sync message
            event: "change",
            entityType: entityType as "spec" | "issue",
            entityId,
          });
        }
      }
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
