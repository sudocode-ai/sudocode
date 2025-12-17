/**
 * File watcher for OpenSpec integration
 *
 * Watches the OpenSpec directory for changes to spec files and change directories.
 * Detects which entities were created, updated, or deleted.
 *
 * Watch patterns:
 * - specs/ directory (all .md files) - Spec file changes
 * - changes/<name>/proposal.md - Change proposal updates
 * - changes/<name>/tasks.md - Change task updates
 * - changes/archive/<name>/ - Archived change detection
 * - changes/<name>/specs/<cap>/ - Delta directory changes
 */

import chokidar, { type FSWatcher } from "chokidar";
import * as path from "path";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import type { ExternalChange, ExternalEntity } from "@sudocode-ai/types";
import { parseSpecFile, type ParsedOpenSpecSpec } from "./parser/spec-parser.js";
import {
  parseChangeDirectory,
  scanChangeDirectories,
  isChangeDirectory,
  type ParsedOpenSpecChange,
} from "./parser/change-parser.js";
import {
  generateSpecId,
  generateChangeId,
  parseOpenSpecId,
  DEFAULT_SPEC_PREFIX,
  DEFAULT_CHANGE_PREFIX,
} from "./id-generator.js";

/**
 * Callback type for change notifications
 */
export type ChangeCallback = (changes: ExternalChange[]) => void;

/**
 * Options for the OpenSpecWatcher
 */
export interface OpenSpecWatcherOptions {
  /** Path to the OpenSpec directory */
  openspecPath: string;
  /** Prefix for spec IDs (default: "os") */
  specPrefix?: string;
  /** Prefix for change IDs (default: "osc") */
  changePrefix?: string;
  /** Include archived changes in tracking (default: true) */
  trackArchived?: boolean;
  /** Debounce interval in milliseconds (default: 100) */
  debounceMs?: number;
}

/**
 * OpenSpecWatcher monitors the OpenSpec directory for changes
 *
 * Uses content hashing to detect actual changes vs just file touches.
 * This prevents false positives from atomic writes and other file operations.
 */
export class OpenSpecWatcher {
  private watcher: FSWatcher | null = null;
  private entityHashes: Map<string, string> = new Map();
  private callback: ChangeCallback | null = null;
  private isProcessing = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isRelevantFile: ((filePath: string) => boolean) | null = null;

  // Track pending archive moves to detect status changes vs delete+create
  private pendingArchiveMoves: Map<
    string,
    { changeName: string; timestamp: number }
  > = new Map();
  private readonly ARCHIVE_MOVE_WINDOW_MS = 500; // Time window to detect archive moves

  private readonly openspecPath: string;
  private readonly specPrefix: string;
  private readonly changePrefix: string;
  private readonly trackArchived: boolean;
  private readonly debounceMs: number;

  constructor(options: OpenSpecWatcherOptions) {
    this.openspecPath = options.openspecPath;
    this.specPrefix = options.specPrefix || DEFAULT_SPEC_PREFIX;
    this.changePrefix = options.changePrefix || DEFAULT_CHANGE_PREFIX;
    this.trackArchived = options.trackArchived !== false;
    this.debounceMs = options.debounceMs ?? 100;
  }

  /**
   * Update the cached hash for a specific entity after we wrote to it.
   * This prevents the watcher from detecting our own writes as changes.
   */
  updateEntityHash(entityId: string, hash: string): void {
    console.log(
      `[openspec-watcher] Updated hash for ${entityId} after outbound write`
    );
    this.entityHashes.set(entityId, hash);
  }

  /**
   * Remove an entity from the hash cache (after deletion)
   */
  removeEntityHash(entityId: string): void {
    console.log(
      `[openspec-watcher] Removed hash for ${entityId} after outbound delete`
    );
    this.entityHashes.delete(entityId);
  }

  /**
   * Start watching for changes
   *
   * @param callback - Function to call when changes are detected
   */
  start(callback: ChangeCallback): void {
    if (this.watcher) {
      console.warn("[openspec-watcher] Already watching");
      return;
    }

    this.callback = callback;

    // Capture initial state
    this.captureState();

    // Watch paths - use directories for better compatibility with chokidar v4
    const watchPaths: string[] = [];

    // Watch specs directory
    const specsDir = path.join(this.openspecPath, "specs");
    if (existsSync(specsDir)) {
      watchPaths.push(specsDir);
    }

    // Watch changes directory
    const changesDir = path.join(this.openspecPath, "changes");
    if (existsSync(changesDir)) {
      watchPaths.push(changesDir);
    }

    if (watchPaths.length === 0) {
      console.warn("[openspec-watcher] No paths to watch");
      return;
    }

    console.log(`[openspec-watcher] Watching paths:`, watchPaths);

    // Filter function to only process relevant files
    const isRelevantFile = (filePath: string): boolean => {
      const ext = path.extname(filePath).toLowerCase();

      // Only watch .md files
      if (ext !== ".md") {
        return false;
      }

      // Check if it's in specs/ directory
      const relativePath = path.relative(this.openspecPath, filePath);
      if (relativePath.startsWith("specs" + path.sep)) {
        return true;
      }

      // Check if it's in changes/ directory
      if (relativePath.startsWith("changes" + path.sep)) {
        const fileName = path.basename(filePath);

        // Watch proposal.md, tasks.md, design.md in change directories
        if (["proposal.md", "tasks.md", "design.md"].includes(fileName)) {
          return true;
        }

        // Watch spec.md files in changes/[name]/specs/[cap]/spec.md (proposed specs)
        if (fileName === "spec.md" && relativePath.includes(path.sep + "specs" + path.sep)) {
          return true;
        }
      }

      return false;
    };

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.debounceMs,
        pollInterval: 50,
      },
    });

    // Store file filter for use in handlers
    this.isRelevantFile = isRelevantFile;

    this.watcher.on("ready", () => {
      const watched = this.watcher?.getWatched() || {};
      const dirs = Object.keys(watched);
      console.log(
        `[openspec-watcher] Ready, watching ${dirs.length} directories in ${this.openspecPath}`
      );
    });

    this.watcher.on("change", (filePath) => this.handleFileChange(filePath));
    this.watcher.on("add", (filePath) => this.handleFileChange(filePath));
    this.watcher.on("unlink", (filePath) => this.handleFileDeleted(filePath));

    // Watch for directory events to detect archive moves
    this.watcher.on("addDir", (dirPath) => this.handleDirectoryAdded(dirPath));
    this.watcher.on("unlinkDir", (dirPath) =>
      this.handleDirectoryRemoved(dirPath)
    );

    this.watcher.on("error", (error) => {
      console.error("[openspec-watcher] Error:", error);
    });

    console.log(
      `[openspec-watcher] Setting up watcher for ${this.openspecPath}...`
    );
  }

  /**
   * Stop watching for changes
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.callback = null;
      console.log("[openspec-watcher] Stopped");
    }
  }

  /**
   * Check if watcher is active
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Handle file change event
   */
  private handleFileChange(filePath: string): void {
    // Filter out non-relevant files
    if (this.isRelevantFile && !this.isRelevantFile(filePath)) {
      return;
    }
    console.log(`[openspec-watcher] File changed: ${filePath}`);
    this.scheduleProcessChanges();
  }

  /**
   * Handle file deleted event
   */
  private handleFileDeleted(filePath: string): void {
    // Filter out non-relevant files
    if (this.isRelevantFile && !this.isRelevantFile(filePath)) {
      return;
    }
    console.log(`[openspec-watcher] File deleted: ${filePath}`);
    this.scheduleProcessChanges();
  }

  /**
   * Handle directory added event
   * Used to detect archive moves (change moved to archive/)
   */
  private handleDirectoryAdded(dirPath: string): void {
    const relativePath = path.relative(this.openspecPath, dirPath);

    // Check if this is a new directory in changes/archive/
    if (
      relativePath.startsWith("changes" + path.sep + "archive" + path.sep) &&
      isChangeDirectory(dirPath)
    ) {
      const changeName = this.extractChangeNameFromArchive(dirPath);
      if (changeName) {
        console.log(
          `[openspec-watcher] Archive directory added: ${dirPath} (change: ${changeName})`
        );

        // Check if we have a pending removal for this change
        const pendingKey = changeName;
        const pending = this.pendingArchiveMoves.get(pendingKey);
        const now = Date.now();

        if (pending && now - pending.timestamp < this.ARCHIVE_MOVE_WINDOW_MS) {
          // This is an archive move, not a delete+create
          console.log(
            `[openspec-watcher] Detected archive move for change: ${changeName}`
          );
          this.pendingArchiveMoves.delete(pendingKey);
        }

        this.scheduleProcessChanges();
      }
    }
  }

  /**
   * Handle directory removed event
   * Used to detect archive moves (change moved from changes/)
   */
  private handleDirectoryRemoved(dirPath: string): void {
    const relativePath = path.relative(this.openspecPath, dirPath);

    // Check if this is a removed directory in changes/ (not archive/)
    if (
      relativePath.startsWith("changes" + path.sep) &&
      !relativePath.includes(path.sep + "archive" + path.sep)
    ) {
      const changeName = path.basename(dirPath);

      // Don't track removal of the archive directory itself
      if (changeName === "archive") {
        return;
      }

      console.log(
        `[openspec-watcher] Change directory removed: ${dirPath} (change: ${changeName})`
      );

      // Track as potential archive move
      this.pendingArchiveMoves.set(changeName, {
        changeName,
        timestamp: Date.now(),
      });

      // Clean up old pending moves
      this.cleanupPendingArchiveMoves();

      this.scheduleProcessChanges();
    }
  }

  /**
   * Extract change name from an archive directory path
   * Archive pattern: changes/archive/YYYY-MM-DD-name/ or changes/archive/name/
   */
  private extractChangeNameFromArchive(dirPath: string): string | null {
    const dirName = path.basename(dirPath);

    // Match YYYY-MM-DD-name pattern
    const dateMatch = dirName.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
    if (dateMatch) {
      return dateMatch[1];
    }

    // Otherwise, the directory name is the change name
    return dirName;
  }

  /**
   * Clean up old pending archive move entries
   */
  private cleanupPendingArchiveMoves(): void {
    const now = Date.now();
    for (const [key, value] of this.pendingArchiveMoves) {
      if (now - value.timestamp > this.ARCHIVE_MOVE_WINDOW_MS * 2) {
        this.pendingArchiveMoves.delete(key);
      }
    }
  }

  /**
   * Schedule change processing with debouncing
   */
  private scheduleProcessChanges(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processChanges();
    }, this.debounceMs);
  }

  /**
   * Process changes by comparing current state to cached hashes
   */
  private processChanges(): void {
    // Prevent concurrent processing
    if (this.isProcessing) {
      console.log("[openspec-watcher] Already processing, scheduling retry");
      this.scheduleProcessChanges();
      return;
    }

    this.isProcessing = true;

    try {
      const changes = this.detectChanges();

      if (changes.length > 0) {
        console.log(
          `[openspec-watcher] Detected ${changes.length} entity change(s):`,
          changes.map((c) => `${c.change_type}:${c.entity_id}`).join(", ")
        );
        if (this.callback) {
          this.callback(changes);
        }
      } else {
        console.log(
          "[openspec-watcher] No actual content changes (hashes match)"
        );
      }
    } catch (error) {
      console.error("[openspec-watcher] Error processing changes:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Capture current state (entity hashes) for comparison
   */
  captureState(): void {
    console.log("[openspec-watcher] Capturing initial state...");
    const entities = this.scanAllEntities();

    this.entityHashes.clear();
    for (const entity of entities) {
      const hash = this.computeEntityHash(entity);
      this.entityHashes.set(entity.id, hash);
    }
    console.log(
      `[openspec-watcher] Captured state with ${this.entityHashes.size} entities`
    );
  }

  /**
   * Detect changes by comparing current state to cached state
   */
  private detectChanges(): ExternalChange[] {
    const currentEntities = this.scanAllEntities();
    const changes: ExternalChange[] = [];
    const now = new Date().toISOString();
    const currentIds = new Set<string>();

    // Check for created and updated entities
    for (const entity of currentEntities) {
      currentIds.add(entity.id);
      const newHash = this.computeEntityHash(entity);
      const cachedHash = this.entityHashes.get(entity.id);

      if (!cachedHash) {
        // New entity
        changes.push({
          entity_id: entity.id,
          entity_type: entity.type,
          change_type: "created",
          timestamp: entity.created_at || now,
          data: entity,
        });
        this.entityHashes.set(entity.id, newHash);
      } else if (newHash !== cachedHash) {
        // Updated entity
        changes.push({
          entity_id: entity.id,
          entity_type: entity.type,
          change_type: "updated",
          timestamp: entity.updated_at || now,
          data: entity,
        });
        this.entityHashes.set(entity.id, newHash);
      }
    }

    // Check for deleted entities
    for (const [id] of this.entityHashes) {
      if (!currentIds.has(id)) {
        // Determine entity type from ID
        const parsed = parseOpenSpecId(id);
        const entityType: "spec" | "issue" = parsed?.type === "change" ? "issue" : "spec";

        changes.push({
          entity_id: id,
          entity_type: entityType,
          change_type: "deleted",
          timestamp: now,
        });
        this.entityHashes.delete(id);
      }
    }

    return changes;
  }

  /**
   * Scan all entities in the OpenSpec directory
   * IMPORTANT: Returns specs FIRST, then issues to ensure proper relationship resolution
   */
  private scanAllEntities(): ExternalEntity[] {
    // IMPORTANT: We collect specs FIRST, then issues
    // This ensures specs exist before issues that reference them are synced
    const specEntities: ExternalEntity[] = [];
    const issueEntities: ExternalEntity[] = [];

    // Track which specs exist in openspec/specs/ (approved specs)
    const approvedSpecs = new Set<string>();

    // Scan specs directory
    const specsDir = path.join(this.openspecPath, "specs");
    if (existsSync(specsDir)) {
      try {
        const entries = readdirSync(specsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const specPath = path.join(specsDir, entry.name, "spec.md");
          if (!existsSync(specPath)) continue;

          approvedSpecs.add(entry.name);

          try {
            const spec = parseSpecFile(specPath);
            const specId = generateSpecId(entry.name, this.specPrefix);
            specEntities.push(this.specToExternalEntity(spec, specId));
          } catch (error) {
            console.error(
              `[openspec-watcher] Error parsing spec at ${specPath}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          "[openspec-watcher] Error scanning specs directory:",
          error
        );
      }
    }

    // Scan changes directory
    const changesDir = path.join(this.openspecPath, "changes");
    if (existsSync(changesDir)) {
      try {
        const changePaths = scanChangeDirectories(changesDir, this.trackArchived);

        for (const changePath of changePaths) {
          try {
            const change = parseChangeDirectory(changePath);
            const changeId = generateChangeId(change.name, this.changePrefix);
            issueEntities.push(this.changeToExternalEntity(change, changeId));

            // Scan for proposed specs inside this change
            // These are NEW specs in changes/[name]/specs/[cap]/spec.md
            const changeSpecsDir = path.join(changePath, "specs");
            if (existsSync(changeSpecsDir)) {
              const specDirEntries = readdirSync(changeSpecsDir, { withFileTypes: true });
              for (const specEntry of specDirEntries) {
                if (!specEntry.isDirectory()) continue;

                const proposedSpecPath = path.join(changeSpecsDir, specEntry.name, "spec.md");
                if (!existsSync(proposedSpecPath)) continue;

                // Only create a separate spec entity for NEW specs
                // (those not in openspec/specs/)
                const isNewSpec = !approvedSpecs.has(specEntry.name);
                if (isNewSpec) {
                  try {
                    const proposedSpec = parseSpecFile(proposedSpecPath);
                    const proposedSpecId = generateSpecId(specEntry.name, this.specPrefix);
                    // Add proposed specs to specEntities so they're synced before issues
                    specEntities.push(this.proposedSpecToExternalEntity(
                      proposedSpec,
                      proposedSpecId,
                      change.name
                    ));
                  } catch (error) {
                    console.error(
                      `[openspec-watcher] Error parsing proposed spec at ${proposedSpecPath}:`,
                      error
                    );
                  }
                }
              }
            }
          } catch (error) {
            console.error(
              `[openspec-watcher] Error parsing change at ${changePath}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          "[openspec-watcher] Error scanning changes directory:",
          error
        );
      }
    }

    // Return specs FIRST, then issues
    // This ensures specs are created before issues that implement them
    return [...specEntities, ...issueEntities];
  }

  /**
   * Compute a hash for an entity to detect changes
   */
  computeEntityHash(entity: ExternalEntity): string {
    const canonical = JSON.stringify({
      id: entity.id,
      type: entity.type,
      title: entity.title,
      description: entity.description,
      status: entity.status,
      priority: entity.priority,
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Convert a parsed OpenSpec spec to ExternalEntity
   */
  private specToExternalEntity(
    spec: ParsedOpenSpecSpec,
    id: string
  ): ExternalEntity {
    // Read raw file content for description
    let rawContent = spec.rawContent;
    try {
      rawContent = readFileSync(spec.filePath, "utf-8");
    } catch {
      // Fall back to parsed content
    }

    return {
      id,
      type: "spec",
      title: spec.title,
      description: rawContent,
      priority: 2, // Default priority
      raw: {
        capability: spec.capability,
        purpose: spec.purpose,
        requirements: spec.requirements,
        filePath: spec.filePath,
      },
    };
  }

  /**
   * Convert a proposed spec (from changes/[name]/specs/) to ExternalEntity
   *
   * Proposed specs are NEW specs that don't exist in openspec/specs/ yet.
   * They are marked with isProposed: true in the raw data.
   */
  private proposedSpecToExternalEntity(
    spec: ParsedOpenSpecSpec,
    id: string,
    changeName: string
  ): ExternalEntity {
    // Read raw file content for description
    let rawContent = spec.rawContent;
    try {
      rawContent = readFileSync(spec.filePath, "utf-8");
    } catch {
      // Fall back to parsed content
    }

    return {
      id,
      type: "spec",
      title: spec.title,
      description: rawContent,
      priority: 2,
      raw: {
        capability: spec.capability,
        purpose: spec.purpose,
        requirements: spec.requirements,
        filePath: spec.filePath,
        isProposed: true,
        proposedByChange: changeName,
      },
    };
  }

  /**
   * Convert a parsed OpenSpec change to ExternalEntity (as issue)
   *
   * Changes map to sudocode Issues:
   * - Archived changes → status: "closed"
   * - Active changes with 100% task completion → status: "needs_review"
   * - Active changes with progress → status: "in_progress"
   * - Active changes with no progress → status: "open"
   */
  private changeToExternalEntity(
    change: ParsedOpenSpecChange,
    id: string
  ): ExternalEntity {
    // Determine status based on archive and task completion
    let status: string;
    if (change.isArchived) {
      status = "closed";
    } else if (change.taskCompletion === 100) {
      status = "needs_review";
    } else if (change.taskCompletion > 0) {
      status = "in_progress";
    } else {
      status = "open";
    }

    // Build description from proposal content
    const descriptionParts: string[] = [];
    if (change.why) {
      descriptionParts.push(`## Why\n${change.why}`);
    }
    if (change.whatChanges) {
      descriptionParts.push(`## What Changes\n${change.whatChanges}`);
    }
    if (change.impact) {
      descriptionParts.push(`## Impact\n${change.impact}`);
    }

    // Add task summary
    if (change.tasks.length > 0) {
      const taskSummary = `## Tasks\n- ${change.tasks.length} total tasks\n- ${change.taskCompletion}% complete`;
      descriptionParts.push(taskSummary);
    }

    const description = descriptionParts.join("\n\n");

    // Build relationships from affected specs
    const relationships: ExternalEntity["relationships"] = change.affectedSpecs.map(
      (specCapability) => ({
        targetId: generateSpecId(specCapability, this.specPrefix),
        targetType: "spec" as const,
        relationshipType: "implements" as const,
      })
    );

    return {
      id,
      type: "issue",
      title: change.title,
      description,
      status,
      priority: change.isArchived ? 4 : 2, // Lower priority for archived
      created_at: change.archivedAt?.toISOString(),
      relationships: relationships.length > 0 ? relationships : undefined,
      raw: {
        name: change.name,
        why: change.why,
        whatChanges: change.whatChanges,
        impact: change.impact,
        tasks: change.tasks,
        taskCompletion: change.taskCompletion,
        affectedSpecs: change.affectedSpecs,
        isArchived: change.isArchived,
        archivedAt: change.archivedAt,
        filePath: change.filePath,
      },
    };
  }

  /**
   * Get current cached hashes (for testing/debugging)
   */
  getEntityHashes(): Map<string, string> {
    return new Map(this.entityHashes);
  }

  /**
   * Force refresh of cached state (useful after external sync)
   */
  refreshState(): void {
    this.captureState();
  }
}
