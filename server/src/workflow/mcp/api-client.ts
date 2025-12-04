/**
 * Workflow MCP API Client
 *
 * HTTP client for MCP server to communicate with the main server.
 * Replaces direct database access with API calls.
 */

import type {
  ExecuteIssueParams,
  ExecutionStatusParams,
  ExecutionCancelParams,
  ExecutionTrajectoryParams,
  ExecutionChangesParams,
  WorkflowCompleteParams,
  EscalateToUserParams,
  NotifyUserParams,
  WorkflowStatusResult,
  ExecuteIssueResult,
  ExecutionStatusResult,
  ExecutionCancelResult,
  ExecutionTrajectoryResult,
  ExecutionChangesResult,
  WorkflowCompleteResult,
  EscalateToUserResult,
  NotifyUserResult,
} from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Standard API response wrapper.
 */
interface APIResponse<T> {
  success: boolean;
  data: T | null;
  message?: string;
  error?: string;
}

/**
 * Options for creating the API client.
 */
export interface WorkflowAPIClientOptions {
  /** Base URL of the main server (e.g., "http://localhost:3000") */
  serverUrl: string;
  /** Project ID for X-Project-ID header */
  projectId: string;
  /** Workflow ID for workflow-specific operations */
  workflowId: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Error thrown when an API call fails.
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = "APIError";
  }
}

// =============================================================================
// API Client
// =============================================================================

/**
 * HTTP client for workflow MCP server to communicate with main server.
 *
 * All methods throw APIError on failure.
 *
 * @example
 * ```typescript
 * const client = new WorkflowAPIClient({
 *   serverUrl: "http://localhost:3000",
 *   projectId: "proj-123",
 *   workflowId: "wf-abc",
 * });
 *
 * const status = await client.getWorkflowStatus();
 * ```
 */
export class WorkflowAPIClient {
  private serverUrl: string;
  private projectId: string;
  private workflowId: string;
  private timeout: number;

  constructor(options: WorkflowAPIClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, ""); // Remove trailing slash
    this.projectId = options.projectId;
    this.workflowId = options.workflowId;
    this.timeout = options.timeout ?? 30000;
  }

  // ===========================================================================
  // HTTP Helpers
  // ===========================================================================

  /**
   * Make an HTTP request to the API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Project-ID": this.projectId,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as APIResponse<T>;

      if (!response.ok || !data.success) {
        throw new APIError(
          data.message || data.error || `HTTP ${response.status}`,
          response.status,
          data
        );
      }

      return data.data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof APIError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new APIError(`Request timeout after ${this.timeout}ms`, 408);
        }
        throw new APIError(error.message, 0);
      }

      throw new APIError(String(error), 0);
    }
  }

  // ===========================================================================
  // Workflow Methods
  // ===========================================================================

  /**
   * Get current workflow status including steps and active executions.
   */
  async getWorkflowStatus(): Promise<WorkflowStatusResult> {
    // GET /api/workflows/:id returns basic workflow
    // We need extended status with steps, executions, ready steps
    return this.request<WorkflowStatusResult>(
      "GET",
      `/api/workflows/${this.workflowId}/status`
    );
  }

  /**
   * Mark workflow as complete or failed.
   */
  async completeWorkflow(
    params: WorkflowCompleteParams
  ): Promise<WorkflowCompleteResult> {
    return this.request<WorkflowCompleteResult>(
      "POST",
      `/api/workflows/${this.workflowId}/complete`,
      params
    );
  }

  // ===========================================================================
  // Execution Methods
  // ===========================================================================

  /**
   * Start an execution for an issue within the workflow.
   */
  async executeIssue(params: ExecuteIssueParams): Promise<ExecuteIssueResult> {
    return this.request<ExecuteIssueResult>(
      "POST",
      `/api/workflows/${this.workflowId}/execute`,
      params
    );
  }

  /**
   * Get status of an execution.
   */
  async getExecutionStatus(
    params: ExecutionStatusParams
  ): Promise<ExecutionStatusResult> {
    return this.request<ExecutionStatusResult>(
      "GET",
      `/api/executions/${params.execution_id}`
    );
  }

  /**
   * Cancel a running execution.
   */
  async cancelExecution(
    params: ExecutionCancelParams
  ): Promise<ExecutionCancelResult> {
    return this.request<ExecutionCancelResult>(
      "POST",
      `/api/executions/${params.execution_id}/cancel`,
      { reason: params.reason }
    );
  }

  /**
   * Get execution trajectory (tool calls, actions).
   */
  async getExecutionTrajectory(
    params: ExecutionTrajectoryParams
  ): Promise<ExecutionTrajectoryResult> {
    const query = params.max_entries ? `?max_entries=${params.max_entries}` : "";
    return this.request<ExecutionTrajectoryResult>(
      "GET",
      `/api/executions/${params.execution_id}/trajectory${query}`
    );
  }

  /**
   * Get execution code changes.
   */
  async getExecutionChanges(
    params: ExecutionChangesParams
  ): Promise<ExecutionChangesResult> {
    const query = params.include_diff ? "?include_diff=true" : "";
    return this.request<ExecutionChangesResult>(
      "GET",
      `/api/executions/${params.execution_id}/changes${query}`
    );
  }

  // ===========================================================================
  // Escalation Methods
  // ===========================================================================

  /**
   * Request user input (escalation).
   * Returns immediately with pending status - response comes via wakeup.
   */
  async escalateToUser(
    params: EscalateToUserParams
  ): Promise<EscalateToUserResult> {
    return this.request<EscalateToUserResult>(
      "POST",
      `/api/workflows/${this.workflowId}/escalate`,
      params
    );
  }

  /**
   * Send a non-blocking notification to the user.
   */
  async notifyUser(params: NotifyUserParams): Promise<NotifyUserResult> {
    return this.request<NotifyUserResult>(
      "POST",
      `/api/workflows/${this.workflowId}/notify`,
      params
    );
  }
}
