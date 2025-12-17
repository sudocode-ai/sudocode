/**
 * File watcher for Spec-Kit integration
 *
 * Watches the .specify directory for changes to spec files, plans, tasks,
 * and supporting documents. Detects which entities were created, updated, or deleted.
 */

import chokidar, { type FSWatcher } from "chokidar";
import * as path from "path";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import type { ExternalChange, ExternalEntity } from "@sudocode-ai/types";
import { parseSpec } from "./parser/spec-parser.js";
import { parsePlan } from "./parser/plan-parser.js";
import { parseTasks, type ParsedTask } from "./parser/tasks-parser.js";
import {
  discoverSupportingDocs,
  type ParsedSupportingDoc,
  type ParsedContract,
} from "./parser/supporting-docs.js";
import {
  generateSpecId,
  generateTaskIssueId,
  parseSpecId,
  getFeatureSpecId,
  getFeaturePlanId,
} from "./id-generator.js";

/**
 * Callback type for change notifications
 */
export type ChangeCallback = (changes: ExternalChange[]) => void;

/**
 * Options for the SpecKitWatcher
 */
export interface SpecKitWatcherOptions {
  /** Path to the .specify directory */
  specifyPath: string;
  /** Prefix for spec IDs (default: "sk") */
  specPrefix?: string;
  /** Prefix for task IDs (default: "skt") */
  taskPrefix?: string;
  /** Include supporting docs (default: true) */
  includeSupportingDocs?: boolean;
  /** Include constitution (default: true) */
  includeConstitution?: boolean;
}

/**
 * SpecKitWatcher monitors the .specify directory for changes
 *
 * Uses content hashing to detect actual changes vs just file touches.
 * This prevents false positives from atomic writes and other file operations.
 */
export class SpecKitWatcher {
  private watcher: FSWatcher | null = null;
  private entityHashes: Map<string, string> = new Map();
  private callback: ChangeCallback | null = null;
  private isProcessing = false;
  private isRelevantFile: ((filePath: string) => boolean) | null = null;

  private readonly specifyPath: string;
  private readonly specPrefix: string;
  private readonly taskPrefix: string;
  private readonly includeSupportingDocs: boolean;
  private readonly includeConstitution: boolean;

  constructor(options: SpecKitWatcherOptions) {
    this.specifyPath = options.specifyPath;
    this.specPrefix = options.specPrefix || "sk";
    this.taskPrefix = options.taskPrefix || "skt";
    this.includeSupportingDocs = options.includeSupportingDocs !== false;
    this.includeConstitution = options.includeConstitution !== false;
  }

  /**
   * Update the cached hash for a specific entity after we wrote to it.
   * This prevents the watcher from detecting our own writes as changes.
   */
  updateEntityHash(entityId: string, hash: string): void {
    console.log(
      `[spec-kit-watcher] Updated hash for ${entityId} after outbound write`
    );
    this.entityHashes.set(entityId, hash);
  }

  /**
   * Remove an entity from the hash cache (after deletion)
   */
  removeEntityHash(entityId: string): void {
    console.log(
      `[spec-kit-watcher] Removed hash for ${entityId} after outbound delete`
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
      console.warn("[spec-kit-watcher] Already watching");
      return;
    }

    this.callback = callback;

    // Capture initial state
    this.captureState();

    // Watch paths - use directories instead of glob patterns for better compatibility
    const watchPaths: string[] = [];

    // Watch specs directory (chokidar will recursively watch subdirectories)
    const specsDir = path.join(this.specifyPath, "specs");
    if (existsSync(specsDir)) {
      watchPaths.push(specsDir);
    }

    // Watch constitution
    if (this.includeConstitution) {
      const constitutionPath = path.join(
        this.specifyPath,
        "memory",
        "constitution.md"
      );
      if (existsSync(path.dirname(constitutionPath))) {
        watchPaths.push(constitutionPath);
      }
    }

    if (watchPaths.length === 0) {
      console.warn("[spec-kit-watcher] No paths to watch");
      return;
    }

    console.log(`[spec-kit-watcher] Watching paths:`, watchPaths);

    // Only include .md, .json, .yaml, .yml files we care about
    // Filter function to only process relevant files
    const isRelevantFile = (filePath: string): boolean => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".md") return true;
      if (this.includeSupportingDocs) {
        if ([".json", ".yaml", ".yml"].includes(ext)) {
          // Only include contract files
          return filePath.includes("/contracts/");
        }
      }
      return false;
    };

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for writes to settle
        pollInterval: 50,
      },
      // Note: Don't use 'ignored' patterns with chokidar v4 as they prevent directory scanning
      // We filter files in handleFileChange/handleFileDeleted instead
    });

    // Store file filter for use in handlers
    this.isRelevantFile = isRelevantFile;

    this.watcher.on("ready", () => {
      const watched = this.watcher?.getWatched() || {};
      const dirs = Object.keys(watched);
      console.log(
        `[spec-kit-watcher] ✓ Ready, watching ${dirs.length} directories in ${this.specifyPath}`
      );
    });

    this.watcher.on("change", (filePath) => this.handleFileChange(filePath));
    this.watcher.on("add", (filePath) => this.handleFileChange(filePath));
    this.watcher.on("unlink", (filePath) => this.handleFileDeleted(filePath));

    this.watcher.on("error", (error) => {
      console.error("[spec-kit-watcher] Error:", error);
    });

    console.log(
      `[spec-kit-watcher] Setting up watcher for ${this.specifyPath}...`
    );
  }

  /**
   * Stop watching for changes
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.callback = null;
      console.log("[spec-kit-watcher] Stopped");
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
   *
   * Uses content hashing to detect actual changes - no explicit debouncing needed.
   * Chokidar's awaitWriteFinish handles write settling, and hash comparison
   * filters out false positives from atomic writes.
   */
  private handleFileChange(filePath: string): void {
    // Filter out non-relevant files
    if (this.isRelevantFile && !this.isRelevantFile(filePath)) {
      return;
    }
    console.log(`[spec-kit-watcher] File changed: ${filePath}`);
    this.processChanges();
  }

  /**
   * Handle file deleted event
   */
  private handleFileDeleted(filePath: string): void {
    // Filter out non-relevant files
    if (this.isRelevantFile && !this.isRelevantFile(filePath)) {
      return;
    }
    console.log(`[spec-kit-watcher] File deleted: ${filePath}`);
    this.processChanges();
  }

  /**
   * Process changes by comparing current state to cached hashes
   *
   * Uses isProcessing flag to prevent concurrent processing if multiple
   * file events fire rapidly. Content hashing ensures only actual changes
   * are reported.
   */
  private processChanges(): void {
    // Prevent concurrent processing
    if (this.isProcessing) {
      console.log("[spec-kit-watcher] Already processing, skipping");
      return;
    }

    this.isProcessing = true;

    try {
      const changes = this.detectChanges();

      if (changes.length > 0) {
        console.log(
          `[spec-kit-watcher] Detected ${changes.length} entity change(s):`,
          changes.map((c) => `${c.change_type}:${c.entity_id}`).join(", ")
        );
        if (this.callback) {
          this.callback(changes);
        }
      } else {
        console.log(
          "[spec-kit-watcher] No actual content changes (hashes match)"
        );
      }
    } catch (error) {
      console.error("[spec-kit-watcher] Error processing changes:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Capture current state (entity hashes) for comparison
   */
  captureState(): void {
    console.log("[spec-kit-watcher] Capturing initial state...");
    const entities = this.scanAllEntities();

    this.entityHashes.clear();
    for (const entity of entities) {
      const hash = this.computeEntityHash(entity);
      this.entityHashes.set(entity.id, hash);
    }
    console.log(
      `[spec-kit-watcher] Captured state with ${this.entityHashes.size} entities`
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
        const parsed = parseSpecId(id);
        const entityType: "spec" | "issue" = parsed?.isTask ? "issue" : "spec";

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
   * Scan all entities in the .specify directory
   */
  private scanAllEntities(): ExternalEntity[] {
    const entities: ExternalEntity[] = [];

    // Scan specs directory
    const specsDir = path.join(this.specifyPath, "specs");
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
                this.specPrefix
              );
              entities.push(
                this.specToExternalEntity(spec, specId, entry.name, "spec")
              );
            }
          }

          // Parse plan.md
          const planPath = path.join(featureDir, "plan.md");
          if (existsSync(planPath)) {
            const plan = parsePlan(planPath);
            if (plan) {
              const planId = generateSpecId(
                `specs/${entry.name}/plan.md`,
                this.specPrefix
              );
              entities.push(
                this.planToExternalEntity(
                  plan,
                  planId,
                  entry.name,
                  featureNumber
                )
              );
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
                  this.taskPrefix
                );
                entities.push(
                  this.taskToExternalEntity(
                    task,
                    featureNumber,
                    taskIssueId,
                    tasksPath
                  )
                );
              }
            }
          }

          // Optionally include supporting docs
          if (this.includeSupportingDocs) {
            const docs = discoverSupportingDocs(featureDir);

            if (docs.research) {
              const docId = generateSpecId(
                `specs/${entry.name}/research.md`,
                this.specPrefix
              );
              entities.push(
                this.supportingDocToExternalEntity(
                  docs.research,
                  docId,
                  entry.name,
                  featureNumber
                )
              );
            }

            if (docs.dataModel) {
              const docId = generateSpecId(
                `specs/${entry.name}/data-model.md`,
                this.specPrefix
              );
              entities.push(
                this.supportingDocToExternalEntity(
                  docs.dataModel,
                  docId,
                  entry.name,
                  featureNumber
                )
              );
            }

            for (const contract of docs.contracts) {
              const docId = `${this.specPrefix}-${featureNumber}-contract-${contract.name}`;
              entities.push(
                this.contractToExternalEntity(
                  contract,
                  docId,
                  entry.name,
                  featureNumber
                )
              );
            }

            for (const other of docs.other) {
              const docId = generateSpecId(
                `specs/${entry.name}/${other.fileName}.md`,
                this.specPrefix
              );
              entities.push(
                this.supportingDocToExternalEntity(
                  other,
                  docId,
                  entry.name,
                  featureNumber
                )
              );
            }
          }
        }
      } catch (error) {
        console.error(
          "[spec-kit-watcher] Error scanning specs directory:",
          error
        );
      }
    }

    // Include constitution.md if configured
    if (this.includeConstitution) {
      const constitutionPath = path.join(
        this.specifyPath,
        "memory",
        "constitution.md"
      );
      if (existsSync(constitutionPath)) {
        const spec = parseSpec(constitutionPath);
        if (spec) {
          const constitutionId = `${this.specPrefix}-constitution`;
          entities.push(this.specToExternalEntity(spec, constitutionId));
        }
      }
    }

    return entities;
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

  /**
   * Convert a parsed spec to ExternalEntity
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
   */
  private planToExternalEntity(
    plan: import("./parser/plan-parser.js").ParsedSpecKitPlan,
    id: string,
    featureDirName?: string,
    featureNumber?: string
  ): ExternalEntity {
    // Use directory-based title: "001-test-feature (plan)" instead of extracted title
    const title = featureDirName ? `${featureDirName} (plan)` : plan.title;

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
      const specId = getFeatureSpecId(featureNumber, this.specPrefix);
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
    const planId = getFeaturePlanId(featureNumber, this.specPrefix);
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
      priority: task.parallelizable ? 1 : 2,
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
      const planId = getFeaturePlanId(featureNumber, this.specPrefix);
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
   */
  private contractToExternalEntity(
    contract: ParsedContract,
    id: string,
    featureDirName?: string,
    featureNumber?: string
  ): ExternalEntity {
    // Use directory-based title: "001-test-feature (contract-api)" instead of just contract name
    const title = featureDirName
      ? `${featureDirName} (contract-${contract.name})`
      : contract.name;

    // Read raw file content for contracts
    let rawContent = JSON.stringify(contract.data, null, 2);
    try {
      rawContent = readFileSync(contract.filePath, "utf-8");
    } catch {
      // Fall back to stringified data if file read fails
    }

    // Contract references Plan relationship
    const relationships: ExternalEntity["relationships"] = [];
    if (featureNumber) {
      const planId = getFeaturePlanId(featureNumber, this.specPrefix);
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
        contractName: contract.name,
        format: contract.format,
        data: contract.data,
        filePath: contract.filePath,
      },
    };
  }

  /**
   * Map spec-kit status to sudocode priority
   */
  private statusToPriority(status: string | null): number {
    if (!status) return 2;

    const statusLower = status.toLowerCase();
    if (statusLower === "draft" || statusLower === "open") {
      return 3;
    }
    if (
      statusLower === "in progress" ||
      statusLower === "in_progress" ||
      statusLower === "active"
    ) {
      return 1;
    }
    if (
      statusLower === "complete" ||
      statusLower === "completed" ||
      statusLower === "done"
    ) {
      return 2;
    }
    return 2;
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
