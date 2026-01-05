/**
 * Mock Executor for Workflow Testing
 *
 * Provides a mock ExecutionService that simulates agent execution
 * without making actual AI API calls. Allows controlled completion,
 * failure, and timeout scenarios for testing.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import type { Execution, ExecutionStatus } from "@sudocode-ai/types";
import type { AgentType } from "@sudocode-ai/types/agents";
import type {
  ExecutionConfig,
  WorkflowContext,
} from "../../../../src/services/execution-service.js";
import {
  createExecution as dbCreateExecution,
  updateExecution as dbUpdateExecution,
} from "./workflow-test-setup.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Control handle for a pending execution
 */
export interface ExecutionControl {
  /** Complete the execution successfully */
  complete(output?: string): void;
  /** Fail the execution with an error */
  fail(error: string): void;
  /** Add a simulated tool call to the execution */
  addToolCall(toolName: string, args: Record<string, unknown>): void;
  /** Add output content */
  addOutput(content: string): void;
  /** Get the execution ID */
  readonly executionId: string;
  /** Get the current status */
  readonly status: ExecutionStatus;
}

/**
 * Options for MockExecutionService
 */
export interface MockExecutionServiceOptions {
  /** Default delay before auto-completing (0 = manual control) */
  defaultDelayMs?: number;
  /** Default result (success or failure) */
  defaultResult?: "success" | "failure";
  /** Callback when execution is created */
  onExecute?: (executionId: string, issueId: string | null) => void;
}

// =============================================================================
// Mock Execution Service
// =============================================================================

/**
 * Mock ExecutionService for testing workflows without AI API calls
 */
export class MockExecutionService extends EventEmitter {
  private db: Database.Database;
  private projectId: string;
  private repoPath: string;
  private options: MockExecutionServiceOptions;
  private pendingExecutions: Map<string, ExecutionControlImpl> = new Map();
  private executionLogs: Map<string, string[]> = new Map();

  constructor(
    db: Database.Database,
    projectId: string,
    repoPath: string,
    options: MockExecutionServiceOptions = {}
  ) {
    super();
    this.db = db;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this.options = options;
  }

  /**
   * Create and start an execution (mock version)
   */
  async createExecution(
    issueId: string | null,
    config: ExecutionConfig,
    prompt: string,
    agentType: AgentType = "claude-code",
    workflowContext?: WorkflowContext
  ): Promise<Execution> {
    const executionId = `exec-${uuidv4().substring(0, 8)}`;

    // Create execution in database
    const execution = dbCreateExecution(this.db, {
      id: executionId,
      issueId,
      agentType,
      mode: config.mode || "worktree",
      prompt,
      status: "running",
      workflowExecutionId: workflowContext?.workflowId,
    });

    // Create control handle
    const control = new ExecutionControlImpl(
      this.db,
      executionId,
      this.options.defaultDelayMs || 0,
      this.options.defaultResult || "success"
    );
    this.pendingExecutions.set(executionId, control);
    this.executionLogs.set(executionId, []);

    // Notify callback
    if (this.options.onExecute) {
      this.options.onExecute(executionId, issueId);
    }

    // Emit event
    this.emit("execution:started", { executionId, issueId, workflowContext });

    // Auto-complete after delay if configured
    if (this.options.defaultDelayMs && this.options.defaultDelayMs > 0) {
      setTimeout(() => {
        if (control.status === "running") {
          if (this.options.defaultResult === "failure") {
            control.fail("Simulated failure");
          } else {
            control.complete("Simulated completion");
          }
        }
      }, this.options.defaultDelayMs);
    }

    return execution as Execution;
  }

  /**
   * Create a follow-up execution
   */
  async createFollowUp(
    parentExecutionId: string,
    prompt: string,
    agentType?: AgentType
  ): Promise<Execution> {
    // Get parent execution
    const parent = this.db
      .prepare("SELECT * FROM executions WHERE id = ?")
      .get(parentExecutionId) as any;

    if (!parent) {
      throw new Error(`Parent execution ${parentExecutionId} not found`);
    }

    const executionId = `exec-${uuidv4().substring(0, 8)}`;

    // Create execution in database
    const execution = dbCreateExecution(this.db, {
      id: executionId,
      issueId: parent.issue_id,
      agentType: agentType || parent.agent_type,
      mode: parent.mode,
      prompt,
      status: "running",
      workflowExecutionId: parent.workflow_execution_id,
    });

    // Update to link parent
    this.db
      .prepare("UPDATE executions SET parent_execution_id = ? WHERE id = ?")
      .run(parentExecutionId, executionId);

    // Create control handle
    const control = new ExecutionControlImpl(
      this.db,
      executionId,
      this.options.defaultDelayMs || 0,
      this.options.defaultResult || "success"
    );
    this.pendingExecutions.set(executionId, control);
    this.executionLogs.set(executionId, []);

    // Emit event
    this.emit("execution:started", {
      executionId,
      issueId: parent.issue_id,
      parentExecutionId,
    });

    return execution as Execution;
  }

  /**
   * Cancel an execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const control = this.pendingExecutions.get(executionId);

    if (control && control.status === "running") {
      control.fail("Cancelled by user");
      dbUpdateExecution(this.db, executionId, { status: "cancelled" });
    }

    this.pendingExecutions.delete(executionId);
    this.emit("execution:cancelled", { executionId });
  }

  /**
   * Get an execution by ID from the database
   */
  getExecution(executionId: string): any {
    const row = this.db
      .prepare("SELECT * FROM executions WHERE id = ?")
      .get(executionId);

    if (!row) {
      return null;
    }

    return row;
  }

  /**
   * List all executions with filtering and pagination
   */
  listAll(options: {
    limit?: number;
    offset?: number;
    status?: string | string[];
    issueId?: string;
    sortBy?: "created_at" | "updated_at";
    order?: "asc" | "desc";
    since?: string;
    includeRunning?: boolean;
    tags?: string[];
  } = {}): {
    executions: any[];
    total: number;
    hasMore: boolean;
  } {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const sortBy = options.sortBy ?? "created_at";
    const order = options.order ?? "desc";

    // Build WHERE clause
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (options.status) {
      const statuses = Array.isArray(options.status)
        ? options.status
        : [options.status];
      const placeholders = statuses.map(() => "?").join(",");
      whereClauses.push(`status IN (${placeholders})`);
      params.push(...statuses);
    }

    if (options.issueId) {
      whereClauses.push("issue_id = ?");
      params.push(options.issueId);
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Get total count
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM executions ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow.count;

    // Get paginated results
    const executions = this.db
      .prepare(
        `SELECT * FROM executions ${whereClause}
         ORDER BY ${sortBy} ${order}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    return {
      executions,
      total,
      hasMore: offset + executions.length < total,
    };
  }

  /**
   * Get control handle for an execution
   */
  getExecutionControl(executionId: string): ExecutionControl | undefined {
    return this.pendingExecutions.get(executionId);
  }

  /**
   * Get all pending execution IDs
   */
  getPendingExecutions(): string[] {
    return Array.from(this.pendingExecutions.keys()).filter(
      (id) => this.pendingExecutions.get(id)?.status === "running"
    );
  }

  /**
   * Complete all pending executions
   */
  completeAll(output = "Completed by test"): void {
    for (const control of this.pendingExecutions.values()) {
      if (control.status === "running") {
        control.complete(output);
      }
    }
  }

  /**
   * Fail all pending executions
   */
  failAll(error = "Failed by test"): void {
    for (const control of this.pendingExecutions.values()) {
      if (control.status === "running") {
        control.fail(error);
      }
    }
  }

  /**
   * Get execution logs
   */
  getExecutionLogs(executionId: string): string[] {
    return this.executionLogs.get(executionId) || [];
  }

  /**
   * Clear all state (for between tests)
   */
  reset(): void {
    this.pendingExecutions.clear();
    this.executionLogs.clear();
    this.removeAllListeners();
  }
}

// =============================================================================
// Execution Control Implementation
// =============================================================================

class ExecutionControlImpl implements ExecutionControl {
  private db: Database.Database;
  private _executionId: string;
  private _status: ExecutionStatus = "running";
  private toolCalls: Array<{ tool: string; args: Record<string, unknown> }> =
    [];
  private output: string[] = [];
  private delayMs: number;
  private defaultResult: "success" | "failure";

  constructor(
    db: Database.Database,
    executionId: string,
    delayMs: number,
    defaultResult: "success" | "failure"
  ) {
    this.db = db;
    this._executionId = executionId;
    this.delayMs = delayMs;
    this.defaultResult = defaultResult;
  }

  get executionId(): string {
    return this._executionId;
  }

  get status(): ExecutionStatus {
    return this._status;
  }

  complete(output?: string): void {
    if (this._status !== "running") return;

    this._status = "completed";
    if (output) this.output.push(output);

    try {
      dbUpdateExecution(this.db, this._executionId, {
        status: "completed",
        exit_code: 0,
        summary: output || "Execution completed successfully",
        completed_at: new Date().toISOString(),
      });
    } catch {
      // Ignore errors if database is closed (test cleanup)
    }
  }

  fail(error: string): void {
    if (this._status !== "running") return;

    this._status = "failed";
    this.output.push(`Error: ${error}`);

    try {
      dbUpdateExecution(this.db, this._executionId, {
        status: "failed",
        exit_code: 1,
        error_message: error,
        completed_at: new Date().toISOString(),
      });
    } catch {
      // Ignore errors if database is closed (test cleanup)
    }
  }

  addToolCall(toolName: string, args: Record<string, unknown>): void {
    this.toolCalls.push({ tool: toolName, args });
  }

  addOutput(content: string): void {
    this.output.push(content);
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock execution service for testing
 */
export function createMockExecutionService(
  db: Database.Database,
  projectId = "test-project",
  repoPath = "/tmp/test-repo",
  options: MockExecutionServiceOptions = {}
): MockExecutionService {
  return new MockExecutionService(db, projectId, repoPath, options);
}

/**
 * Wait for an execution to complete
 */
export async function waitForExecutionComplete(
  service: MockExecutionService,
  executionId: string,
  timeoutMs = 5000
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    const control = service.getExecutionControl(executionId);
    if (!control || control.status !== "running") {
      return;
    }

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timeout waiting for execution ${executionId} to complete`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
