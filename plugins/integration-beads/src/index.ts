/**
 * Beads Integration Plugin for sudocode
 *
 * Provides integration with Beads - a local file-based issue tracking format.
 * Beads stores issues in a .beads directory with JSONL files similar to sudocode.
 */

import type {
  IntegrationPlugin,
  IntegrationProvider,
  PluginValidationResult,
  PluginTestResult,
  PluginConfigSchema,
  ExternalEntity,
  ExternalChange,
  Spec,
  Issue,
} from "@sudocode-ai/types";
import { existsSync, readFileSync } from "fs";
import * as path from "path";

// Internal utilities
import { computeCanonicalHash } from "./hash-utils.js";
import {
  readBeadsJSONL,
  createIssueViaJSONL,
  updateIssueViaJSONL,
  deleteIssueViaJSONL,
  type BeadsIssue,
} from "./jsonl-utils.js";
import {
  isBeadsCLIAvailable,
  createIssueViaCLI,
  closeIssueViaCLI,
} from "./cli-utils.js";
import { BeadsWatcher, type ChangeCallback } from "./watcher.js";

/**
 * Beads-specific configuration options
 */
export interface BeadsOptions {
  /** Path to the .beads directory (relative to project root) */
  path: string;
  /** Prefix for issue IDs imported from beads (default: "bd") */
  issue_prefix?: string;
}

/**
 * Beads integration plugin
 */
const beadsPlugin: IntegrationPlugin = {
  name: "beads",
  displayName: "Beads",
  version: "0.1.0",
  description: "Integration with Beads local file-based issue tracking",

  configSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        title: "Beads Path",
        description: "Path to the .beads directory (relative to project root)",
        default: ".beads",
        required: true,
      },
      issue_prefix: {
        type: "string",
        title: "Issue Prefix",
        description: "Prefix for issue IDs imported from beads",
        default: "bd",
      },
    },
    required: ["path"],
  },

  validateConfig(options: Record<string, unknown>): PluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required path field
    if (!options.path || typeof options.path !== "string") {
      errors.push("beads.options.path is required");
    }

    // Validate issue_prefix if provided
    if (options.issue_prefix !== undefined) {
      if (typeof options.issue_prefix !== "string") {
        errors.push("beads.options.issue_prefix must be a string");
      } else if (!/^[a-z]{1,4}$/i.test(options.issue_prefix)) {
        warnings.push(
          "beads.options.issue_prefix should be 1-4 alphabetic characters"
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  async testConnection(
    options: Record<string, unknown>,
    projectPath: string
  ): Promise<PluginTestResult> {
    const beadsPath = options.path as string;

    if (!beadsPath) {
      return {
        success: false,
        configured: true,
        enabled: true,
        error: "Beads path is not configured",
      };
    }

    const resolvedPath = path.resolve(projectPath, beadsPath);

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        configured: true,
        enabled: true,
        error: `Beads directory not found: ${resolvedPath}`,
        details: { path: beadsPath, resolvedPath },
      };
    }

    // Check for issues.jsonl in beads directory
    const issuesPath = path.join(resolvedPath, "issues.jsonl");
    const hasIssues = existsSync(issuesPath);

    // Try to count issues if file exists
    let issueCount = 0;
    if (hasIssues) {
      try {
        const content = readFileSync(issuesPath, "utf-8");
        issueCount = content.split("\n").filter((line) => line.trim()).length;
      } catch {
        // Ignore read errors
      }
    }

    return {
      success: true,
      configured: true,
      enabled: true,
      details: {
        path: beadsPath,
        resolvedPath,
        hasIssuesFile: hasIssues,
        issueCount,
      },
    };
  },

  createProvider(
    options: Record<string, unknown>,
    projectPath: string
  ): IntegrationProvider {
    return new BeadsProvider(options as unknown as BeadsOptions, projectPath);
  },
};

/**
 * Beads provider implementation
 */
class BeadsProvider implements IntegrationProvider {
  readonly name = "beads";
  readonly supportsWatch = true;
  readonly supportsPolling = true;
  readonly supportsOnDemandImport = false;
  readonly supportsSearch = false;
  readonly supportsPush = false;

  private options: BeadsOptions;
  private projectPath: string;
  private resolvedPath: string;

  // CLI detection (cached)
  private cliAvailable: boolean = false;

  // Change tracking for getChangesSince
  private entityHashes: Map<string, string> = new Map();
  private lastCaptureTime: Date = new Date(0);

  // File watcher
  private beadsWatcher: BeadsWatcher | null = null;

  constructor(options: BeadsOptions, projectPath: string) {
    this.options = options;
    this.projectPath = projectPath;
    this.resolvedPath = path.resolve(projectPath, options.path);
  }

  async initialize(_config?: unknown): Promise<void> {
    console.log(`[beads] Initializing provider for path: ${this.resolvedPath}`);

    if (!existsSync(this.resolvedPath)) {
      throw new Error(`Beads directory not found: ${this.resolvedPath}`);
    }

    // Check CLI availability
    this.cliAvailable = isBeadsCLIAvailable();
    console.log(`[beads] CLI available: ${this.cliAvailable}`);

    // Capture initial state for change detection
    this.captureEntityState();
    console.log(`[beads] Captured initial state with ${this.entityHashes.size} entities`);
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!existsSync(this.resolvedPath)) {
      errors.push(`Beads directory not found: ${this.resolvedPath}`);
    }

    const issuesPath = path.join(this.resolvedPath, "issues.jsonl");
    if (!existsSync(issuesPath)) {
      // Not an error - file might not exist yet
      console.log(`[beads] Note: issues.jsonl does not exist yet at ${issuesPath}`);
    }

    const valid = errors.length === 0;
    console.log(`[beads] Validation result: valid=${valid}, errors=${errors.length}`);
    return { valid, errors };
  }

  async dispose(): Promise<void> {
    console.log(`[beads] Disposing provider`);
    // Stop watcher if running
    this.stopWatching();
  }

  parseExternalId(id: string): { provider: string; id: string } {
    // Handle "beads:xxx" format or just "xxx"
    if (id.startsWith("beads:")) {
      return { provider: "beads", id: id.substring(6) };
    }
    return { provider: "beads", id };
  }

  formatExternalId(id: string): string {
    return `beads:${id}`;
  }

  /**
   * Capture current entity state for change detection
   */
  private captureEntityState(): void {
    const issues = readBeadsJSONL(
      path.join(this.resolvedPath, "issues.jsonl"),
      { skipErrors: true }
    );

    this.entityHashes.clear();
    for (const issue of issues) {
      const hash = computeCanonicalHash(issue);
      this.entityHashes.set(issue.id, hash);
    }
    this.lastCaptureTime = new Date();
  }

  async fetchEntity(externalId: string): Promise<ExternalEntity | null> {
    const issuesPath = path.join(this.resolvedPath, "issues.jsonl");
    if (!existsSync(issuesPath)) {
      return null;
    }

    try {
      const content = readFileSync(issuesPath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        const issue = JSON.parse(line);
        if (issue.id === externalId) {
          return this.beadsToExternal(issue);
        }
      }
    } catch {
      // Ignore parse errors
    }

    return null;
  }

  async searchEntities(query?: string): Promise<ExternalEntity[]> {
    const issuesPath = path.join(this.resolvedPath, "issues.jsonl");
    if (!existsSync(issuesPath)) {
      return [];
    }

    try {
      const content = readFileSync(issuesPath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());
      const entities: ExternalEntity[] = [];

      for (const line of lines) {
        try {
          const issue = JSON.parse(line);
          const entity = this.beadsToExternal(issue);

          // Filter by query if provided
          if (query) {
            const lowerQuery = query.toLowerCase();
            if (
              entity.title.toLowerCase().includes(lowerQuery) ||
              entity.description?.toLowerCase().includes(lowerQuery)
            ) {
              entities.push(entity);
            }
          } else {
            entities.push(entity);
          }
        } catch {
          // Skip invalid lines
        }
      }

      return entities;
    } catch {
      return [];
    }
  }

  async createEntity(entity: Partial<Spec | Issue>): Promise<string> {
    const prefix = this.options.issue_prefix || "beads";

    if (this.cliAvailable) {
      // Use Beads CLI for creation
      try {
        const id = createIssueViaCLI(this.projectPath, entity.title || "Untitled", {
          priority: entity.priority,
          beadsDir: this.resolvedPath,
        });

        // CLI create doesn't support content or status - update via JSONL if provided
        // Note: sudocode uses 'content', beads uses 'description'
        const issueEntity = entity as Partial<Issue>;
        if (entity.content || issueEntity.status) {
          updateIssueViaJSONL(this.resolvedPath, id, {
            ...(entity.content ? { description: entity.content } : {}),  // Map content → description
            ...(issueEntity.status ? { status: issueEntity.status } : {}),
          });
        }

        // Read back and update watcher hash
        this.updateWatcherHashForEntity(id);

        // Refresh state after creation
        this.captureEntityState();
        return id;
      } catch (cliError) {
        // Fall back to JSONL if CLI fails
        console.warn("[beads] CLI create failed, falling back to JSONL:", cliError);
      }
    }

    // Fallback: Direct JSONL manipulation
    // Note: sudocode uses 'content', beads uses 'description'
    const issueEntity = entity as Partial<Issue>;
    const newIssue = createIssueViaJSONL(this.resolvedPath, {
      title: entity.title,
      description: entity.content,  // Map content → description
      status: issueEntity.status || "open",
      priority: entity.priority ?? 2,
    }, prefix);

    // Update watcher hash so it won't detect our create as a change
    if (this.beadsWatcher) {
      this.beadsWatcher.updateEntityHash(newIssue.id, newIssue);
    }

    // Refresh state after creation
    this.captureEntityState();
    return newIssue.id;
  }

  /**
   * Helper to update watcher hash for an entity after writing
   */
  private updateWatcherHashForEntity(entityId: string): void {
    if (!this.beadsWatcher) return;

    const issues = readBeadsJSONL(
      path.join(this.resolvedPath, "issues.jsonl"),
      { skipErrors: true }
    );
    const entity = issues.find(i => i.id === entityId);
    if (entity) {
      this.beadsWatcher.updateEntityHash(entityId, entity);
    }
  }

  async updateEntity(
    externalId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void> {
    console.log(`[beads] updateEntity called for ${externalId}:`, JSON.stringify(entity));

    // Always use direct JSONL for updates (Beads CLI may not have update command)
    // Only include defined fields to avoid overwriting existing values with undefined
    // Note: sudocode uses 'content', beads uses 'description'
    const issueEntity = entity as Partial<Issue>;
    const updates: Partial<BeadsIssue> = {};

    if (entity.title !== undefined) updates.title = entity.title;
    if (entity.content !== undefined) updates.description = entity.content;  // Map content → description
    if (issueEntity.status !== undefined) updates.status = issueEntity.status;
    if (entity.priority !== undefined) updates.priority = entity.priority;

    console.log(`[beads] Writing updates to beads:`, JSON.stringify(updates));
    updateIssueViaJSONL(this.resolvedPath, externalId, updates);

    // Read back the updated entity to get the full content with new updated_at
    const updatedIssues = readBeadsJSONL(
      path.join(this.resolvedPath, "issues.jsonl"),
      { skipErrors: true }
    );
    const updatedEntity = updatedIssues.find(i => i.id === externalId);

    // Update watcher's hash cache so it won't detect our write as a change
    if (this.beadsWatcher && updatedEntity) {
      this.beadsWatcher.updateEntityHash(externalId, updatedEntity);
    }

    // Refresh provider state after update
    this.captureEntityState();
  }

  async deleteEntity(externalId: string): Promise<void> {
    // Always use JSONL for hard delete - CLI 'close' only changes status
    // This ensures the entity is actually removed from the file
    deleteIssueViaJSONL(this.resolvedPath, externalId);

    // Remove from watcher's hash cache so it won't detect our delete as a change
    if (this.beadsWatcher) {
      this.beadsWatcher.removeEntityHash(externalId);
    }

    this.captureEntityState();
  }

  async getChangesSince(timestamp: Date): Promise<ExternalChange[]> {
    const issues = readBeadsJSONL(
      path.join(this.resolvedPath, "issues.jsonl"),
      { skipErrors: true }
    );

    const changes: ExternalChange[] = [];
    const currentIds = new Set<string>();

    // Check for created and updated entities
    for (const issue of issues) {
      currentIds.add(issue.id);
      const newHash = computeCanonicalHash(issue);
      const cachedHash = this.entityHashes.get(issue.id);

      // Check if entity was modified after the timestamp
      const entityUpdatedAt = issue.updated_at ? new Date(issue.updated_at) : new Date();

      if (!cachedHash) {
        // New entity
        if (entityUpdatedAt >= timestamp) {
          changes.push({
            entity_id: issue.id,
            entity_type: "issue",
            change_type: "created",
            timestamp: issue.created_at || new Date().toISOString(),
            data: this.beadsToExternal(issue),
          });
        }
        this.entityHashes.set(issue.id, newHash);
      } else if (newHash !== cachedHash) {
        // Updated entity
        if (entityUpdatedAt >= timestamp) {
          changes.push({
            entity_id: issue.id,
            entity_type: "issue",
            change_type: "updated",
            timestamp: issue.updated_at || new Date().toISOString(),
            data: this.beadsToExternal(issue),
          });
        }
        this.entityHashes.set(issue.id, newHash);
      }
    }

    // Check for deleted entities
    const now = new Date().toISOString();
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

  // =========================================================================
  // Real-time Watching
  // =========================================================================

  startWatching(callback: (changes: ExternalChange[]) => void): void {
    console.log(`[beads] startWatching called for path: ${this.resolvedPath}`);

    if (this.beadsWatcher) {
      console.warn("[beads] Already watching");
      return;
    }

    this.beadsWatcher = new BeadsWatcher(this.resolvedPath);
    this.beadsWatcher.start((changes) => {
      console.log(`[beads] Watcher detected ${changes.length} change(s), forwarding to coordinator`);
      callback(changes);
    });
    console.log("[beads] Watcher started successfully");
  }

  stopWatching(): void {
    console.log("[beads] stopWatching called");
    if (this.beadsWatcher) {
      this.beadsWatcher.stop();
      this.beadsWatcher = null;
    }
  }

  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  } {
    if (external.type === "issue") {
      return {
        issue: {
          title: external.title,
          content: external.description || "",
          priority: external.priority ?? 2,
          status: this.mapStatus(external.status),
        },
      };
    }

    return {
      spec: {
        title: external.title,
        content: external.description || "",
        priority: external.priority ?? 2,
      },
    };
  }

  mapFromSudocode(entity: Spec | Issue): Partial<ExternalEntity> {
    const isIssue = "status" in entity;

    return {
      type: isIssue ? "issue" : "spec",
      title: entity.title,
      description: entity.content,
      priority: entity.priority,
      status: isIssue ? (entity as Issue).status : undefined,
    };
  }

  private beadsToExternal(beadsIssue: Record<string, unknown>): ExternalEntity {
    return {
      id: beadsIssue.id as string,
      type: "issue",
      title: (beadsIssue.title as string) || "",
      description: beadsIssue.description as string,  // Beads uses 'description'
      status: beadsIssue.status as string,
      priority: beadsIssue.priority as number,
      created_at: beadsIssue.created_at as string,
      updated_at: beadsIssue.updated_at as string,
      raw: beadsIssue,
    };
  }

  private mapStatus(
    externalStatus?: string
  ): "open" | "in_progress" | "blocked" | "needs_review" | "closed" {
    if (!externalStatus) return "open";

    const statusMap: Record<
      string,
      "open" | "in_progress" | "blocked" | "needs_review" | "closed"
    > = {
      open: "open",
      in_progress: "in_progress",
      blocked: "blocked",
      needs_review: "needs_review",
      closed: "closed",
      done: "closed",
      completed: "closed",
    };

    return statusMap[externalStatus.toLowerCase()] || "open";
  }
}

export default beadsPlugin;
