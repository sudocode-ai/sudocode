/**
 * File watcher for automatic synchronization
 * Watches .sudocode directory for changes and triggers sync operations
 */

import chokidar from "chokidar";
import * as path from "path";
import type Database from "better-sqlite3";
import { syncMarkdownToJSONL } from "./sync.js";
import { importFromJSONL } from "./import.js";
import { exportToJSONL } from "./export.js";
import { getSpecByFilePath, deleteSpec } from "./operations/specs.js";

export interface WatcherOptions {
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
   * Callback for logging events
   */
  onLog?: (message: string) => void;
  /**
   * Callback for errors
   */
  onError?: (error: Error) => void;
  /**
   * Whether to ignore initial files (default: true)
   * Set to false for testing to detect files created before watcher starts
   */
  ignoreInitial?: boolean;
}

export interface WatcherControl {
  /**
   * Stop watching files
   */
  stop: () => Promise<void>;
  /**
   * Get watcher statistics
   */
  getStats: () => WatcherStats;
}

export interface WatcherStats {
  filesWatched: number;
  changesPending: number;
  changesProcessed: number;
  errors: number;
}

/**
 * Start watching files for changes
 * Returns a control object to stop the watcher
 */
export function startWatcher(options: WatcherOptions): WatcherControl {
  const {
    db,
    baseDir,
    debounceDelay = 2000,
    onLog = console.log,
    onError = console.error,
    ignoreInitial = true,
  } = options;

  const stats: WatcherStats = {
    filesWatched: 0,
    changesPending: 0,
    changesProcessed: 0,
    errors: 0,
  };

  // Map of file paths to pending timeout IDs
  const pendingChanges = new Map<string, NodeJS.Timeout>();

  // Paths to watch
  const specsDir = path.join(baseDir, "specs");
  const issuesDir = path.join(baseDir, "issues");
  const specsJSONL = path.join(specsDir, "specs.jsonl");
  const issuesJSONL = path.join(issuesDir, "issues.jsonl");

  // Watch directories - chokidar will recursively watch all files inside
  const watcher = chokidar.watch([specsDir, issuesDir], {
    persistent: true,
    ignoreInitial,
    awaitWriteFinish: {
      stabilityThreshold: 100, // Reduced for faster detection in tests
      pollInterval: 50,
    },
  });

  // Log watch patterns for debugging
  onLog(`[watch] Watching directories: ${specsDir}, ${issuesDir}`);

  /**
   * Process a file change
   */
  async function processChange(
    filePath: string,
    event: "add" | "change" | "unlink"
  ) {
    try {
      const ext = path.extname(filePath);
      const basename = path.basename(filePath);

      if (ext === ".md") {
        // Markdown file changed - sync to database and JSONL
        onLog(`[watch] ${event} ${path.relative(baseDir, filePath)}`);

        if (event === "unlink") {
          // File was deleted - remove from database and JSONL
          // Calculate relative file path
          const relPath = path.relative(baseDir, filePath);

          // Look up spec by file path
          const spec = getSpecByFilePath(db, relPath);
          if (spec) {
            // Delete from database
            const deleted = deleteSpec(db, spec.id);
            if (deleted) {
              onLog(`[watch] Deleted spec ${spec.id} (file removed)`);

              // Export to JSONL to reflect deletion
              await exportToJSONL(db, { outputDir: baseDir });
            }
          } else {
            onLog(`[watch] File deleted but no spec found: ${relPath}`);
          }
        } else {
          // Sync markdown to database
          const result = await syncMarkdownToJSONL(db, filePath, {
            outputDir: baseDir,
            autoExport: true,
            autoInitialize: true,
            writeBackFrontmatter: false,
          });

          if (result.success) {
            onLog(
              `[watch] Synced ${result.entityType} ${result.entityId} (${result.action})`
            );
          } else {
            onError(new Error(`Failed to sync ${filePath}: ${result.error}`));
            stats.errors++;
          }
        }
      } else if (basename === "specs.jsonl" || basename === "issues.jsonl") {
        // JSONL file changed (e.g., from git pull) - import to database
        onLog(`[watch] ${event} ${path.relative(baseDir, filePath)}`);

        if (event !== "unlink") {
          await importFromJSONL(db, {
            inputDir: baseDir,
          });
          onLog(`[watch] Imported JSONL changes to database`);
        }
      }

      stats.changesProcessed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(new Error(`Error processing ${filePath}: ${message}`));
      stats.errors++;
    }
  }

  /**
   * Debounced file change handler
   */
  function handleFileChange(
    filePath: string,
    event: "add" | "change" | "unlink"
  ) {
    // Cancel pending change for this file
    const existingTimeout = pendingChanges.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      stats.changesPending--;
    }

    // Schedule new change
    stats.changesPending++;
    const timeout = setTimeout(() => {
      pendingChanges.delete(filePath);
      stats.changesPending--;
      processChange(filePath, event);
    }, debounceDelay);

    pendingChanges.set(filePath, timeout);
  }

  // Set up event handlers
  watcher.on("add", (filePath) => handleFileChange(filePath, "add"));
  watcher.on("change", (filePath) => handleFileChange(filePath, "change"));
  watcher.on("unlink", (filePath) => handleFileChange(filePath, "unlink"));

  watcher.on("ready", () => {
    const watched = watcher.getWatched();
    stats.filesWatched = Object.keys(watched).reduce(
      (total, dir) => total + watched[dir].length,
      0
    );
    onLog(`[watch] Watching ${stats.filesWatched} files in ${baseDir}`);
  });

  watcher.on("error", (error) => {
    onError(error);
    stats.errors++;
  });

  // Return control object
  return {
    stop: async () => {
      onLog("[watch] Stopping watcher...");

      // Cancel all pending changes
      for (const timeout of pendingChanges.values()) {
        clearTimeout(timeout);
      }
      pendingChanges.clear();
      stats.changesPending = 0;

      // Close watcher
      await watcher.close();
      onLog("[watch] Watcher stopped");
    },
    getStats: () => ({ ...stats }),
  };
}

/**
 * Wait for termination signal and stop watcher gracefully
 */
export function setupGracefulShutdown(control: WatcherControl): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[watch] Received ${signal}, shutting down gracefully...`);

    try {
      await control.stop();
      process.exit(0);
    } catch (error) {
      console.error("[watch] Error during shutdown:", error);
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error(
      "[watch] Unhandled Rejection at:",
      promise,
      "reason:",
      reason
    );
  });
}
