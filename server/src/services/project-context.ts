import type Database from "better-sqlite3";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import type { ExecutionService } from "./execution-service.js";
import type { ExecutionLogsStore } from "./execution-logs-store.js";
import type { ServerWatcherControl } from "./watcher.js";
import type { WorktreeManager } from "../execution/worktree/manager.js";
import type { ExecutionWorkerPool } from "./execution-worker-pool.js";
import type { IWorkflowEngine } from "../workflow/workflow-engine.js";
import type { WorkflowBroadcastService } from "./workflow-broadcast-service.js";
import type { WorkflowEngineType } from "@sudocode-ai/types/workflows";
import type { IntegrationSyncService } from "./integration-sync-service.js";

/**
 * ProjectContext encapsulates all services and resources for a single open project.
 *
 * Each project maintains isolated:
 * - Database connection
 * - File watcher
 * - Execution service
 * - Transport manager (for SSE streaming)
 * - Logs store
 * - Worktree manager
 *
 * This ensures that operations on one project don't interfere with others.
 */
export class ProjectContext {
  /** Unique project identifier */
  readonly id: string;

  /** Absolute path to project root directory */
  readonly path: string;

  /** Absolute path to .sudocode directory */
  readonly sudocodeDir: string;

  /** SQLite database connection for this project */
  readonly db: Database.Database;

  /** Transport manager for SSE streaming */
  readonly transportManager: TransportManager;

  /** Execution service for managing issue executions */
  readonly executionService: ExecutionService;

  /** Logs store for execution output */
  readonly logsStore: ExecutionLogsStore;

  /** Worktree manager for execution isolation */
  readonly worktreeManager: WorktreeManager;

  /** Worker pool for isolated execution processes (optional) */
  readonly workerPool: ExecutionWorkerPool | undefined;

  /** Sequential workflow engine for server-managed step execution */
  sequentialWorkflowEngine: IWorkflowEngine | undefined;

  /** Orchestrator workflow engine for AI-managed workflow execution */
  orchestratorWorkflowEngine: IWorkflowEngine | undefined;

  /** @deprecated Use sequentialWorkflowEngine or orchestratorWorkflowEngine instead */
  get workflowEngine(): IWorkflowEngine | undefined {
    return this.sequentialWorkflowEngine;
  }

  /** @deprecated Use sequentialWorkflowEngine or orchestratorWorkflowEngine instead */
  set workflowEngine(engine: IWorkflowEngine | undefined) {
    this.sequentialWorkflowEngine = engine;
  }

  /** Workflow broadcast service for WebSocket events (optional) */
  workflowBroadcastService: WorkflowBroadcastService | undefined;

  /** Integration sync service for external system synchronization (optional) */
  integrationSyncService: IntegrationSyncService | undefined;

  /** File watcher for detecting changes */
  watcher: ServerWatcherControl | null = null;

  /** Timestamp when project was opened */
  readonly openedAt: Date;

  constructor(
    id: string,
    path: string,
    sudocodeDir: string,
    db: Database.Database,
    transportManager: TransportManager,
    executionService: ExecutionService,
    logsStore: ExecutionLogsStore,
    worktreeManager: WorktreeManager,
    workerPool?: ExecutionWorkerPool
  ) {
    this.id = id;
    this.path = path;
    this.sudocodeDir = sudocodeDir;
    this.db = db;
    this.transportManager = transportManager;
    this.executionService = executionService;
    this.logsStore = logsStore;
    this.worktreeManager = worktreeManager;
    this.workerPool = workerPool;
    this.openedAt = new Date();
  }

  /**
   * Initialize the project context (start file watcher, etc.)
   */
  async initialize(): Promise<void> {
    // File watcher will be started by the caller if needed
    // (allows for SUDOCODE_WATCH=false configuration)
    console.log(`Project context initialized: ${this.id} at ${this.path}`);
  }

  /**
   * Shutdown the project context and cleanup all resources
   */
  async shutdown(): Promise<void> {
    console.log(`Shutting down project context: ${this.id}`);

    try {
      // 1. Shutdown worker pool (kill all workers)
      if (this.workerPool) {
        await this.workerPool.shutdown();
      }

      // 2. Cancel active executions (non-worker based)
      if (this.executionService) {
        await this.executionService.shutdown();
      }

      // 3. Dispose workflow broadcast service
      if (this.workflowBroadcastService) {
        this.workflowBroadcastService.dispose();
        this.workflowBroadcastService = undefined;
      }

      // 3b. Stop integration sync service
      if (this.integrationSyncService) {
        await this.integrationSyncService.stop();
        this.integrationSyncService = undefined;
      }

      // 4. Stop file watcher
      if (this.watcher) {
        this.watcher.stop();
        this.watcher = null;
      }

      // 5. Close transport streams
      if (this.transportManager) {
        this.transportManager.shutdown();
      }

      // 6. Database will be closed by ProjectManager (it manages the cache)

      console.log(`Project context shutdown complete: ${this.id}`);
    } catch (error) {
      console.error(`Error during project context shutdown: ${this.id}`, error);
      throw error;
    }
  }

  /**
   * Check if the project context is active (has active executions)
   */
  hasActiveExecutions(): boolean {
    // Check worker pool if available, otherwise check execution service
    if (this.workerPool) {
      return this.workerPool.getActiveWorkerCount() > 0;
    }
    // For in-process execution, check the execution service
    return this.executionService.hasActiveExecutions();
  }

  /**
   * Get summary information about this project context
   */
  getSummary() {
    return {
      id: this.id,
      path: this.path,
      sudocodeDir: this.sudocodeDir,
      openedAt: this.openedAt,
      hasWatcher: this.watcher !== null,
      hasActiveExecutions: this.hasActiveExecutions(),
    };
  }

  /**
   * Get the appropriate workflow engine based on engine type
   * @param engineType - The type of engine to use (defaults to "sequential")
   * @returns The workflow engine for the specified type
   * @throws Error if the requested engine is not available
   */
  getWorkflowEngine(
    engineType: WorkflowEngineType = "sequential"
  ): IWorkflowEngine {
    if (engineType === "orchestrator") {
      if (!this.orchestratorWorkflowEngine) {
        throw new Error("Orchestrator workflow engine is not available");
      }
      return this.orchestratorWorkflowEngine;
    }

    if (!this.sequentialWorkflowEngine) {
      throw new Error("Sequential workflow engine is not available");
    }
    return this.sequentialWorkflowEngine;
  }

  /**
   * Update the server URL for workflow engines that need it.
   * Called after dynamic port discovery.
   */
  updateServerUrl(serverUrl: string): void {
    // Only OrchestratorWorkflowEngine needs the server URL
    const engine = this.orchestratorWorkflowEngine;
    if (
      engine &&
      "setServerUrl" in engine &&
      typeof engine.setServerUrl === "function"
    ) {
      engine.setServerUrl(serverUrl);
    }
  }
}
