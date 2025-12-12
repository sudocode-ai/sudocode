/**
 * File watcher for Beads integration
 *
 * Watches the .beads/issues.jsonl file for changes and detects
 * which entities were created, updated, or deleted.
 */

import chokidar, { type FSWatcher } from "chokidar";
import * as path from "path";
import type { ExternalChange } from "@sudocode-ai/types";
import { computeCanonicalHash } from "./hash-utils.js";
import { readBeadsJSONL, type BeadsIssue } from "./jsonl-utils.js";

/**
 * Callback type for change notifications
 */
export type ChangeCallback = (changes: ExternalChange[]) => void;

/**
 * BeadsWatcher monitors .beads/issues.jsonl for changes
 *
 * Uses content hashing to detect actual changes vs just file touches.
 * This prevents false positives from atomic writes and other file operations.
 */
export class BeadsWatcher {
  private watcher: FSWatcher | null = null;
  private entityHashes: Map<string, string> = new Map();
  private beadsDir: string;
  private callback: ChangeCallback | null = null;
  private isProcessing = false;

  constructor(beadsDir: string) {
    this.beadsDir = beadsDir;
  }

  /**
   * Update the cached hash for a specific entity after we wrote to it.
   * This prevents the watcher from detecting our own writes as changes.
   */
  updateEntityHash(entityId: string, entity: BeadsIssue): void {
    const hash = computeCanonicalHash(entity);
    console.log(`[beads-watcher] Updated hash for ${entityId} after outbound write`);
    this.entityHashes.set(entityId, hash);
  }

  /**
   * Remove an entity from the hash cache (after deletion)
   */
  removeEntityHash(entityId: string): void {
    console.log(`[beads-watcher] Removed hash for ${entityId} after outbound delete`);
    this.entityHashes.delete(entityId);
  }

  /**
   * Start watching for changes
   *
   * @param callback - Function to call when changes are detected
   */
  start(callback: ChangeCallback): void {
    if (this.watcher) {
      console.warn("[beads-watcher] Already watching");
      return;
    }

    this.callback = callback;
    const issuesPath = path.join(this.beadsDir, "issues.jsonl");

    // Capture initial state
    this.captureState();

    this.watcher = chokidar.watch(issuesPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for writes to settle
        pollInterval: 50,
      },
    });

    this.watcher.on("change", () => this.handleFileChange());
    this.watcher.on("add", () => this.handleFileChange());
    this.watcher.on("unlink", () => this.handleFileDeleted());

    this.watcher.on("error", (error) => {
      console.error("[beads-watcher] Error:", error);
    });

    console.log(`[beads-watcher] Started watching ${issuesPath}`);
  }

  /**
   * Stop watching for changes
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.callback = null;
      console.log("[beads-watcher] Stopped");
    }
  }

  /**
   * Check if watcher is active
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Capture current state (entity hashes) for comparison
   */
  private captureState(): void {
    const issues = readBeadsJSONL(
      path.join(this.beadsDir, "issues.jsonl"),
      { skipErrors: true }
    );

    this.entityHashes.clear();
    for (const issue of issues) {
      const hash = computeCanonicalHash(issue);
      this.entityHashes.set(issue.id, hash);
    }
  }

  /**
   * Handle file change event
   */
  private handleFileChange(): void {
    console.log("[beads-watcher] File change detected");

    // Prevent concurrent processing
    if (this.isProcessing) {
      console.log("[beads-watcher] Already processing, skipping");
      return;
    }

    this.isProcessing = true;

    try {
      const changes = this.detectChanges();
      console.log(`[beads-watcher] Detected ${changes.length} change(s) (content-based comparison)`);
      if (changes.length > 0) {
        for (const change of changes) {
          console.log(`[beads-watcher]   - ${change.change_type}: ${change.entity_id}`);
        }
        if (this.callback) {
          console.log("[beads-watcher] Invoking callback");
          this.callback(changes);
        } else {
          console.log("[beads-watcher] No callback registered!");
        }
      } else {
        console.log("[beads-watcher] No actual content changes (hashes match)");
      }
    } catch (error) {
      console.error("[beads-watcher] Error processing changes:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle file deleted event
   */
  private handleFileDeleted(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // All entities are deleted
      const changes: ExternalChange[] = [];
      const now = new Date().toISOString();

      for (const [id] of this.entityHashes) {
        changes.push({
          entity_id: id,
          entity_type: "issue",
          change_type: "deleted",
          timestamp: now,
        });
      }

      this.entityHashes.clear();

      if (changes.length > 0 && this.callback) {
        this.callback(changes);
      }
    } catch (error) {
      console.error("[beads-watcher] Error processing deletion:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Detect changes by comparing current state to cached state
   *
   * @returns Array of detected changes
   */
  private detectChanges(): ExternalChange[] {
    const issues = readBeadsJSONL(
      path.join(this.beadsDir, "issues.jsonl"),
      { skipErrors: true }
    );

    const changes: ExternalChange[] = [];
    const now = new Date().toISOString();
    const currentIds = new Set<string>();

    // Check for created and updated entities
    for (const issue of issues) {
      currentIds.add(issue.id);
      const newHash = computeCanonicalHash(issue);
      const cachedHash = this.entityHashes.get(issue.id);

      if (!cachedHash) {
        // New entity
        changes.push({
          entity_id: issue.id,
          entity_type: "issue",
          change_type: "created",
          timestamp: issue.created_at || now,
          data: this.issueToExternalEntity(issue),
        });
        this.entityHashes.set(issue.id, newHash);
      } else if (newHash !== cachedHash) {
        // Updated entity
        changes.push({
          entity_id: issue.id,
          entity_type: "issue",
          change_type: "updated",
          timestamp: issue.updated_at || now,
          data: this.issueToExternalEntity(issue),
        });
        this.entityHashes.set(issue.id, newHash);
      }
      // If hashes match, no change
    }

    // Check for deleted entities
    for (const [id] of this.entityHashes) {
      if (!currentIds.has(id)) {
        changes.push({
          entity_id: id,
          entity_type: "issue",
          change_type: "deleted",
          timestamp: now,
        });
        this.entityHashes.delete(id);
      }
    }

    return changes;
  }

  /**
   * Convert BeadsIssue to ExternalEntity format
   * Note: Beads uses 'description', which maps to ExternalEntity.description
   */
  private issueToExternalEntity(issue: BeadsIssue): ExternalChange["data"] {
    return {
      id: issue.id,
      type: "issue" as const,
      title: issue.title || "",
      description: issue.description || "",  // Beads uses 'description'
      status: issue.status,
      priority: issue.priority,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      raw: issue,
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
