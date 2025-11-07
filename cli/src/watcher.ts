/**
 * File watcher for automatic synchronization
 * Watches .sudocode directory for changes and triggers sync operations
 */

import chokidar from "chokidar";
import * as path from "path";
import * as fs from "fs";
import type Database from "better-sqlite3";
import { syncMarkdownToJSONL, syncJSONLToMarkdown } from "./sync.js";
import { importFromJSONL } from "./import.js";
import { exportToJSONL } from "./export.js";
import {
  getSpecByFilePath,
  deleteSpec,
  listSpecs,
  getSpec,
} from "./operations/specs.js";
import { listIssues, getIssue } from "./operations/issues.js";
import { parseMarkdownFile } from "./markdown.js";
import { listFeedback } from "./operations/feedback.js";
import { getTags } from "./operations/tags.js";
import { updateCrossRepoReferences, hasAnyReferences } from "./operations/crossRepoReferences.js";

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
  /**
   * Enable reverse sync (JSONL → Markdown) when JSONL files change (default: false)
   * When enabled, changes to JSONL files will update both the database and markdown files
   */
  syncJSONLToMarkdown?: boolean;
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
    syncJSONLToMarkdown: enableReverseSync = false,
  } = options;

  const stats: WatcherStats = {
    filesWatched: 0,
    changesPending: 0,
    changesProcessed: 0,
    errors: 0,
  };

  // Map of file paths to pending timeout IDs
  const pendingChanges = new Map<string, NodeJS.Timeout>();

  /**
   * Check if markdown file content matches database content
   * Returns true if they match (no sync needed)
   */
  function contentMatches(
    mdPath: string,
    entityId: string,
    entityType: "spec" | "issue"
  ): boolean {
    try {
      // Check if file exists
      if (!fs.existsSync(mdPath)) {
        return false; // File doesn't exist, needs to be created
      }

      // Parse markdown file
      const parsed = parseMarkdownFile(mdPath, db, baseDir);
      const { data: frontmatter, content: mdContent } = parsed;

      // Get entity from database
      const dbEntity =
        entityType === "spec" ? getSpec(db, entityId) : getIssue(db, entityId);

      if (!dbEntity) {
        return false; // Entity not in DB, shouldn't happen
      }

      // Compare title
      if (frontmatter.title !== dbEntity.title) {
        return false;
      }

      // Compare content (trim to ignore whitespace differences)
      if (mdContent.trim() !== (dbEntity.content || "").trim()) {
        return false;
      }

      // Compare other key fields
      if (entityType === "spec") {
        if (frontmatter.priority !== dbEntity.priority) return false;
      } else {
        const issue = dbEntity as any;
        if (frontmatter.status !== issue.status) return false;
        if (frontmatter.priority !== issue.priority) return false;
      }

      return true; // Content matches
    } catch (error) {
      // If there's an error parsing, assume they don't match
      return false;
    }
  }

  /**
   * Check if JSONL file needs to be imported to database
   * Returns true if import is needed (JSONL has changes not in DB)
   */
  function jsonlNeedsImport(jsonlPath: string): boolean {
    try {
      if (!fs.existsSync(jsonlPath)) {
        return false; // File doesn't exist
      }

      // Read JSONL file
      const content = fs.readFileSync(jsonlPath, "utf8");
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      // Parse each line and check if it differs from database
      for (const line of lines) {
        const jsonlEntity = JSON.parse(line);
        const entityId = jsonlEntity.id;
        const entityType = jsonlPath.includes("specs.jsonl") ? "spec" : "issue";

        // Get entity from database
        const dbEntity =
          entityType === "spec"
            ? getSpec(db, entityId)
            : getIssue(db, entityId);

        // If entity doesn't exist in DB, import is needed
        if (!dbEntity) {
          return true;
        }

        // Compare all substantial fields
        if (jsonlEntity.title !== dbEntity.title) return true;
        if (
          (jsonlEntity.content || "").trim() !== (dbEntity.content || "").trim()
        )
          return true;
        if (jsonlEntity.priority !== dbEntity.priority) return true;
        if (jsonlEntity.parent_id !== dbEntity.parent_id) return true;
        if (jsonlEntity.archived !== dbEntity.archived) return true;
        if (jsonlEntity.archived_at !== dbEntity.archived_at) return true;

        if (entityType === "spec") {
          const dbSpec = dbEntity as any;
          // Compare spec-specific fields
          if (jsonlEntity.file_path !== dbSpec.file_path) return true;
        } else if (entityType === "issue") {
          const dbIssue = dbEntity as any;
          if (jsonlEntity.status !== dbIssue.status) return true;
          if (jsonlEntity.assignee !== dbIssue.assignee) return true;
          if (jsonlEntity.closed_at !== dbIssue.closed_at) return true;

          // Compare feedback
          const dbFeedback = listFeedback(db, { issue_id: entityId });
          const jsonlFeedback = jsonlEntity.feedback || [];
          if (jsonlFeedback.length !== dbFeedback.length) return true;

          // Compare feedback content
          for (const jf of jsonlFeedback) {
            const dbf = dbFeedback.find((f: any) => f.id === jf.id);
            if (!dbf) return true;
            if (jf.content !== dbf.content) return true;
            if (jf.feedback_type !== dbf.feedback_type) return true;
            if (jf.spec_id !== dbf.spec_id) return true;
            if (jf.dismissed !== dbf.dismissed) return true;
            // Compare anchor (stringified for comparison)
            const jfAnchor = JSON.stringify(jf.anchor || null);
            const dbfAnchor = JSON.stringify(
              dbf.anchor && typeof dbf.anchor === "string"
                ? JSON.parse(dbf.anchor)
                : dbf.anchor || null
            );
            if (jfAnchor !== dbfAnchor) return true;
          }
        }

        // Compare tags
        const dbTags = getTags(db, entityId, entityType);
        const jsonlTags = jsonlEntity.tags || [];
        if (jsonlTags.length !== dbTags.length) return true;
        const dbTagsSet = new Set(dbTags);
        if (jsonlTags.some((tag: string) => !dbTagsSet.has(tag))) return true;

        // Compare relationships
        const { getOutgoingRelationships } = require("./operations/relationships.js");
        const dbRels = getOutgoingRelationships(db, entityId, entityType);
        const jsonlRels = jsonlEntity.relationships || [];
        if (jsonlRels.length !== dbRels.length) return true;

        // Compare relationship content
        for (const jr of jsonlRels) {
          const dr = dbRels.find(
            (r: any) =>
              r.to_id === jr.to &&
              r.to_type === jr.to_type &&
              r.relationship_type === jr.type
          );
          if (!dr) return true;
        }

        // Compare updated_at timestamp - if JSONL is newer, import is needed
        if (
          jsonlEntity.updated_at &&
          new Date(jsonlEntity.updated_at).getTime() >
            new Date(dbEntity.updated_at).getTime()
        ) {
          return true;
        }
      }

      return false; // All entities match
    } catch (error) {
      // If there's an error, assume import is needed
      return true;
    }
  }

  // Paths to watch
  const specsDir = path.join(baseDir, "specs");
  const issuesDir = path.join(baseDir, "issues");
  const specsJSONL = path.join(baseDir, "specs.jsonl");
  const issuesJSONL = path.join(baseDir, "issues.jsonl");

  // Watch directories and JSONL files - chokidar will recursively watch all files inside
  const watcher = chokidar.watch(
    [specsDir, issuesDir, specsJSONL, issuesJSONL],
    {
      persistent: true,
      ignoreInitial,
      awaitWriteFinish: {
        stabilityThreshold: 100, // Reduced for faster detection in tests
        pollInterval: 50,
      },
    }
  );

  // Log watch patterns for debugging
  onLog(
    `[watch] Watching directories: ${specsDir}, ${issuesDir} and JSONL files`
  );

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
          // Parse markdown to get entity info
          try {
            const parsed = parseMarkdownFile(filePath, db, baseDir);
            const { data: frontmatter } = parsed;
            const entityId = frontmatter.id;

            // Determine entity type based on file location
            const relPath = path.relative(baseDir, filePath);
            const entityType =
              relPath.startsWith("specs/") || relPath.startsWith("specs\\")
                ? "spec"
                : "issue";

            // Skip if content already matches (prevents oscillation)
            if (entityId && contentMatches(filePath, entityId, entityType)) {
              return;
            }

            // Check timestamps to determine sync direction
            if (entityId) {
              const dbEntity =
                entityType === "spec"
                  ? getSpec(db, entityId)
                  : getIssue(db, entityId);

              if (dbEntity) {
                // Get file modification time
                const fileStat = fs.statSync(filePath);
                const fileTime = fileStat.mtimeMs;

                // Get database updated_at time
                const dbTime = new Date(dbEntity.updated_at).getTime();

                // If database is newer than file, skip markdown → database sync
                if (dbTime > fileTime) {
                  onLog(
                    `[watch] Skipping sync for ${entityType} ${entityId} (database is newer)`
                  );
                  return;
                }
              }
            }
          } catch (error) {
            // If parsing fails, continue with sync (might be a new file)
          }

          // Sync markdown to database
          const result = await syncMarkdownToJSONL(db, filePath, {
            outputDir: baseDir,
            autoExport: true,
            autoInitialize: true,
            writeBackFrontmatter: true,
          });

          if (result.success) {
            onLog(
              `[watch] Synced ${result.entityType} ${result.entityId} (${result.action})`
            );

            // Parse cross-repo references from content
            if (result.content && hasAnyReferences(result.content)) {
              try {
                const refCount = updateCrossRepoReferences(
                  db,
                  result.entityId,
                  result.entityType as "issue" | "spec",
                  result.content
                );
                if (refCount > 0) {
                  onLog(
                    `[watch] Updated ${refCount} cross-repo reference(s) for ${result.entityType} ${result.entityId}`
                  );
                }
              } catch (error) {
                onLog(
                  `[watch] Warning: Failed to parse cross-repo references: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }
          } else {
            onError(new Error(`Failed to sync ${filePath}: ${result.error}`));
            stats.errors++;
          }
        }
      } else if (basename === "specs.jsonl" || basename === "issues.jsonl") {
        // JSONL file changed (e.g., from git pull) - check if import is needed
        onLog(`[watch] ${event} ${path.relative(baseDir, filePath)}`);

        if (event !== "unlink") {
          // Check if JSONL actually differs from database before importing
          if (jsonlNeedsImport(filePath)) {
            await importFromJSONL(db, {
              inputDir: baseDir,
            });
            onLog(`[watch] Imported JSONL changes to database`);
          }

          // Optionally sync database changes back to markdown files
          // Only sync entities where content actually differs (contentMatches check)
          if (enableReverseSync) {
            onLog(
              `[watch] Checking for entities that need markdown updates...`
            );

            let syncedCount = 0;

            // Get all specs and sync to markdown
            const specs = listSpecs(db);
            for (const spec of specs) {
              if (spec.file_path) {
                const mdPath = path.join(baseDir, spec.file_path);

                // Skip if content already matches (prevents oscillation)
                if (contentMatches(mdPath, spec.id, "spec")) {
                  continue;
                }

                const result = await syncJSONLToMarkdown(
                  db,
                  spec.id,
                  "spec",
                  mdPath
                );

                if (result.success) {
                  syncedCount++;
                  onLog(
                    `[watch] Synced spec ${spec.id} to ${spec.file_path} (${result.action})`
                  );
                } else if (result.error) {
                  onError(
                    new Error(`Failed to sync spec ${spec.id}: ${result.error}`)
                  );
                }
              }
            }

            // Get all issues and check if any need syncing
            const issues = listIssues(db);
            const issuesDir = path.join(baseDir, "issues");
            for (const issue of issues) {
              const fileName = `${issue.id}.md`;
              const mdPath = path.join(issuesDir, fileName);

              // Skip if content already matches (prevents unnecessary writes and oscillation)
              if (contentMatches(mdPath, issue.id, "issue")) {
                continue;
              }

              const result = await syncJSONLToMarkdown(
                db,
                issue.id,
                "issue",
                mdPath
              );

              if (result.success) {
                syncedCount++;
                onLog(
                  `[watch] Synced issue ${issue.id} to markdown (${result.action})`
                );
              } else if (result.error) {
                onError(
                  new Error(`Failed to sync issue ${issue.id}: ${result.error}`)
                );
              }
            }

            if (syncedCount > 0) {
              onLog(`[watch] Synced ${syncedCount} entities to markdown`);
            } else {
              onLog(`[watch] All markdown files are up to date`);
            }
          }
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
