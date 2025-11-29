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
import {
  findExistingEntityFile,
  generateUniqueFilename,
} from "./filename-generator.js";
import { getOutgoingRelationships } from "./operations/relationships.js";
import type { EntitySyncEvent, FileChangeEvent } from "@sudocode-ai/types/events";
import * as crypto from "crypto";

// Guard against processing our own file writes (oscillation prevention)
// Track files currently being processed to prevent same-file oscillation
const filesBeingProcessed = new Set<string>();

// Content hash cache for detecting actual content changes (oscillation prevention)
const contentHashCache = new Map<string, string>();

/**
 * Compute SHA256 hash of file content for change detection
 */
function computeContentHash(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (error) {
    // File doesn't exist or can't be read
    return "";
  }
}

/**
 * Check if file content has actually changed since last processing
 * Returns true if content changed, false if unchanged
 */
function hasContentChanged(filePath: string): boolean {
  const currentHash = computeContentHash(filePath);
  const cachedHash = contentHashCache.get(filePath);

  if (cachedHash && cachedHash === currentHash) {
    // Content unchanged - skip processing
    return false;
  }

  // Update cache with new hash
  contentHashCache.set(filePath, currentHash);
  return true;
}

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

  /**
   * Called when an entity is synced (after successful sync)
   * Provides typed event data for machine consumption
   */
  onEntitySync?: (event: EntitySyncEvent) => void | Promise<void>;

  /**
   * Called when a file change is detected (before sync)
   * Provides typed event data for machine consumption
   */
  onFileChange?: (event: FileChangeEvent) => void | Promise<void>;
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
    onLog = console.log,
    onError = console.error,
    ignoreInitial = true,
    syncJSONLToMarkdown: enableReverseSync = false,
    onEntitySync,
    onFileChange,
  } = options;

  const stats: WatcherStats = {
    filesWatched: 0,
    changesProcessed: 0,
    errors: 0,
  };

  // Cache of previous JSONL state (entity ID -> timestamp)
  // This allows us to detect changes by comparing new JSONL against cached state
  const jsonlStateCache = new Map<
    string,
    Map<string, string>
  >(); // jsonlPath -> (entityId -> content_hash)

  /**
   * Compute a canonical content hash for an entity that's invariant to key ordering
   * This ensures that {"id":"x","title":"y"} and {"title":"y","id":"x"} produce the same hash
   */
  function computeCanonicalHash(entity: any): string {
    // Sort keys recursively to ensure consistent ordering
    const sortKeys = (obj: any): any => {
      if (obj === null || typeof obj !== "object") {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(sortKeys);
      }
      const sorted: any = {};
      Object.keys(obj)
        .sort()
        .forEach((key) => {
          sorted[key] = sortKeys(obj[key]);
        });
      return sorted;
    };

    const canonical = sortKeys(entity);
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex");
  }

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
          const dbFeedback = listFeedback(db, { from_id: entityId });
          const jsonlFeedback = jsonlEntity.feedback || [];
          if (jsonlFeedback.length !== dbFeedback.length) return true;

          // Compare feedback content
          for (const jf of jsonlFeedback) {
            const dbf = dbFeedback.find((f: any) => f.id === jf.id);
            if (!dbf) return true;
            if (jf.content !== dbf.content) return true;
            if (jf.feedback_type !== dbf.feedback_type) return true;
            if (jf.to_id !== dbf.to_id) return true;
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

        // Compare relationships;
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
      // Set re-entry guard for this specific file to prevent oscillation
      filesBeingProcessed.add(filePath);

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

            // Emit typed callback event for markdown sync
            if (onEntitySync) {
              // Get full entity data to include in event
              const entity =
                result.entityType === "spec"
                  ? getSpec(db, result.entityId)
                  : getIssue(db, result.entityId);

              await onEntitySync({
                entityType: result.entityType,
                entityId: result.entityId,
                action: result.action,
                filePath,
                baseDir,
                source: "markdown",
                timestamp: new Date(),
                entity: entity ?? undefined,
                version: 1,
              });
            }
          } else {
            onError(new Error(`Failed to sync ${filePath}: ${result.error}`));
            stats.errors++;
          }
        }
      } else if (basename === "specs.jsonl" || basename === "issues.jsonl") {
        // JSONL file changed (e.g., from CLI update or git pull)
        onLog(`[watch] ${event} ${path.relative(baseDir, filePath)}`);

        if (event !== "unlink") {
          const entityType = basename === "specs.jsonl" ? "spec" : "issue";

          // Read JSONL file
          const jsonlContent = fs.readFileSync(filePath, "utf8");
          const jsonlLines = jsonlContent
            .trim()
            .split("\n")
            .filter((line) => line.trim());

          // Parse JSONL entities and build new state map
          const jsonlEntities = jsonlLines.map((line) => JSON.parse(line));
          const newStateMap = new Map<string, string>();
          for (const entity of jsonlEntities) {
            // Use canonical content hash to detect any content changes
            // Canonical hash is invariant to JSON key ordering
            const contentHash = computeCanonicalHash(entity);
            newStateMap.set(entity.id, contentHash);
          }

          // Get cached state (previous JSONL state)
          const cachedStateMap = jsonlStateCache.get(filePath) || new Map();

          // Detect changed entities by comparing new state with cached state
          const changedEntities: Array<{
            entityId: string;
            action: "created" | "updated";
          }> = [];

          for (const jsonlEntity of jsonlEntities) {
            const entityId = jsonlEntity.id;
            const newHash = newStateMap.get(entityId);
            const cachedHash = cachedStateMap.get(entityId);

            if (!cachedHash) {
              // Entity not in cache = created
              changedEntities.push({ entityId, action: "created" });
            } else if (newHash !== cachedHash) {
              // Content hash differs = entity changed
              changedEntities.push({ entityId, action: "updated" });
            }
          }

          // Update cache with new state
          jsonlStateCache.set(filePath, newStateMap);

          if (changedEntities.length > 0) {
            onLog(
              `[watch] Detected ${changedEntities.length} changed ${entityType}(s) in JSONL`
            );

            // Import from JSONL to sync database
            // Pass changed entity IDs to force update even if timestamp hasn't changed
            // (user may have manually edited JSONL content without updating timestamp)
            const changedIds = changedEntities.map((e) => e.entityId);
            await importFromJSONL(db, {
              inputDir: baseDir,
              forceUpdateIds: changedIds,
            });
            onLog(`[watch] Imported JSONL changes to database`);

            // Emit events for changed entities (after import, so we have fresh data)
            for (const { entityId, action } of changedEntities) {
              onLog(`[watch] Synced ${entityType} ${entityId} (${action})`);

              if (onEntitySync) {
                // Get fresh entity data from database (after import)
                const entity =
                  entityType === "spec"
                    ? getSpec(db, entityId)
                    : getIssue(db, entityId);

                // Find markdown file path
                let entityFilePath: string;
                if (entityType === "spec" && entity && "file_path" in entity) {
                  entityFilePath = path.join(baseDir, entity.file_path);
                } else if (
                  entityType === "issue" &&
                  entity &&
                  "file_path" in entity
                ) {
                  entityFilePath = path.join(baseDir, entity.file_path);
                } else {
                  // Fallback to default path
                  entityFilePath = path.join(
                    baseDir,
                    entityType === "spec" ? "specs" : "issues",
                    `${entityId}.md`
                  );
                }

                await onEntitySync({
                  entityType,
                  entityId: entityId,
                  action,
                  filePath: entityFilePath,
                  baseDir,
                  source: "jsonl",
                  timestamp: new Date(),
                  entity: entity ?? undefined,
                  version: 1,
                });
              }
            }
          } else {
            onLog(`[watch] No entity changes detected in ${basename}`);
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
              // Find existing file or generate new filename using unified scheme
              let mdPath = findExistingEntityFile(
                issue.id,
                issuesDir,
                issue.title
              );
              if (!mdPath) {
                // File doesn't exist, generate new filename
                const fileName = generateUniqueFilename(issue.title, issue.id);
                mdPath = path.join(issuesDir, fileName);
              }

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
    } finally {
      // Always clear re-entry guard for this file, even on errors
      filesBeingProcessed.delete(filePath);
    }
  }

  /**
   * File change handler with oscillation guards
   * Processes changes immediately (no debounce)
   */
  function handleFileChange(
    filePath: string,
    event: "add" | "change" | "unlink"
  ) {
    // Guard: Skip if we're currently processing this specific file (prevents oscillation)
    // This is the primary defense against the oscillation loop
    if (filesBeingProcessed.has(filePath)) {
      return;
    }

    // Process change immediately
    processChange(filePath, event);
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

    // Initialize JSONL state cache on startup to avoid broadcasting all entities on first change
    try {
      // Initialize specs.jsonl cache
      const specsJsonlPath = path.join(baseDir, "specs.jsonl");
      if (fs.existsSync(specsJsonlPath)) {
        const content = fs.readFileSync(specsJsonlPath, "utf8");
        const lines = content.trim().split("\n").filter((line) => line.trim());
        const stateMap = new Map<string, string>();
        for (const line of lines) {
          const entity = JSON.parse(line);
          // Use canonical content hash to match the change detection logic
          const contentHash = computeCanonicalHash(entity);
          stateMap.set(entity.id, contentHash);
        }
        jsonlStateCache.set(specsJsonlPath, stateMap);
        onLog(
          `[watch] Initialized cache for specs.jsonl (${stateMap.size} entities)`
        );
      }

      // Initialize issues.jsonl cache
      const issuesJsonlPath = path.join(baseDir, "issues.jsonl");
      if (fs.existsSync(issuesJsonlPath)) {
        const content = fs.readFileSync(issuesJsonlPath, "utf8");
        const lines = content.trim().split("\n").filter((line) => line.trim());
        const stateMap = new Map<string, string>();
        for (const line of lines) {
          const entity = JSON.parse(line);
          // Use canonical content hash to match the change detection logic
          const contentHash = computeCanonicalHash(entity);
          stateMap.set(entity.id, contentHash);
        }
        jsonlStateCache.set(issuesJsonlPath, stateMap);
        onLog(
          `[watch] Initialized cache for issues.jsonl (${stateMap.size} entities)`
        );
      }
    } catch (error) {
      onLog(
        `[watch] Warning: Failed to initialize JSONL cache: ${error instanceof Error ? error.message : String(error)}`
      );
      // Continue anyway - cache will be populated on first change
    }
  });

  watcher.on("error", (error) => {
    onError(error);
    stats.errors++;
  });

  // Return control object
  return {
    stop: async () => {
      onLog("[watch] Stopping watcher...");

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
