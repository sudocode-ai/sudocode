import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";
import { ProjectRegistry } from "./project-registry.js";
import { ProjectContext } from "./project-context.js";
import { initDatabase } from "./db.js";
import { ExecutionService } from "./execution-service.js";
import { ExecutionLogsStore } from "./execution-logs-store.js";
import { ExecutionLifecycleService } from "./execution-lifecycle.js";
import { WorktreeManager } from "../execution/worktree/manager.js";
import { getWorktreeConfig } from "../execution/worktree/config.js";
import { startServerWatcher } from "./watcher.js";
import type { ProjectError, Result } from "../types/project.js";
import { Ok, Err } from "../types/project.js";
import { broadcastIssueUpdate, broadcastSpecUpdate } from "./websocket.js";
import { getIssueById } from "./issues.js";
import { getSpecById } from "./specs.js";
import {
  performInitialization,
  isInitialized,
} from "@sudocode-ai/cli/dist/cli/init-commands.js";
import { WorkflowEventEmitter } from "../workflow/workflow-event-emitter.js";
import { createIntegrationSyncService } from "./integration-sync-service.js";
import { SequentialWorkflowEngine } from "../workflow/engines/sequential-engine.js";
import { OrchestratorWorkflowEngine } from "../workflow/engines/orchestrator-engine.js";
import { WorkflowWakeupService } from "../workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../workflow/services/prompt-builder.js";
import { WorkflowBroadcastService } from "./workflow-broadcast-service.js";

interface CachedDatabase {
  db: Database.Database;
  lastAccessed: Date;
  evictionTimer?: NodeJS.Timeout;
}

/**
 * ProjectManager manages the lifecycle of multiple open projects.
 *
 * Responsibilities:
 * - Open and close projects
 * - Validate project directories
 * - Cache database connections with TTL eviction
 * - Track all open projects
 * - Coordinate with ProjectRegistry for persistence
 *
 * Architecture:
 * - Each open project gets a ProjectContext with isolated services
 * - Database connections are cached for 30 minutes after project close
 * - All services (file watcher, executions, etc.) are per-project
 */
export class ProjectManager {
  private registry: ProjectRegistry;
  private openProjects: Map<string, ProjectContext> = new Map();
  private dbCache: Map<string, CachedDatabase> = new Map();

  /** Database connection TTL: 30 minutes */
  private readonly DB_CACHE_TTL = 30 * 60 * 1000;

  /** Whether file watching is enabled */
  private readonly watchEnabled: boolean;

  /** Actual server URL (updated after dynamic port discovery) */
  private actualServerUrl: string | null = null;

  constructor(registry: ProjectRegistry, options?: { watchEnabled?: boolean }) {
    this.registry = registry;
    this.watchEnabled = options?.watchEnabled ?? true;
  }

  /**
   * Open a project and initialize all its services
   * @param projectPath - Absolute path to project root directory
   * @returns ProjectContext for the opened project
   */
  async openProject(
    projectPath: string
  ): Promise<Result<ProjectContext, ProjectError>> {
    try {
      // 1. Validate project structure
      const validation = this.validateProject(projectPath);
      if (!validation.ok) {
        return validation as Result<ProjectContext, ProjectError>;
      }

      // 2. Generate or lookup project ID
      const projectId = this.registry.generateProjectId(projectPath);

      // 3. Check if already open
      const existing = this.openProjects.get(projectId);
      if (existing) {
        console.log(`Project already open: ${projectId}`);
        this.registry.updateLastOpened(projectId);
        await this.registry.save();
        return Ok(existing);
      }

      // 4. Initialize database (check cache first)
      const db = await this.getOrCreateDatabase(projectId, projectPath);

      // 5. Initialize all services for this project
      const sudocodeDir = path.join(projectPath, ".sudocode");
      const logsStore = new ExecutionLogsStore(db);
      const worktreeConfig = getWorktreeConfig(projectPath);
      const worktreeManager = new WorktreeManager(worktreeConfig);

      // NOTE: Worker pool execution is disabled - using in-process execution
      // Worker pool can be re-enabled by uncommenting the ExecutionWorkerPool creation
      // and passing it to ExecutionService and ProjectContext

      // Create execution service without worker pool (will use in-process execution)
      const executionService = new ExecutionService(
        db,
        projectId,
        projectPath,
        undefined,
        logsStore,
        undefined // No worker pool - use in-process execution
      );

      // 6. Create project context
      const context = new ProjectContext(
        projectId,
        projectPath,
        sudocodeDir,
        db,
        executionService,
        logsStore,
        worktreeManager,
        undefined // No worker pool
      );

      await context.initialize();

      // 7. Initialize workflow engines and broadcast service
      const workflowEventEmitter = new WorkflowEventEmitter();

      // Create lifecycle service for workflow worktree management
      const lifecycleService = new ExecutionLifecycleService(
        db,
        projectPath,
        worktreeManager
      );

      // Create sequential workflow engine
      const sequentialWorkflowEngine = new SequentialWorkflowEngine(
        db,
        executionService,
        lifecycleService,
        projectPath,
        workflowEventEmitter
      );

      // Create orchestrator workflow engine with its dependencies
      const promptBuilder = new WorkflowPromptBuilder();
      const wakeupService = new WorkflowWakeupService({
        db,
        executionService,
        promptBuilder,
        eventEmitter: workflowEventEmitter,
      });
      // Use actual server URL if known, otherwise fall back to default
      // (will be updated after port discovery via updateServerUrl())
      const serverUrl =
        this.actualServerUrl ||
        `http://localhost:${process.env.SUDOCODE_PORT || "3000"}`;

      const orchestratorWorkflowEngine = new OrchestratorWorkflowEngine({
        db,
        executionService,
        lifecycleService,
        wakeupService,
        eventEmitter: workflowEventEmitter,
        config: {
          repoPath: projectPath,
          dbPath: path.join(projectPath, ".sudocode", "cache.db"),
          serverUrl,
          projectId,
        },
      });

      const workflowBroadcastService = new WorkflowBroadcastService(
        workflowEventEmitter,
        () => projectId // Simple lookup - this project owns all its workflows
      );

      context.sequentialWorkflowEngine = sequentialWorkflowEngine;
      context.orchestratorWorkflowEngine = orchestratorWorkflowEngine;
      context.workflowBroadcastService = workflowBroadcastService;

      // 7b. Run workflow recovery
      console.log(
        `[project-manager] Starting workflow recovery for ${projectId}...`
      );

      // Sequential engine recovery (must run before wakeup service)
      try {
        await sequentialWorkflowEngine.recoverWorkflows();
      } catch (error) {
        console.error(
          `[project-manager] Failed to recover sequential workflows for ${projectId}:`,
          error
        );
        // Don't fail the open operation
      }

      // Orchestrator engine recovery
      try {
        if (orchestratorWorkflowEngine.markStaleExecutionsAsFailed) {
          await orchestratorWorkflowEngine.markStaleExecutionsAsFailed();
        }
        if (orchestratorWorkflowEngine.recoverOrphanedWorkflows) {
          await orchestratorWorkflowEngine.recoverOrphanedWorkflows();
        }
      } catch (error) {
        console.error(
          `[project-manager] Failed to recover orchestrator workflows for ${projectId}:`,
          error
        );
        // Don't fail the open operation
      }

      // Wakeup service recovery (recovers await conditions and pending wakeups)
      try {
        await wakeupService.recoverState();
      } catch (error) {
        console.error(
          `[project-manager] Failed to recover wakeup service state for ${projectId}:`,
          error
        );
        // Don't fail the open operation
      }

      console.log(
        `[project-manager] Workflow recovery complete for ${projectId}`
      );

      // 8. Start file watcher if enabled
      if (this.watchEnabled) {
        context.watcher = startServerWatcher({
          db,
          baseDir: sudocodeDir,
          onFileChange: (info) => {
            console.log(`[project-manager] File change in ${projectId}`);

            // Broadcast WebSocket updates based on entity type
            if (info.entityType && info.entityId) {
              if (info.entityType === "issue") {
                // Use entity from event if available (optimization)
                if (info.entity) {
                  broadcastIssueUpdate(
                    projectId,
                    info.entityId,
                    "updated",
                    info.entity
                  );
                } else {
                  // Fallback to DB query (for backward compatibility)
                  const issue = getIssueById(db, info.entityId);
                  if (issue) {
                    broadcastIssueUpdate(
                      projectId,
                      info.entityId,
                      "updated",
                      issue
                    );
                  }
                }
              } else if (info.entityType === "spec") {
                // Use entity from event if available (optimization)
                if (info.entity) {
                  broadcastSpecUpdate(
                    projectId,
                    info.entityId,
                    "updated",
                    info.entity
                  );
                } else {
                  // Fallback to DB query (for backward compatibility)
                  const spec = getSpecById(db, info.entityId);
                  if (spec) {
                    broadcastSpecUpdate(
                      projectId,
                      info.entityId,
                      "updated",
                      spec
                    );
                  }
                }
              }
            }
          },
        });
      }

      // 8. Cleanup orphaned worktrees on first open
      // TODO: Re-enable periodic cleanup when worktree orphan detection is stable.
      // if (worktreeConfig.cleanupOrphanedWorktreesOnStartup) {
      //   try {
      //     const lifecycleService = new ExecutionLifecycleService(
      //       db,
      //       projectPath,
      //       worktreeManager
      //     );
      //     await lifecycleService.cleanupOrphanedWorktrees();
      //     console.log(`Cleaned up orphaned worktrees for ${projectId}`);
      //   } catch (error) {
      //     console.warn(
      //       `Failed to cleanup orphaned worktrees for ${projectId}:`,
      //       error
      //     );
      //     // Don't fail the open operation
      //   }
      // }

      // 9. Initialize integration sync service for external systems
      try {
        const integrationSyncService = createIntegrationSyncService({
          projectId,
          projectPath,
          sudocodeDir,
        });
        context.integrationSyncService = integrationSyncService;

        // Start in background (don't block project open on integration startup)
        integrationSyncService.start().catch((error) => {
          console.warn(
            `[project-manager] Failed to start integration sync for ${projectId}:`,
            error
          );
          // Don't fail the open operation
        });
      } catch (error) {
        console.warn(
          `[project-manager] Failed to create integration sync service for ${projectId}:`,
          error
        );
        // Don't fail the open operation
      }

      // 10. Register and track
      this.registry.registerProject(projectPath);
      this.registry.updateLastOpened(projectId);
      await this.registry.save();

      this.openProjects.set(projectId, context);

      console.log(
        `Project opened successfully: ${projectId} at ${projectPath}`
      );
      return Ok(context);
    } catch (error: any) {
      console.error(`Failed to open project at ${projectPath}:`, error);
      return Err({
        type: "UNKNOWN",
        message: error.message || String(error),
      });
    }
  }

  /**
   * Initialize a new sudocode project in an existing directory
   * @param projectPath - Absolute path to project root directory
   * @param name - Optional custom project name
   * @returns ProjectContext for the initialized and opened project
   */
  async initializeProject(
    projectPath: string,
    name?: string
  ): Promise<Result<ProjectContext, ProjectError>> {
    try {
      // 1. Check that path exists
      if (!fs.existsSync(projectPath)) {
        return Err({
          type: "PATH_NOT_FOUND",
          path: projectPath,
        });
      }

      // 2. Check that it's a directory
      const stats = fs.statSync(projectPath);
      if (!stats.isDirectory()) {
        return Err({
          type: "INVALID_PROJECT",
          message: `Path is not a directory: ${projectPath}`,
        });
      }

      // 3. Check if already initialized
      const sudocodeDir = path.join(projectPath, ".sudocode");
      if (isInitialized(sudocodeDir)) {
        // Already initialized, just open it
        console.log(
          `Project already initialized at ${projectPath}, opening...`
        );
        return this.openProject(projectPath);
      }

      // 4. Perform initialization using CLI's performInitialization
      console.log(`Initializing new project at ${projectPath}`);
      await performInitialization({
        dir: sudocodeDir,
        jsonOutput: true, // Suppress CLI console output
      });

      // 5. Update project name in registry if provided
      const projectId = this.registry.generateProjectId(projectPath);
      if (name) {
        this.registry.registerProject(projectPath);
        this.registry.updateProject(projectId, { name });
        await this.registry.save();
      }

      // 6. Open the newly initialized project
      return this.openProject(projectPath);
    } catch (error: any) {
      console.error(`Failed to initialize project at ${projectPath}:`, error);
      return Err({
        type: "UNKNOWN",
        message: error.message || String(error),
      });
    }
  }

  /**
   * Close a project and cleanup its resources
   * @param projectId - Project ID to close
   * @param keepDbInCache - Whether to keep database in cache (default: true)
   */
  async closeProject(
    projectId: string,
    keepDbInCache: boolean = true
  ): Promise<void> {
    const context = this.openProjects.get(projectId);
    if (!context) {
      console.warn(`Cannot close project ${projectId}: not open`);
      return;
    }

    console.log(`Closing project: ${projectId}`);

    try {
      // Shutdown project context (stops watcher, cancels executions, etc.)
      await context.shutdown();

      // Keep DB in cache for fast reopening (unless explicitly disabled)
      if (keepDbInCache) {
        this.addToDbCache(projectId, context.db);
      } else {
        context.db.close();
      }

      // Remove from active projects
      this.openProjects.delete(projectId);

      // TODO: Broadcast project_closed WebSocket message

      console.log(`Project closed: ${projectId}`);
    } catch (error) {
      console.error(`Error closing project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Get an open project by ID
   */
  getProject(projectId: string): ProjectContext | null {
    return this.openProjects.get(projectId) || null;
  }

  /**
   * Get all currently open projects
   */
  getAllOpenProjects(): ProjectContext[] {
    return Array.from(this.openProjects.values());
  }

  /**
   * Check if a project is currently open
   */
  isProjectOpen(projectId: string): boolean {
    return this.openProjects.has(projectId);
  }

  /**
   * Validate that a project directory is valid for opening
   */
  private validateProject(projectPath: string): Result<void, ProjectError> {
    // Check that path exists
    if (!fs.existsSync(projectPath)) {
      return Err({
        type: "PATH_NOT_FOUND",
        path: projectPath,
      });
    }

    // Check that it's a directory
    const stats = fs.statSync(projectPath);
    if (!stats.isDirectory()) {
      return Err({
        type: "INVALID_PROJECT",
        message: `Path is not a directory: ${projectPath}`,
      });
    }

    // Check that .sudocode directory exists
    const sudocodeDir = path.join(projectPath, ".sudocode");
    if (!fs.existsSync(sudocodeDir)) {
      return Err({
        type: "INVALID_PROJECT",
        message: `Missing .sudocode directory: ${sudocodeDir}`,
      });
    }

    // Check that cache.db exists
    const dbPath = path.join(sudocodeDir, "cache.db");
    if (!fs.existsSync(dbPath)) {
      return Err({
        type: "INVALID_PROJECT",
        message: `Missing cache.db file: ${dbPath}`,
      });
    }

    return Ok(undefined);
  }

  /**
   * Get or create a database connection for a project
   * Checks cache first, then initializes new connection
   */
  private async getOrCreateDatabase(
    projectId: string,
    projectPath: string
  ): Promise<Database.Database> {
    // Check cache
    const cached = this.dbCache.get(projectId);
    if (cached) {
      console.log(`Using cached database for ${projectId}`);
      cached.lastAccessed = new Date();

      // Clear eviction timer since we're using it again
      if (cached.evictionTimer) {
        clearTimeout(cached.evictionTimer);
        cached.evictionTimer = undefined;
      }

      // Remove from cache (will be managed by project context)
      this.dbCache.delete(projectId);

      return cached.db;
    }

    // Initialize new database
    const dbPath = path.join(projectPath, ".sudocode", "cache.db");
    console.log(`Initializing new database for ${projectId} at ${dbPath}`);
    const db = initDatabase({ path: dbPath });

    return db;
  }

  /**
   * Add a database to the cache with TTL eviction
   */
  private addToDbCache(projectId: string, db: Database.Database): void {
    // Clear any existing cache entry
    const existing = this.dbCache.get(projectId);
    if (existing?.evictionTimer) {
      clearTimeout(existing.evictionTimer);
    }

    // Add to cache
    const cached: CachedDatabase = {
      db,
      lastAccessed: new Date(),
    };

    // Schedule eviction
    cached.evictionTimer = setTimeout(() => {
      const entry = this.dbCache.get(projectId);
      if (entry) {
        const age = Date.now() - entry.lastAccessed.getTime();
        if (age >= this.DB_CACHE_TTL) {
          console.log(
            `Evicting cached database for ${projectId} (age: ${age}ms)`
          );
          try {
            entry.db.close();
          } catch (error) {
            console.error(
              `Error closing cached database for ${projectId}:`,
              error
            );
          }
          this.dbCache.delete(projectId);
        }
      }
    }, this.DB_CACHE_TTL);

    this.dbCache.set(projectId, cached);
    console.log(
      `Database cached for ${projectId} (TTL: ${this.DB_CACHE_TTL}ms)`
    );
  }

  /**
   * Update the server URL for all open projects.
   * Called after dynamic port discovery to propagate the actual server URL.
   */
  updateServerUrl(serverUrl: string): void {
    // Store for newly opened projects
    this.actualServerUrl = serverUrl;

    for (const project of this.openProjects.values()) {
      project.updateServerUrl(serverUrl);
    }
    console.log(
      `Server URL updated to ${serverUrl} for ${this.openProjects.size} projects`
    );
  }

  /**
   * Get summary of all projects (open and cached)
   */
  getSummary() {
    return {
      openProjects: this.getAllOpenProjects().map((p) => p.getSummary()),
      cachedDatabases: Array.from(this.dbCache.keys()),
      totalOpen: this.openProjects.size,
      totalCached: this.dbCache.size,
    };
  }

  /**
   * Shutdown the project manager and cleanup all resources
   */
  async shutdown(): Promise<void> {
    console.log("Shutting down ProjectManager...");

    // Close all open projects
    const projectIds = Array.from(this.openProjects.keys());
    for (const projectId of projectIds) {
      await this.closeProject(projectId, false); // Don't cache on shutdown
    }

    // Close all cached databases
    for (const [projectId, cached] of this.dbCache.entries()) {
      if (cached.evictionTimer) {
        clearTimeout(cached.evictionTimer);
      }
      try {
        cached.db.close();
      } catch (error) {
        console.error(`Error closing cached database for ${projectId}:`, error);
      }
    }
    this.dbCache.clear();

    console.log("ProjectManager shutdown complete");
  }
}
