/**
 * Project Agent Executor
 *
 * Manages the lifecycle and execution of the project agent.
 * The project agent runs continuously in monitoring mode, listening to events,
 * analyzing project state, and proposing actions.
 */

import type Database from "better-sqlite3";
import type { ProjectAgentConfig, ProjectAgentExecution } from "@sudocode-ai/types";
import { ActionManager } from "./project-agent-actions.js";
import { getEventBus, type EventPayload, type Subscription } from "./event-bus.js";
import {
  createProjectAgentExecution,
  updateProjectAgentExecutionStatus,
  getRunningProjectAgentExecution,
  incrementProjectAgentMetric,
} from "./project-agent-db.js";
import { SudocodeClient } from "@sudocode-ai/cli/dist/client.js";
import { readFileSync } from "fs";
import * as path from "path";

/**
 * Project Agent Executor
 *
 * Orchestrates the project agent lifecycle and decision-making loop.
 */
export class ProjectAgentExecutor {
  private db: Database.Database;
  private repoPath: string;
  private config: ProjectAgentConfig;
  private executionService: any;
  private actionManager: ActionManager;
  private cliClient: SudocodeClient;
  private execution: ProjectAgentExecution | null = null;
  private running = false;
  private eventSubscription: Subscription | null = null;
  private analysisIntervalId: NodeJS.Timeout | null = null;

  constructor(
    db: Database.Database,
    repoPath: string,
    config: ProjectAgentConfig,
    executionService: any
  ) {
    this.db = db;
    this.repoPath = repoPath;
    this.config = config;
    this.executionService = executionService;
    this.actionManager = new ActionManager(db, config, repoPath, executionService);
    this.cliClient = new SudocodeClient({
      workingDir: repoPath,
    });
  }

  /**
   * Start the project agent
   */
  async start(): Promise<ProjectAgentExecution> {
    if (this.running) {
      throw new Error("Project agent is already running");
    }

    // Check if there's already a running project agent
    const existing = getRunningProjectAgentExecution(this.db);
    if (existing) {
      throw new Error("A project agent is already running");
    }

    console.log("[project-agent] Starting project agent...");

    // Create execution record
    this.execution = createProjectAgentExecution(this.db, {
      mode: this.config.mode,
      config: this.config,
      worktreePath: this.config.worktreePath,
    });

    this.running = true;

    // Start event listener
    this.startEventListener();

    // Start periodic analysis (every 60 seconds in monitoring mode)
    if (this.config.mode === "monitoring") {
      this.analysisIntervalId = setInterval(
        () => this.performPeriodicAnalysis(),
        this.config.monitoring?.checkInterval || 60000
      );
    }

    // Perform initial analysis
    await this.performPeriodicAnalysis();

    console.log(`[project-agent] Project agent started with execution ID: ${this.execution.execution_id}`);

    return this.execution;
  }

  /**
   * Stop the project agent
   */
  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error("Project agent is not running");
    }

    console.log("[project-agent] Stopping project agent...");

    this.running = false;

    // Stop event listener
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
      this.eventSubscription = null;
    }

    // Stop periodic analysis
    if (this.analysisIntervalId) {
      clearInterval(this.analysisIntervalId);
      this.analysisIntervalId = null;
    }

    // Update execution status
    if (this.execution) {
      updateProjectAgentExecutionStatus(this.db, this.execution.id, "stopped");
    }

    console.log("[project-agent] Project agent stopped");
  }

  /**
   * Start listening to events
   */
  private startEventListener(): void {
    const eventBus = getEventBus();

    this.eventSubscription = eventBus.subscribeAll((payload: EventPayload) => {
      this.handleEvent(payload).catch((error) => {
        console.error("[project-agent] Error handling event:", error);
      });
    });

    console.log("[project-agent] Event listener started");
  }

  /**
   * Handle an event from the EventBus
   */
  private async handleEvent(event: EventPayload): Promise<void> {
    if (!this.running || !this.execution) {
      return;
    }

    console.log(`[project-agent] Received event: ${event.type}`, {
      entityType: event.entityType,
      entityId: event.entityId,
    });

    // Increment events processed metric
    incrementProjectAgentMetric(this.db, this.execution.id, "events_processed");

    // Analyze event and potentially propose actions
    await this.analyzeEvent(event);
  }

  /**
   * Analyze an event and decide if action is needed
   */
  private async analyzeEvent(event: EventPayload): Promise<void> {
    // For now, just log events
    // In a full implementation, this would use AI to analyze events and propose actions
    console.log(`[project-agent] Analyzing event: ${event.type}`);

    // Example: If a spec is created, suggest creating issues from it
    if (event.type === "filesystem:spec_created" && event.entityId) {
      console.log(`[project-agent] New spec detected: ${event.entityId}`);
      // Could propose create_issues_from_spec action here
    }

    // Example: If an issue becomes ready, suggest starting execution
    if (event.type === "issue:status_changed" && event.entityId) {
      console.log(`[project-agent] Issue status changed: ${event.entityId}`);
      // Could check if issue is ready and propose start_execution action
    }

    // Example: If an execution completes, suggest next steps
    if (event.type === "execution:completed" && event.executionId) {
      console.log(`[project-agent] Execution completed: ${event.executionId}`);
      // Could analyze results and propose follow-up actions
    }
  }

  /**
   * Perform periodic analysis of project state
   */
  private async performPeriodicAnalysis(): Promise<void> {
    if (!this.running || !this.execution) {
      return;
    }

    console.log("[project-agent] Performing periodic project analysis...");

    try {
      // Get project status
      const status = await this.cliClient.exec(["status"]);
      console.log("[project-agent] Project status:", status);

      // Get ready issues
      const ready = await this.cliClient.exec(["ready"]);
      console.log(`[project-agent] Ready issues: ${ready?.issues?.length || 0}`);

      // Check for stale executions
      const executions = this.db
        .prepare(
          `
          SELECT id, status, created_at, issue_id
          FROM executions
          WHERE status = 'running'
            AND datetime(created_at, '+2 hours') < datetime('now')
        `
        )
        .all();

      if (executions.length > 0) {
        console.log(`[project-agent] Found ${executions.length} stale executions`);
        // Could propose actions to review or cancel stale executions
      }

      // TODO: Add more sophisticated analysis using AI
      // This could include:
      // - Analyzing specs that need issues created
      // - Identifying blocked issues
      // - Detecting failed executions that need attention
      // - Suggesting relationships between specs and issues

    } catch (error) {
      console.error("[project-agent] Error during periodic analysis:", error);
    }
  }

  /**
   * Get current execution
   */
  getExecution(): ProjectAgentExecution | null {
    return this.execution;
  }

  /**
   * Check if project agent is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Global project agent executor instance
 */
let globalExecutor: ProjectAgentExecutor | null = null;

/**
 * Initialize global project agent executor
 */
export function initProjectAgentExecutor(
  db: Database.Database,
  repoPath: string,
  config: ProjectAgentConfig,
  executionService: any
): ProjectAgentExecutor {
  if (globalExecutor) {
    throw new Error("Project agent executor already initialized");
  }

  globalExecutor = new ProjectAgentExecutor(db, repoPath, config, executionService);
  return globalExecutor;
}

/**
 * Get global project agent executor
 */
export function getProjectAgentExecutor(): ProjectAgentExecutor {
  if (!globalExecutor) {
    throw new Error("Project agent executor not initialized");
  }
  return globalExecutor;
}

/**
 * Destroy global project agent executor
 */
export async function destroyProjectAgentExecutor(): Promise<void> {
  if (globalExecutor) {
    if (globalExecutor.isRunning()) {
      await globalExecutor.stop();
    }
    globalExecutor = null;
  }
}
