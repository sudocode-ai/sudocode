/**
 * Spec-Kit Integration Plugin for sudocode
 *
 * Provides integration with spec-kit - a markdown-based specification system.
 * Syncs specs, plans, and tasks to sudocode's specs and issues.
 */

// Re-export ID generation utilities
export {
  generateSpecId,
  generateTaskIssueId,
  parseSpecId,
  isValidSpecKitId,
  extractFeatureNumber,
  extractFileType,
  getFeatureSpecId,
  getFeaturePlanId,
  getFeatureTasksId,
  type ParsedSpecId,
  type SpecKitFileType,
} from "./id-generator.js";

// Re-export relationship mapping utilities
export {
  mapFeatureRelationships,
  mapTaskDependencies,
  mapSupportingDocRelationships,
  mapPlanToSpecRelationship,
  mapTaskToPlanRelationship,
  getStandardSupportingDocTypes,
  createContractDocInfo,
  type MappedRelationship,
  type TaskInfo,
  type SupportingDocInfo,
} from "./relationship-mapper.js";

// Re-export writer utilities
export {
  updateTaskStatus,
  getTaskStatus,
  getAllTaskStatuses,
  updateSpecContent,
  getSpecTitle,
  getSpecStatus,
  type TaskUpdateResult,
  type SpecUpdates,
  type SpecUpdateResult,
} from "./writer/index.js";

// Re-export watcher
export {
  SpecKitWatcher,
  type ChangeCallback,
  type SpecKitWatcherOptions,
} from "./watcher.js";

// Re-export parser utilities
export {
  // Markdown utilities
  PATTERNS,
  extractMetadata,
  extractTitle,
  extractTitleWithPrefixRemoval,
  extractMetadataValue,
  extractCrossReferences,
  findContentStartIndex,
  extractSection,
  parseDate,
  escapeRegex,
  cleanTaskDescription,
  normalizeStatus,
  // Spec parser
  parseSpec,
  parseSpecContent,
  isSpecFile,
  getSpecFileTitle,
  getSpecFileStatus,
  type ParsedSpecKitSpec,
  type ParseSpecOptions,
  // Plan parser
  parsePlan,
  parsePlanContent,
  isPlanFile,
  getPlanFileTitle,
  getPlanFileStatus,
  type ParsedSpecKitPlan,
  type ParsePlanOptions,
  // Tasks parser
  parseTasks,
  parseTasksContent,
  getAllTasks,
  getTaskById,
  getIncompleteTasks,
  getParallelizableTasks,
  getTasksByPhase,
  getTasksByUserStory,
  isTasksFile,
  getTaskStats,
  type ParsedTask,
  type ParsedTasksFile,
  type ParseTasksOptions,
  // Supporting documents parser
  parseResearch,
  parseDataModel,
  parseSupportingDoc,
  parseContract,
  parseContractsDirectory,
  discoverSupportingDocs,
  detectDocType,
  type SupportingDocType,
  type ParsedSupportingDoc,
  type ParsedContract,
  type ParseSupportingDocOptions,
} from "./parser/index.js";

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
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  parseSpecId,
  generateSpecId,
  generateTaskIssueId,
  extractFeatureNumber,
  getFeatureSpecId,
  getFeaturePlanId,
} from "./id-generator.js";
import { updateTaskStatus, updateSpecContent } from "./writer/index.js";
import { parseSpec } from "./parser/spec-parser.js";
import { parsePlan } from "./parser/plan-parser.js";
import { parseTasks, type ParsedTask } from "./parser/tasks-parser.js";
import {
  discoverSupportingDocs,
  type ParsedSupportingDoc,
  type ParsedContract,
} from "./parser/supporting-docs.js";
import { SpecKitWatcher } from "./watcher.js";

/**
 * Spec-kit specific configuration options
 */
export interface SpecKitOptions {
  /** Path to the .specify directory (relative to project root) */
  path: string;
  /** Prefix for spec IDs imported from spec-kit (default: "sk") */
  spec_prefix?: string;
  /** Prefix for task IDs imported from spec-kit (default: "skt") */
  task_prefix?: string;
  /** Whether to include supporting docs (research.md, data-model.md, contracts/) (default: true) */
  include_supporting_docs?: boolean;
  /** Whether to include constitution.md as root project spec (default: true) */
  include_constitution?: boolean;
}

/**
 * Configuration schema for UI form generation
 */
const configSchema: PluginConfigSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      title: "Spec-Kit Path",
      description: "Path to the .specify directory (relative to project root)",
      default: ".specify",
      required: true,
    },
    spec_prefix: {
      type: "string",
      title: "Spec Prefix",
      description: "Prefix for spec IDs imported from spec-kit",
      default: "sk",
    },
    task_prefix: {
      type: "string",
      title: "Task Prefix",
      description: "Prefix for task IDs imported from spec-kit",
      default: "skt",
    },
    include_supporting_docs: {
      type: "boolean",
      title: "Include Supporting Docs",
      description: "Include research.md, data-model.md, and contracts/*.md",
      default: true,
    },
    include_constitution: {
      type: "boolean",
      title: "Include Constitution",
      description: "Include constitution.md as root project spec",
      default: true,
    },
  },
  required: ["path"],
};

/**
 * Spec-kit integration plugin
 */
const specKitPlugin: IntegrationPlugin = {
  name: "spec-kit",
  displayName: "Spec-Kit",
  version: "0.1.0",
  description: "Integration with spec-kit markdown-based specification system",

  configSchema,

  validateConfig(options: Record<string, unknown>): PluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required path field
    if (!options.path || typeof options.path !== "string") {
      errors.push("spec-kit.options.path is required");
    }

    // Validate spec_prefix if provided
    if (options.spec_prefix !== undefined) {
      if (typeof options.spec_prefix !== "string") {
        errors.push("spec-kit.options.spec_prefix must be a string");
      } else if (!/^[a-z]{1,4}$/i.test(options.spec_prefix)) {
        warnings.push(
          "spec-kit.options.spec_prefix should be 1-4 alphabetic characters"
        );
      }
    }

    // Validate task_prefix if provided
    if (options.task_prefix !== undefined) {
      if (typeof options.task_prefix !== "string") {
        errors.push("spec-kit.options.task_prefix must be a string");
      } else if (!/^[a-z]{1,4}$/i.test(options.task_prefix)) {
        warnings.push(
          "spec-kit.options.task_prefix should be 1-4 alphabetic characters"
        );
      }
    }

    // Validate boolean options
    if (
      options.include_supporting_docs !== undefined &&
      typeof options.include_supporting_docs !== "boolean"
    ) {
      errors.push("spec-kit.options.include_supporting_docs must be a boolean");
    }

    if (
      options.include_constitution !== undefined &&
      typeof options.include_constitution !== "boolean"
    ) {
      errors.push("spec-kit.options.include_constitution must be a boolean");
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
    const specKitPath = options.path as string;

    if (!specKitPath) {
      return {
        success: false,
        configured: true,
        enabled: true,
        error: "Spec-kit path is not configured",
      };
    }

    const resolvedPath = path.resolve(projectPath, specKitPath);

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        configured: true,
        enabled: true,
        error: `Spec-kit directory not found: ${resolvedPath}`,
        details: { path: specKitPath, resolvedPath },
      };
    }

    // Check for specs subdirectory
    const specsPath = path.join(resolvedPath, "specs");
    const hasSpecs = existsSync(specsPath);

    // Check for common spec-kit files
    const hasConstitution = existsSync(
      path.join(resolvedPath, "constitution.md")
    );

    return {
      success: true,
      configured: true,
      enabled: true,
      details: {
        path: specKitPath,
        resolvedPath,
        hasSpecsDirectory: hasSpecs,
        hasConstitution,
      },
    };
  },

  createProvider(
    options: Record<string, unknown>,
    projectPath: string
  ): IntegrationProvider {
    return new SpecKitProvider(
      options as unknown as SpecKitOptions,
      projectPath
    );
  },
};

/**
 * Spec-kit provider implementation
 */
class SpecKitProvider implements IntegrationProvider {
  readonly name = "spec-kit";
  readonly supportsWatch = true;
  readonly supportsPolling = true;
  readonly supportsOnDemandImport = false;
  readonly supportsSearch = false;
  readonly supportsPush = false;

  private options: SpecKitOptions;
  private projectPath: string;
  private resolvedPath: string;

  // Change tracking for getChangesSince
  private entityHashes: Map<string, string> = new Map();

  // File watcher instance
  private watcher: SpecKitWatcher | null = null;

  constructor(options: SpecKitOptions, projectPath: string) {
    this.options = options;
    this.projectPath = projectPath;
    this.resolvedPath = path.resolve(projectPath, options.path);
  }

  async initialize(): Promise<void> {
    console.log(
      `[spec-kit] Initializing provider for path: ${this.resolvedPath}`
    );

    if (!existsSync(this.resolvedPath)) {
      throw new Error(`Spec-kit directory not found: ${this.resolvedPath}`);
    }

    // Check for specs subdirectory
    const specsDir = path.join(this.resolvedPath, "specs");
    if (!existsSync(specsDir)) {
      console.warn(
        `[spec-kit] Note: specs directory does not exist yet at ${specsDir}`
      );
    }

    // Note: We intentionally do NOT pre-populate entityHashes here.
    // This allows getChangesSince to detect all existing entities as "new" on first sync,
    // enabling auto-import of existing spec-kit entities into sudocode.
    // The hash cache gets populated as entities are synced/detected.
    console.log(`[spec-kit] Provider initialized successfully (hash cache empty for fresh import)`);
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!existsSync(this.resolvedPath)) {
      errors.push(`Spec-kit directory not found: ${this.resolvedPath}`);
      return { valid: false, errors };
    }

    // Check for specs subdirectory
    const specsDir = path.join(this.resolvedPath, "specs");
    if (!existsSync(specsDir)) {
      // Not an error - directory might not exist yet, but warn
      console.log(
        `[spec-kit] Note: specs directory does not exist yet at ${specsDir}`
      );
    }

    const valid = errors.length === 0;
    console.log(
      `[spec-kit] Validation result: valid=${valid}, errors=${errors.length}`
    );
    return { valid, errors };
  }

  async dispose(): Promise<void> {
    console.log(`[spec-kit] Disposing provider`);
    this.stopWatching();
    // Clear entity state cache
    this.entityHashes.clear();
    console.log(`[spec-kit] Provider disposed successfully`);
  }

  async fetchEntity(externalId: string): Promise<ExternalEntity | null> {
    console.log(`[spec-kit] fetchEntity called for: ${externalId}`);

    // Parse the ID to determine file type and path
    const parsed = parseSpecId(externalId);
    if (!parsed) {
      console.warn(`[spec-kit] Invalid ID format: ${externalId}`);
      return null;
    }

    const prefix = this.options.spec_prefix || "sk";
    const taskPrefix = this.options.task_prefix || "skt";

    // Check if this is a task (issue) or spec
    if (parsed.isTask && parsed.featureNumber) {
      // Task entity - find it in the tasks.md file
      const tasksFilePath = this.getTasksFilePath(parsed.featureNumber);
      if (!existsSync(tasksFilePath)) {
        return null;
      }

      const tasksFile = parseTasks(tasksFilePath);
      if (!tasksFile) {
        return null;
      }

      const task = tasksFile.tasks.find((t) => t.taskId === parsed.fileType);
      if (!task) {
        return null;
      }

      return this.taskToExternalEntity(
        task,
        parsed.featureNumber,
        externalId,
        tasksFilePath
      );
    }

    // Spec entity - determine file path based on feature number and file type
    if (parsed.featureNumber) {
      const filePath = this.getSpecFilePath(
        parsed.featureNumber,
        parsed.fileType
      );
      if (!existsSync(filePath)) {
        return null;
      }

      // Get the feature directory name for title generation
      const featureDirName = this.getFeatureDirName(parsed.featureNumber);

      // Parse based on file type
      if (parsed.fileType === "spec") {
        const spec = parseSpec(filePath);
        if (!spec) return null;
        return this.specToExternalEntity(spec, externalId, featureDirName || undefined, "spec");
      } else if (parsed.fileType === "plan") {
        const plan = parsePlan(filePath);
        if (!plan) return null;
        return this.planToExternalEntity(plan, externalId, featureDirName || undefined, parsed.featureNumber || undefined);
      } else if (
        parsed.fileType === "research" ||
        parsed.fileType === "data-model"
      ) {
        const featureDir = path.dirname(filePath);
        const docs = discoverSupportingDocs(featureDir);
        const doc =
          parsed.fileType === "research" ? docs.research : docs.dataModel;
        if (!doc) return null;
        return this.supportingDocToExternalEntity(doc, externalId, featureDirName || undefined, parsed.featureNumber || undefined);
      } else if (parsed.fileType.startsWith("contract-")) {
        const featureDir = path.dirname(filePath);
        const contractsDir = path.join(featureDir, "contracts");
        const contractName = parsed.fileType.replace("contract-", "");
        const docs = discoverSupportingDocs(featureDir);
        const contract = docs.contracts.find((c) => c.name === contractName);
        if (!contract) return null;
        return this.contractToExternalEntity(contract, externalId, featureDirName || undefined, parsed.featureNumber || undefined);
      }
    } else {
      // Non-feature file (e.g., constitution.md)
      if (parsed.fileType === "constitution") {
        const constitutionPath = path.join(
          this.resolvedPath,
          "memory",
          "constitution.md"
        );
        if (!existsSync(constitutionPath)) {
          return null;
        }

        const spec = parseSpec(constitutionPath);
        if (!spec) return null;
        return this.specToExternalEntity(spec, externalId, undefined, "constitution");
      }
    }

    return null;
  }

  async searchEntities(query?: string): Promise<ExternalEntity[]> {
    console.log(`[spec-kit] searchEntities called with query: ${query}`);

    const entities: ExternalEntity[] = [];
    const prefix = this.options.spec_prefix || "sk";
    const taskPrefix = this.options.task_prefix || "skt";
    const includeSupportingDocs =
      this.options.include_supporting_docs !== false;
    const includeConstitution = this.options.include_constitution !== false;

    // Scan specs directory for feature directories
    const specsDir = path.join(this.resolvedPath, "specs");
    if (existsSync(specsDir)) {
      try {
        const entries = readdirSync(specsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          // Feature directories match pattern like "001-auth", "002-payments"
          const featureMatch = entry.name.match(/^(\d+)-/);
          if (!featureMatch) continue;

          const featureNumber = featureMatch[1];
          const featureDir = path.join(specsDir, entry.name);

          // Parse spec.md
          const specPath = path.join(featureDir, "spec.md");
          if (existsSync(specPath)) {
            const spec = parseSpec(specPath);
            if (spec) {
              const specId = generateSpecId(
                `specs/${entry.name}/spec.md`,
                prefix
              );
              const entity = this.specToExternalEntity(spec, specId, entry.name, "spec");
              if (this.matchesQuery(entity, query)) {
                entities.push(entity);
              }
            }
          }

          // Parse plan.md
          const planPath = path.join(featureDir, "plan.md");
          if (existsSync(planPath)) {
            const plan = parsePlan(planPath);
            if (plan) {
              const planId = generateSpecId(
                `specs/${entry.name}/plan.md`,
                prefix
              );
              const entity = this.planToExternalEntity(plan, planId, entry.name, featureNumber);
              if (this.matchesQuery(entity, query)) {
                entities.push(entity);
              }
            }
          }

          // Parse tasks.md - each task becomes an Issue
          const tasksPath = path.join(featureDir, "tasks.md");
          if (existsSync(tasksPath)) {
            const tasksFile = parseTasks(tasksPath);
            if (tasksFile) {
              for (const task of tasksFile.tasks) {
                const taskIssueId = generateTaskIssueId(
                  featureNumber,
                  task.taskId,
                  taskPrefix
                );
                const entity = this.taskToExternalEntity(
                  task,
                  featureNumber,
                  taskIssueId,
                  tasksPath
                );
                if (this.matchesQuery(entity, query)) {
                  entities.push(entity);
                }
              }
            }
          }

          // Optionally include supporting docs
          if (includeSupportingDocs) {
            const docs = discoverSupportingDocs(featureDir);

            if (docs.research) {
              const docId = generateSpecId(
                `specs/${entry.name}/research.md`,
                prefix
              );
              const entity = this.supportingDocToExternalEntity(
                docs.research,
                docId,
                entry.name,
                featureNumber
              );
              if (this.matchesQuery(entity, query)) {
                entities.push(entity);
              }
            }

            if (docs.dataModel) {
              const docId = generateSpecId(
                `specs/${entry.name}/data-model.md`,
                prefix
              );
              const entity = this.supportingDocToExternalEntity(
                docs.dataModel,
                docId,
                entry.name,
                featureNumber
              );
              if (this.matchesQuery(entity, query)) {
                entities.push(entity);
              }
            }

            for (const contract of docs.contracts) {
              const docId = `${prefix}-${featureNumber}-contract-${contract.name}`;
              const entity = this.contractToExternalEntity(contract, docId, entry.name, featureNumber);
              if (this.matchesQuery(entity, query)) {
                entities.push(entity);
              }
            }

            for (const other of docs.other) {
              const docId = generateSpecId(
                `specs/${entry.name}/${other.fileName}.md`,
                prefix
              );
              const entity = this.supportingDocToExternalEntity(other, docId, entry.name, featureNumber);
              if (this.matchesQuery(entity, query)) {
                entities.push(entity);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[spec-kit] Error scanning specs directory:`, error);
      }
    }

    // Include constitution.md if configured
    if (includeConstitution) {
      const constitutionPath = path.join(
        this.resolvedPath,
        "memory",
        "constitution.md"
      );
      if (existsSync(constitutionPath)) {
        const spec = parseSpec(constitutionPath);
        if (spec) {
          const constitutionId = `${prefix}-constitution`;
          // Use "constitution" as title (no feature dir for global files)
          const entity = this.specToExternalEntity(spec, constitutionId, undefined, "constitution");
          if (this.matchesQuery(entity, query)) {
            entities.push(entity);
          }
        }
      }
    }

    console.log(`[spec-kit] searchEntities found ${entities.length} entities`);
    return entities;
  }

  async createEntity(entity: Partial<Spec | Issue>): Promise<string> {
    // Spec-kit uses file-based storage, so creating entities is not directly supported
    // Entities are created by adding files to the spec-kit directory structure
    console.log(`[spec-kit] createEntity called:`, entity.title);
    throw new Error(
      "createEntity not supported: spec-kit entities are created by adding files to the .specify directory"
    );
  }

  async updateEntity(
    externalId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void> {
    console.log(`[spec-kit] updateEntity called for ${externalId}:`, entity);

    // Parse the external ID to determine what type of entity this is
    const parsed = parseSpecId(externalId);
    if (!parsed) {
      throw new Error(`Invalid spec-kit ID format: ${externalId}`);
    }

    // Handle task updates (issues that map to tasks.md entries)
    if (parsed.isTask && parsed.featureNumber) {
      await this.updateTaskEntity(
        parsed.featureNumber,
        parsed.fileType,
        entity
      );
      return;
    }

    // Handle spec/plan updates
    if (parsed.featureNumber) {
      await this.updateSpecEntity(
        parsed.featureNumber,
        parsed.fileType,
        entity
      );
      return;
    }

    // Handle non-feature files (e.g., constitution.md)
    await this.updateNonFeatureEntity(parsed.fileType, entity);
  }

  async deleteEntity(externalId: string): Promise<void> {
    // Spec-kit uses file-based storage, so deleting entities is not directly supported
    // Entities are deleted by removing files from the spec-kit directory structure
    console.log(`[spec-kit] deleteEntity called for: ${externalId}`);
    throw new Error(
      "deleteEntity not supported: spec-kit entities are deleted by removing files from the .specify directory"
    );
  }

  /**
   * Update a task entity (corresponds to a line in tasks.md)
   */
  private async updateTaskEntity(
    featureNumber: string,
    taskId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void> {
    const tasksFilePath = this.getTasksFilePath(featureNumber);

    if (!existsSync(tasksFilePath)) {
      throw new Error(`Tasks file not found: ${tasksFilePath}`);
    }

    // Check if this is an issue with status
    const issue = entity as Partial<Issue>;
    if (issue.status !== undefined) {
      const completed = issue.status === "closed";
      const result = updateTaskStatus(tasksFilePath, taskId, completed);

      if (!result.success) {
        throw new Error(result.error || "Failed to update task status");
      }

      // Update hash cache to prevent false change detection
      this.updateHashCache(tasksFilePath);

      console.log(
        `[spec-kit] Updated task ${taskId} in feature ${featureNumber}: ${result.previousStatus} -> ${result.newStatus}`
      );
    }
  }

  /**
   * Update a spec/plan entity
   */
  private async updateSpecEntity(
    featureNumber: string,
    fileType: string,
    entity: Partial<Spec | Issue>
  ): Promise<void> {
    const filePath = this.getSpecFilePath(featureNumber, fileType);

    if (!existsSync(filePath)) {
      throw new Error(`Spec file not found: ${filePath}`);
    }

    const spec = entity as Partial<Spec>;
    const updates: { title?: string; status?: string; content?: string } = {};

    if (spec.title !== undefined) {
      updates.title = spec.title;
    }

    // Map sudocode priority/status to spec-kit status if applicable
    // Note: spec-kit doesn't have a standard status field, but we support it if present
    const issue = entity as Partial<Issue>;
    if (issue.status !== undefined) {
      updates.status = this.mapStatusToSpecKit(issue.status);
    }

    if (spec.content !== undefined) {
      updates.content = spec.content;
    }

    const result = updateSpecContent(filePath, updates);

    if (!result.success) {
      throw new Error(result.error || "Failed to update spec content");
    }

    // Update hash cache to prevent false change detection
    this.updateHashCache(filePath);

    console.log(
      `[spec-kit] Updated ${fileType} for feature ${featureNumber}:`,
      result.changes
    );
  }

  /**
   * Update a non-feature entity (e.g., constitution.md)
   */
  private async updateNonFeatureEntity(
    fileType: string,
    entity: Partial<Spec | Issue>
  ): Promise<void> {
    // Map file type to path
    let filePath: string;

    if (fileType === "constitution") {
      filePath = path.join(this.resolvedPath, "memory", "constitution.md");
    } else {
      filePath = path.join(this.resolvedPath, `${fileType}.md`);
    }

    if (!existsSync(filePath)) {
      throw new Error(`Spec file not found: ${filePath}`);
    }

    const spec = entity as Partial<Spec>;
    const updates: { title?: string; status?: string; content?: string } = {};

    if (spec.title !== undefined) {
      updates.title = spec.title;
    }

    if (spec.content !== undefined) {
      updates.content = spec.content;
    }

    const result = updateSpecContent(filePath, updates);

    if (!result.success) {
      throw new Error(result.error || "Failed to update spec content");
    }

    // Update hash cache to prevent false change detection
    this.updateHashCache(filePath);

    console.log(`[spec-kit] Updated ${fileType}:`, result.changes);
  }

  /**
   * Get the path to a feature's tasks.md file
   */
  private getTasksFilePath(featureNumber: string): string {
    // Find the feature directory by looking for XXX-* pattern
    const specsDir = path.join(this.resolvedPath, "specs");

    if (!existsSync(specsDir)) {
      return path.join(specsDir, `${featureNumber}-unknown`, "tasks.md");
    }

    const dirs = readdirSync(specsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const featureDir = dirs.find((dir: string) =>
      dir.startsWith(`${featureNumber}-`)
    );

    if (featureDir) {
      return path.join(specsDir, featureDir, "tasks.md");
    }

    // Fallback: return best guess path
    return path.join(specsDir, `${featureNumber}-unknown`, "tasks.md");
  }

  /**
   * Get the path to a feature's spec file
   */
  private getSpecFilePath(featureNumber: string, fileType: string): string {
    const specsDir = path.join(this.resolvedPath, "specs");

    if (!existsSync(specsDir)) {
      return path.join(specsDir, `${featureNumber}-unknown`, `${fileType}.md`);
    }

    const dirs = readdirSync(specsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const featureDir = dirs.find((dir: string) =>
      dir.startsWith(`${featureNumber}-`)
    );

    if (featureDir) {
      // Handle contract files
      if (fileType.startsWith("contract-")) {
        const contractName = fileType.replace("contract-", "");
        return path.join(
          specsDir,
          featureDir,
          "contracts",
          `${contractName}.json`
        );
      }

      return path.join(specsDir, featureDir, `${fileType}.md`);
    }

    // Fallback
    return path.join(specsDir, `${featureNumber}-unknown`, `${fileType}.md`);
  }

  /**
   * Get the feature directory name (e.g., "001-test-feature") from a feature number
   */
  private getFeatureDirName(featureNumber: string): string | null {
    const specsDir = path.join(this.resolvedPath, "specs");

    if (!existsSync(specsDir)) {
      return null;
    }

    const dirs = readdirSync(specsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    return dirs.find((dir) => dir.startsWith(`${featureNumber}-`)) || null;
  }

  /**
   * Update the hash cache for a file after writing
   */
  private updateHashCache(filePath: string): void {
    try {
      const content = readFileSync(filePath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex");
      this.entityHashes.set(filePath, hash);
    } catch {
      // Ignore errors updating cache
    }
  }

  /**
   * Map sudocode status to spec-kit status string
   */
  private mapStatusToSpecKit(
    status: "open" | "in_progress" | "blocked" | "needs_review" | "closed"
  ): string {
    const statusMap: Record<string, string> = {
      open: "Open",
      in_progress: "In Progress",
      blocked: "Blocked",
      needs_review: "Needs Review",
      closed: "Complete",
    };
    return statusMap[status] || "Open";
  }

  async getChangesSince(timestamp: Date): Promise<ExternalChange[]> {
    console.log(`[spec-kit] getChangesSince called for: ${timestamp.toISOString()}`);
    console.log(`[spec-kit] getChangesSince: current entityHashes count: ${this.entityHashes.size}`);

    const changes: ExternalChange[] = [];
    const currentEntities = await this.searchEntities();
    console.log(`[spec-kit] getChangesSince: searchEntities returned ${currentEntities.length} entities`);
    const currentIds = new Set<string>();

    // Check for created and updated entities
    for (const entity of currentEntities) {
      currentIds.add(entity.id);
      const newHash = this.computeEntityHash(entity);
      const cachedHash = this.entityHashes.get(entity.id);

      if (!cachedHash) {
        // New entity
        console.log(`[spec-kit] getChangesSince: NEW entity detected: ${entity.id} (type=${entity.type})`);
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
        console.log(`[spec-kit] getChangesSince: UPDATED entity detected: ${entity.id}`);
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
        // Determine entity type from ID
        const parsed = parseSpecId(id);
        const entityType: "spec" | "issue" = parsed?.isTask ? "issue" : "spec";
        console.log(`[spec-kit] getChangesSince: DELETED entity detected: ${id}`);

        changes.push({
          entity_id: id,
          entity_type: entityType,
          change_type: "deleted",
          timestamp: now,
        });
        this.entityHashes.delete(id);
      }
    }

    console.log(`[spec-kit] getChangesSince found ${changes.length} changes:`, changes.map(c => `${c.entity_id}(${c.change_type})`).join(", "));
    return changes;
  }

  startWatching(callback: (changes: ExternalChange[]) => void): void {
    console.log(`[spec-kit] startWatching called`);

    if (this.watcher) {
      console.warn(`[spec-kit] Watcher already running`);
      return;
    }

    this.watcher = new SpecKitWatcher({
      specifyPath: this.resolvedPath,
      specPrefix: this.options.spec_prefix || "sk",
      taskPrefix: this.options.task_prefix || "skt",
      includeSupportingDocs: this.options.include_supporting_docs !== false,
      includeConstitution: this.options.include_constitution !== false,
    });

    this.watcher.start(callback);
    console.log(`[spec-kit] Watcher started for ${this.resolvedPath}`);
  }

  stopWatching(): void {
    console.log(`[spec-kit] stopWatching called`);

    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
      console.log(`[spec-kit] Watcher stopped`);
    }
  }

  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  } {
    console.log(`[spec-kit] mapToSudocode: external.type=${external.type}, title=${external.title}`);
    if (external.type === "issue") {
      const result = {
        issue: {
          title: external.title,
          content: external.description || "",
          priority: external.priority ?? 2,
          status: this.mapStatus(external.status),
        },
      };
      console.log(`[spec-kit] mapToSudocode: returning issue with status=${result.issue.status}`);
      return result;
    }

    const result = {
      spec: {
        title: external.title,
        content: external.description || "",
        priority: external.priority ?? 2,
      },
    };
    console.log(`[spec-kit] mapToSudocode: returning spec`);
    return result;
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

  // ===========================================================================
  // Entity Conversion Helpers
  // ===========================================================================

  /**
   * Capture current entity state for change detection
   */
  private async captureEntityState(): Promise<void> {
    console.log(`[spec-kit] captureEntityState: capturing initial entity state...`);
    const entities = await this.searchEntities();

    this.entityHashes.clear();
    for (const entity of entities) {
      const hash = this.computeEntityHash(entity);
      this.entityHashes.set(entity.id, hash);
    }
    console.log(`[spec-kit] captureEntityState: captured ${this.entityHashes.size} entities`);
  }

  /**
   * Compute a hash for an entity to detect changes
   */
  private computeEntityHash(entity: ExternalEntity): string {
    // Create a canonical representation for hashing
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

  /**
   * Convert a parsed spec to ExternalEntity
   * @param spec - Parsed spec data
   * @param id - External entity ID
   * @param featureDirName - Feature directory name (e.g., "001-test-feature")
   * @param fileType - File type for title suffix (e.g., "spec", "plan")
   */
  private specToExternalEntity(
    spec: import("./parser/spec-parser.js").ParsedSpecKitSpec,
    id: string,
    featureDirName?: string,
    fileType: string = "spec"
  ): ExternalEntity {
    // Use directory-based title: "001-test-feature (spec)" instead of extracted title
    const title = featureDirName
      ? `${featureDirName} (${fileType})`
      : spec.title;

    // Read raw file content (including frontmatter) instead of processed content
    let rawContent = spec.content;
    try {
      rawContent = readFileSync(spec.filePath, "utf-8");
    } catch {
      // Fall back to parsed content if file read fails
    }

    return {
      id,
      type: "spec",
      title,
      description: rawContent,
      status: spec.status || undefined,
      priority: this.statusToPriority(spec.status),
      created_at: spec.createdAt?.toISOString(),
      raw: {
        rawTitle: spec.rawTitle,
        featureBranch: spec.featureBranch,
        metadata: Object.fromEntries(spec.metadata),
        crossReferences: spec.crossReferences,
        filePath: spec.filePath,
      },
    };
  }

  /**
   * Convert a parsed plan to ExternalEntity
   * @param plan - Parsed plan data
   * @param id - External entity ID
   * @param featureDirName - Feature directory name (e.g., "001-test-feature")
   */
  private planToExternalEntity(
    plan: import("./parser/plan-parser.js").ParsedSpecKitPlan,
    id: string,
    featureDirName?: string,
    featureNumber?: string
  ): ExternalEntity {
    // Use directory-based title: "001-test-feature (plan)" instead of extracted title
    const title = featureDirName
      ? `${featureDirName} (plan)`
      : plan.title;

    // Read raw file content (including frontmatter) instead of processed content
    let rawContent = plan.content;
    try {
      rawContent = readFileSync(plan.filePath, "utf-8");
    } catch {
      // Fall back to parsed content if file read fails
    }

    // Plan implements Spec relationship
    const relationships: ExternalEntity["relationships"] = [];
    if (featureNumber) {
      const specId = getFeatureSpecId(featureNumber, this.options.spec_prefix || "sk");
      relationships.push({
        targetId: specId,
        targetType: "spec",
        relationshipType: "implements",
      });
    }

    return {
      id,
      type: "spec",
      title,
      description: rawContent,
      status: plan.status || undefined,
      priority: this.statusToPriority(plan.status),
      created_at: plan.createdAt?.toISOString(),
      relationships: relationships.length > 0 ? relationships : undefined,
      raw: {
        rawTitle: plan.rawTitle,
        branch: plan.branch,
        specReference: plan.specReference,
        metadata: Object.fromEntries(plan.metadata),
        crossReferences: plan.crossReferences,
        filePath: plan.filePath,
      },
    };
  }

  /**
   * Convert a parsed task to ExternalEntity (as issue)
   */
  private taskToExternalEntity(
    task: ParsedTask,
    featureNumber: string,
    id: string,
    tasksFilePath: string
  ): ExternalEntity {
    const status = task.completed ? "closed" : "open";

    // Task implements Plan relationship
    const planId = getFeaturePlanId(featureNumber, this.options.spec_prefix || "sk");
    const relationships: ExternalEntity["relationships"] = [
      {
        targetId: planId,
        targetType: "spec",
        relationshipType: "implements",
      },
    ];

    return {
      id,
      type: "issue",
      title: `${task.taskId}: ${task.description}`,
      description: task.description,
      status,
      priority: task.parallelizable ? 1 : 2, // Parallelizable tasks get higher priority
      relationships,
      raw: {
        taskId: task.taskId,
        completed: task.completed,
        parallelizable: task.parallelizable,
        userStory: task.userStory,
        phase: task.phase,
        phaseName: task.phaseName,
        lineNumber: task.lineNumber,
        indentLevel: task.indentLevel,
        rawLine: task.rawLine,
        featureNumber,
        tasksFilePath,
      },
    };
  }

  /**
   * Convert a parsed supporting document to ExternalEntity
   * @param doc - Parsed supporting document data
   * @param id - External entity ID
   * @param featureDirName - Feature directory name (e.g., "001-test-feature")
   * @param featureNumber - Feature number (e.g., "001") for relationship creation
   */
  private supportingDocToExternalEntity(
    doc: ParsedSupportingDoc,
    id: string,
    featureDirName?: string,
    featureNumber?: string
  ): ExternalEntity {
    // Use directory-based title: "001-test-feature (research)" instead of extracted title
    const title = featureDirName
      ? `${featureDirName} (${doc.fileName})`
      : doc.title;

    // Read raw file content (including frontmatter) instead of processed content
    let rawContent = doc.content;
    try {
      rawContent = readFileSync(doc.filePath, "utf-8");
    } catch {
      // Fall back to parsed content if file read fails
    }

    // Supporting doc references Plan relationship
    const relationships: ExternalEntity["relationships"] = [];
    if (featureNumber) {
      const planId = getFeaturePlanId(featureNumber, this.options.spec_prefix || "sk");
      relationships.push({
        targetId: planId,
        targetType: "spec",
        relationshipType: "references",
      });
    }

    return {
      id,
      type: "spec",
      title,
      description: rawContent,
      relationships: relationships.length > 0 ? relationships : undefined,
      raw: {
        docType: doc.type,
        metadata: Object.fromEntries(doc.metadata),
        crossReferences: doc.crossReferences,
        filePath: doc.filePath,
        fileName: doc.fileName,
        fileExtension: doc.fileExtension,
      },
    };
  }

  /**
   * Convert a parsed contract to ExternalEntity
   * @param contract - Parsed contract data
   * @param id - External entity ID
   * @param featureDirName - Feature directory name (e.g., "001-test-feature")
   * @param featureNumber - Feature number (e.g., "001") for relationship creation
   */
  private contractToExternalEntity(
    contract: ParsedContract,
    id: string,
    featureDirName?: string,
    featureNumber?: string
  ): ExternalEntity {
    // Use directory-based title: "001-test-feature (contract-api)" instead of contract name
    const title = featureDirName
      ? `${featureDirName} (contract-${contract.name})`
      : contract.name;

    // Contract references Plan relationship
    const relationships: ExternalEntity["relationships"] = [];
    if (featureNumber) {
      const planId = getFeaturePlanId(featureNumber, this.options.spec_prefix || "sk");
      relationships.push({
        targetId: planId,
        targetType: "spec",
        relationshipType: "references",
      });
    }

    return {
      id,
      type: "spec",
      title,
      description: JSON.stringify(contract.data, null, 2),
      relationships: relationships.length > 0 ? relationships : undefined,
      raw: {
        contractName: contract.name,
        format: contract.format,
        data: contract.data,
        filePath: contract.filePath,
      },
    };
  }

  /**
   * Map spec-kit status to sudocode priority
   * Draft/Open -> lower priority, Complete -> normal
   */
  private statusToPriority(status: string | null): number {
    if (!status) return 2;

    const statusLower = status.toLowerCase();
    if (statusLower === "draft" || statusLower === "open") {
      return 3; // Lower priority for drafts
    }
    if (
      statusLower === "in progress" ||
      statusLower === "in_progress" ||
      statusLower === "active"
    ) {
      return 1; // Higher priority for in-progress
    }
    if (
      statusLower === "complete" ||
      statusLower === "completed" ||
      statusLower === "done"
    ) {
      return 2; // Normal priority for complete
    }
    return 2; // Default
  }
}

export default specKitPlugin;
