/**
 * File watcher service for the server
 * Reuses the CLI watcher with server-specific callbacks
 */

import type Database from "better-sqlite3";
import {
  startWatcher as startCliWatcher,
  type WatcherStats,
} from "@sudocode-ai/cli/dist/watcher.js";

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
  // TODO: Migrate away from parsing messages and start a watcher directly instead of using the CLI watcher.
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

        // Match markdown sync log: "[watch] Synced issue ISSUE-001 (updated)"
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
          return; // Early return to avoid double-processing
        }

        // Match JSONL file change: "[watch] change issues.jsonl" or "[watch] change specs.jsonl"
        const jsonlChangeMatch = message.match(
          /\[watch\] change (issues|specs)\.jsonl/
        );
        if (jsonlChangeMatch) {
          const [, entityType] = jsonlChangeMatch;
          // For JSONL changes, we don't know which specific entity changed
          // so we broadcast a generic update that will trigger a refetch
          onFileChange({
            filePath: `${entityType}.jsonl`,
            event: "change",
            entityType: (entityType === "issues" ? "issue" : "spec") as
              | "spec"
              | "issue",
            entityId: "*", // Wildcard to indicate "any entity of this type"
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
