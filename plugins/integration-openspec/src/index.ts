/**
 * OpenSpec Integration Plugin for sudocode
 *
 * Provides integration with OpenSpec - a standardized specification format
 * for AI-assisted development. Syncs specs and issues to sudocode.
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
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";

// Import parsers
import {
  parseSpecFile,
  type ParsedOpenSpecSpec,
} from "./parser/spec-parser.js";
import {
  parseChangeDirectory,
  scanChangeDirectories,
  type ParsedOpenSpecChange,
} from "./parser/change-parser.js";
import { generateSpecId, generateChangeId, parseOpenSpecId } from "./id-generator.js";
import { OpenSpecWatcher, type ChangeCallback } from "./watcher.js";

// Import writers for bidirectional sync
import { updateAllTasksCompletion, updateSpecContent } from "./writer/index.js";

/**
 * OpenSpec specific configuration options
 */
export interface OpenSpecOptions {
  /** Path to the OpenSpec directory (relative to project root) */
  path: string;
  /** Prefix for spec IDs imported from OpenSpec (default: "os") */
  spec_prefix?: string;
  /** Prefix for issue IDs imported from OpenSpec (default: "osi") */
  issue_prefix?: string;
}

/**
 * Configuration schema for UI form generation
 */
const configSchema: PluginConfigSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      title: "OpenSpec Path",
      description: "Path to the OpenSpec directory (relative to project root)",
      default: ".openspec",
      required: true,
    },
    spec_prefix: {
      type: "string",
      title: "Spec Prefix",
      description: "Prefix for spec IDs imported from OpenSpec",
      default: "os",
    },
    issue_prefix: {
      type: "string",
      title: "Issue Prefix",
      description: "Prefix for issue IDs imported from OpenSpec",
      default: "osi",
    },
  },
  required: ["path"],
};

/**
 * OpenSpec integration plugin
 */
const openSpecPlugin: IntegrationPlugin = {
  name: "openspec",
  displayName: "OpenSpec",
  version: "0.1.0",
  description: "Integration with OpenSpec standardized specification format",

  configSchema,

  validateConfig(options: Record<string, unknown>): PluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required path field
    if (!options.path || typeof options.path !== "string") {
      errors.push("openspec.options.path is required");
    }

    // Validate spec_prefix if provided
    if (options.spec_prefix !== undefined) {
      if (typeof options.spec_prefix !== "string") {
        errors.push("openspec.options.spec_prefix must be a string");
      } else if (!/^[a-z]{1,4}$/i.test(options.spec_prefix)) {
        warnings.push(
          "openspec.options.spec_prefix should be 1-4 alphabetic characters"
        );
      }
    }

    // Validate issue_prefix if provided
    if (options.issue_prefix !== undefined) {
      if (typeof options.issue_prefix !== "string") {
        errors.push("openspec.options.issue_prefix must be a string");
      } else if (!/^[a-z]{1,4}$/i.test(options.issue_prefix)) {
        warnings.push(
          "openspec.options.issue_prefix should be 1-4 alphabetic characters"
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
    const openSpecPath = options.path as string;

    if (!openSpecPath) {
      return {
        success: false,
        configured: true,
        enabled: true,
        error: "OpenSpec path is not configured",
      };
    }

    const resolvedPath = path.resolve(projectPath, openSpecPath);

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        configured: true,
        enabled: true,
        error: `OpenSpec directory not found: ${resolvedPath}`,
        details: { path: openSpecPath, resolvedPath },
      };
    }

    return {
      success: true,
      configured: true,
      enabled: true,
      details: {
        path: openSpecPath,
        resolvedPath,
      },
    };
  },

  createProvider(
    options: Record<string, unknown>,
    projectPath: string
  ): IntegrationProvider {
    return new OpenSpecProvider(
      options as unknown as OpenSpecOptions,
      projectPath
    );
  },
};

/**
 * OpenSpec provider implementation
 */
class OpenSpecProvider implements IntegrationProvider {
  readonly name = "openspec";
  readonly supportsWatch = true;
  readonly supportsPolling = true;
  readonly supportsOnDemandImport = false;
  readonly supportsSearch = false;
  readonly supportsPush = false;

  private options: OpenSpecOptions;
  private projectPath: string;
  private resolvedPath: string;

  // Change tracking for getChangesSince
  private entityHashes: Map<string, string> = new Map();

  // File watcher instance
  private watcher: OpenSpecWatcher | null = null;

  constructor(options: OpenSpecOptions, projectPath: string) {
    this.options = options;
    this.projectPath = projectPath;
    this.resolvedPath = path.resolve(projectPath, options.path);
  }

  async initialize(): Promise<void> {
    console.log(
      `[openspec] Initializing provider for path: ${this.resolvedPath}`
    );

    if (!existsSync(this.resolvedPath)) {
      throw new Error(`OpenSpec directory not found: ${this.resolvedPath}`);
    }

    console.log(`[openspec] Provider initialized successfully`);
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!existsSync(this.resolvedPath)) {
      errors.push(`OpenSpec directory not found: ${this.resolvedPath}`);
      return { valid: false, errors };
    }

    const valid = errors.length === 0;
    console.log(
      `[openspec] Validation result: valid=${valid}, errors=${errors.length}`
    );
    return { valid, errors };
  }

  async dispose(): Promise<void> {
    console.log(`[openspec] Disposing provider`);
    this.stopWatching();
    this.entityHashes.clear();
    console.log(`[openspec] Provider disposed successfully`);
  }

  async fetchEntity(externalId: string): Promise<ExternalEntity | null> {
    console.log(`[openspec] fetchEntity called for: ${externalId}`);

    // Parse the external ID to determine entity type
    const parsed = parseOpenSpecId(externalId);
    if (!parsed) {
      console.warn(`[openspec] Invalid ID format: ${externalId}`);
      return null;
    }

    const specPrefix = this.options.spec_prefix || "os";
    const issuePrefix = this.options.issue_prefix || "osc";

    // Check if this is a spec or change (issue)
    if (parsed.type === "spec") {
      // Search for spec with matching ID
      const specsDir = path.join(this.resolvedPath, "specs");
      if (!existsSync(specsDir)) {
        return null;
      }

      try {
        const entries = readdirSync(specsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const specPath = path.join(specsDir, entry.name, "spec.md");
          if (!existsSync(specPath)) continue;

          const generatedId = generateSpecId(entry.name, specPrefix);
          if (generatedId === externalId) {
            const spec = parseSpecFile(specPath);
            return this.specToExternalEntity(spec, generatedId);
          }
        }
      } catch (error) {
        console.error(`[openspec] Error fetching spec:`, error);
      }
    } else if (parsed.type === "change") {
      // Search for change with matching ID
      const changesDir = path.join(this.resolvedPath, "changes");
      if (!existsSync(changesDir)) {
        return null;
      }

      try {
        const changePaths = scanChangeDirectories(changesDir, true);
        for (const changePath of changePaths) {
          const change = parseChangeDirectory(changePath);
          const generatedId = generateChangeId(change.name, issuePrefix);
          if (generatedId === externalId) {
            return this.changeToExternalEntity(change, generatedId);
          }
        }
      } catch (error) {
        console.error(`[openspec] Error fetching change:`, error);
      }
    }

    return null;
  }

  async searchEntities(query?: string): Promise<ExternalEntity[]> {
    console.log(`[openspec] searchEntities called with query: ${query}`);

    // IMPORTANT: We collect specs FIRST, then issues
    // This ensures specs exist before issues that reference them are synced
    const specEntities: ExternalEntity[] = [];
    const issueEntities: ExternalEntity[] = [];

    const specPrefix = this.options.spec_prefix || "os";
    const issuePrefix = this.options.issue_prefix || "osc";

    // Track which specs exist in openspec/specs/ (approved specs)
    const approvedSpecs = new Set<string>();

    // Scan specs/ directory for OpenSpec specs (approved/current)
    const specsDir = path.join(this.resolvedPath, "specs");
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
            const specId = generateSpecId(entry.name, specPrefix);
            const entity = this.specToExternalEntity(spec, specId);

            if (this.matchesQuery(entity, query)) {
              specEntities.push(entity);
            }
          } catch (error) {
            console.error(`[openspec] Error parsing spec at ${specPath}:`, error);
          }
        }
      } catch (error) {
        console.error(`[openspec] Error scanning specs directory:`, error);
      }
    }

    // Scan changes/ directory for OpenSpec changes (map to issues)
    // Also extract proposed specs from changes/[name]/specs/[cap]/spec.md
    const changesDir = path.join(this.resolvedPath, "changes");
    if (existsSync(changesDir)) {
      try {
        const changePaths = scanChangeDirectories(changesDir, true);

        for (const changePath of changePaths) {
          try {
            const change = parseChangeDirectory(changePath);
            const changeId = generateChangeId(change.name, issuePrefix);
            const entity = this.changeToExternalEntity(change, changeId);

            if (this.matchesQuery(entity, query)) {
              issueEntities.push(entity);
            }

            // Scan for proposed specs inside this change
            // These are NEW specs or deltas in changes/[name]/specs/[cap]/spec.md
            const changeSpecsDir = path.join(changePath, "specs");
            if (existsSync(changeSpecsDir)) {
              const specDirEntries = readdirSync(changeSpecsDir, { withFileTypes: true });
              for (const specEntry of specDirEntries) {
                if (!specEntry.isDirectory()) continue;

                const proposedSpecPath = path.join(changeSpecsDir, specEntry.name, "spec.md");
                if (!existsSync(proposedSpecPath)) continue;

                // Check if this is a NEW spec (not in openspec/specs/) or a delta
                const isNewSpec = !approvedSpecs.has(specEntry.name);

                try {
                  const proposedSpec = parseSpecFile(proposedSpecPath);
                  const proposedSpecId = generateSpecId(specEntry.name, specPrefix);

                  // Only create a separate spec entity for NEW specs
                  // Deltas to existing specs are just tracked via relationships
                  if (isNewSpec) {
                    const proposedEntity = this.proposedSpecToExternalEntity(
                      proposedSpec,
                      proposedSpecId,
                      changeId,
                      change.name
                    );

                    if (this.matchesQuery(proposedEntity, query)) {
                      // Add proposed specs to specEntities so they're synced before issues
                      specEntities.push(proposedEntity);
                    }
                  }
                } catch (error) {
                  console.error(`[openspec] Error parsing proposed spec at ${proposedSpecPath}:`, error);
                }
              }
            }
          } catch (error) {
            console.error(`[openspec] Error parsing change at ${changePath}:`, error);
          }
        }
      } catch (error) {
        console.error(`[openspec] Error scanning changes directory:`, error);
      }
    }

    // Return specs FIRST, then issues
    // This ensures specs are created before issues that implement them
    const entities = [...specEntities, ...issueEntities];
    console.log(`[openspec] searchEntities found ${entities.length} entities (${specEntities.length} specs, ${issueEntities.length} issues)`);
    return entities;
  }

  async createEntity(entity: Partial<Spec | Issue>): Promise<string> {
    console.log(`[openspec] createEntity called:`, entity.title);
    throw new Error(
      "createEntity not supported: OpenSpec entities are created by adding files to the .openspec directory"
    );
  }

  async updateEntity(
    externalId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void> {
    console.log(`[openspec] updateEntity called for ${externalId}:`, JSON.stringify(entity));

    // Find the entity in our current state to get file paths
    const currentEntities = await this.searchEntities();
    const targetEntity = currentEntities.find((e) => e.id === externalId);

    if (!targetEntity) {
      console.error(`[openspec] Entity not found: ${externalId}`);
      return;
    }

    if (targetEntity.type === "spec") {
      // Update spec.md file
      const rawData = targetEntity.raw as Record<string, unknown> | undefined;
      const filePath = rawData?.filePath as string | undefined;
      if (filePath && entity.content !== undefined) {
        updateSpecContent(filePath, entity.content);
        console.log(`[openspec] Updated spec at ${filePath}`);
      }
    } else if (targetEntity.type === "issue") {
      // Update change files (tasks.md)
      const rawData = targetEntity.raw as Record<string, unknown> | undefined;
      const changeName = rawData?.name as string | undefined;
      if (changeName) {
        await this.updateChangeByName(changeName, entity as Partial<Issue>);
      }
    }

    // Update watcher hash cache to prevent detecting our write as a change
    if (this.watcher) {
      const refreshedEntities = await this.searchEntities();
      const updatedEntity = refreshedEntities.find((e) => e.id === externalId);
      if (updatedEntity) {
        const newHash = this.computeEntityHash(updatedEntity);
        this.watcher.updateEntityHash(externalId, newHash);
      }
    }

    // Refresh entity hash cache
    for (const e of currentEntities) {
      this.entityHashes.set(e.id, this.computeEntityHash(e));
    }
  }

  /**
   * Update a change's files (tasks.md) with changes from sudocode
   */
  private async updateChangeByName(
    changeName: string,
    entity: Partial<Issue>
  ): Promise<void> {
    // Find change directory
    let changePath: string | null = null;
    const changesDir = path.join(this.resolvedPath, "changes");

    if (existsSync(changesDir)) {
      const changePaths = scanChangeDirectories(changesDir, true);
      for (const cp of changePaths) {
        if (path.basename(cp) === changeName) {
          changePath = cp;
          break;
        }
      }
    }

    if (!changePath) {
      console.error(`[openspec] Change directory not found: ${changeName}`);
      return;
    }

    // Handle status changes - update tasks.md checkboxes
    if (entity.status !== undefined) {
      const tasksPath = path.join(changePath, "tasks.md");
      if (existsSync(tasksPath)) {
        // Mark all tasks as completed when issue is closed
        const completed = entity.status === "closed";
        if (completed) {
          updateAllTasksCompletion(tasksPath, true);
          console.log(`[openspec] Marked all tasks as completed in ${tasksPath}`);
        }
        // Note: We don't uncheck tasks when reopening - that would be destructive
      }
    }

    console.log(`[openspec] Updated change at ${changePath}`);
  }

  async deleteEntity(externalId: string): Promise<void> {
    console.log(`[openspec] deleteEntity called for: ${externalId}`);
    throw new Error(
      "deleteEntity not supported: OpenSpec entities are deleted by removing files from the .openspec directory"
    );
  }

  async getChangesSince(timestamp: Date): Promise<ExternalChange[]> {
    console.log(
      `[openspec] getChangesSince called for: ${timestamp.toISOString()}`
    );

    const changes: ExternalChange[] = [];
    const currentEntities = await this.searchEntities();
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
          timestamp: entity.created_at || new Date().toISOString(),
          data: entity,
        });
        this.entityHashes.set(entity.id, newHash);
      } else if (newHash !== cachedHash) {
        // Updated entity
        changes.push({
          entity_id: entity.id,
          entity_type: entity.type,
          change_type: "updated",
          timestamp: entity.updated_at || new Date().toISOString(),
          data: entity,
        });
        this.entityHashes.set(entity.id, newHash);
      }
    }

    // Check for deleted entities
    const now = new Date().toISOString();
    for (const [id, _hash] of this.entityHashes) {
      if (!currentIds.has(id)) {
        // Determine entity type from ID prefix
        const isIssue = id.startsWith(this.options.issue_prefix || "osi");
        changes.push({
          entity_id: id,
          entity_type: isIssue ? "issue" : "spec",
          change_type: "deleted",
          timestamp: now,
        });
        this.entityHashes.delete(id);
      }
    }

    console.log(`[openspec] getChangesSince found ${changes.length} changes`);
    return changes;
  }

  startWatching(callback: (changes: ExternalChange[]) => void): void {
    console.log(`[openspec] startWatching called`);

    if (this.watcher) {
      console.warn("[openspec] Already watching");
      return;
    }

    this.watcher = new OpenSpecWatcher({
      openspecPath: this.resolvedPath,
      specPrefix: this.options.spec_prefix,
      changePrefix: this.options.issue_prefix,
      trackArchived: true,
      debounceMs: 100,
    });

    this.watcher.start(callback);
    console.log(`[openspec] File watching started for ${this.resolvedPath}`);
  }

  stopWatching(): void {
    console.log(`[openspec] stopWatching called`);

    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
      console.log(`[openspec] File watching stopped`);
    }
  }

  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
    relationships?: Array<{
      targetId: string;
      targetType: "spec" | "issue";
      relationshipType: "implements" | "blocks" | "depends-on" | "references" | "related" | "discovered-from";
    }>;
  } {
    if (external.type === "issue") {
      return {
        issue: {
          title: external.title,
          content: external.description || "",
          priority: external.priority ?? 2,
          status: this.mapStatus(external.status),
        },
        // Pass through relationships for change→spec implements links
        relationships: external.relationships,
      };
    }

    return {
      spec: {
        title: external.title,
        content: external.description || "",
        priority: external.priority ?? 2,
      },
      // Pass through relationships for proposed specs (references to change)
      relationships: external.relationships,
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

  /**
   * Compute a hash for an entity to detect changes
   */
  private computeEntityHash(entity: ExternalEntity): string {
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

  // ===========================================================================
  // Entity Conversion Helpers
  // ===========================================================================

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
   * They are marked with a "proposed" tag. The change has the implements
   * relationship to the spec (not bidirectional).
   */
  private proposedSpecToExternalEntity(
    spec: ParsedOpenSpecSpec,
    id: string,
    _changeId: string,
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
    const specPrefix = this.options.spec_prefix || "os";
    const relationships: ExternalEntity["relationships"] = change.affectedSpecs.map(
      (specCapability) => ({
        targetId: generateSpecId(specCapability, specPrefix),
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
   * Check if an entity matches a query string
   */
  private matchesQuery(entity: ExternalEntity, query?: string): boolean {
    if (!query) return true;

    const lowerQuery = query.toLowerCase();
    return (
      entity.title.toLowerCase().includes(lowerQuery) ||
      (entity.description?.toLowerCase().includes(lowerQuery) ?? false)
    );
  }
}

export default openSpecPlugin;

// Re-export ID generator functions for use by consumers
export {
  generateSpecId,
  generateChangeId,
  parseOpenSpecId,
  verifyOpenSpecId,
  isOpenSpecId,
  DEFAULT_SPEC_PREFIX,
  DEFAULT_CHANGE_PREFIX,
  type ParsedOpenSpecId,
} from "./id-generator.js";

// Re-export spec parser functions and types for use by consumers
export {
  parseSpecFile,
  extractCapability,
  parseRequirements,
  parseScenarios,
  parseGivenWhenThen,
  SPEC_PATTERNS,
  type ParsedOpenSpecSpec,
  type ParsedRequirement,
  type ParsedScenario,
} from "./parser/spec-parser.js";

// Re-export tasks parser functions and types for use by consumers
export {
  parseTasks,
  parseTasksContent,
  getAllTasks,
  getIncompleteTasks,
  getTaskStats,
  calculateCompletionPercentage,
  isTasksFile,
  TASK_PATTERNS,
  type ParsedTask,
  type ParsedTasksFile,
} from "./parser/tasks-parser.js";

// Re-export change parser functions and types for use by consumers
export {
  parseChangeDirectory,
  extractChangeName,
  detectArchiveStatus,
  parseProposal,
  extractTitleFromWhatChanges,
  formatTitle,
  parseChangeTasks,
  scanAffectedSpecs,
  isChangeDirectory,
  scanChangeDirectories,
  parseAllChanges,
  CHANGE_PATTERNS,
  type ParsedOpenSpecChange,
} from "./parser/change-parser.js";

// Re-export watcher for use by consumers
export {
  OpenSpecWatcher,
  type OpenSpecWatcherOptions,
  type ChangeCallback,
} from "./watcher.js";
