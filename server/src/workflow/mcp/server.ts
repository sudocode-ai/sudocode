/**
 * Workflow MCP Server
 *
 * MCP server that provides workflow control tools to the orchestrator agent.
 * Spawned as a subprocess with workflow-id, db-path, and repo-path arguments.
 */

import Database from "better-sqlite3";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  WorkflowMCPContext,
  ToolDefinition,
  WorkflowCompleteParams,
  ExecuteIssueParams,
  ExecutionStatusParams,
  ExecutionCancelParams,
  ExecutionTrajectoryParams,
  ExecutionChangesParams,
  EscalateToUserParams,
  NotifyUserParams,
} from "./types.js";
import type { ExecutionService } from "../../services/execution-service.js";

// Tool implementations
import {
  handleWorkflowStatus,
  handleWorkflowComplete,
} from "./tools/workflow.js";
import {
  handleExecuteIssue,
  handleExecutionStatus,
  handleExecutionCancel,
} from "./tools/execution.js";
import {
  handleExecutionTrajectory,
  handleExecutionChanges,
} from "./tools/inspection.js";
import {
  handleEscalateToUser,
  handleNotifyUser,
} from "./tools/escalation.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a WorkflowMCPServer.
 */
export interface WorkflowMCPServerOptions {
  /** The workflow ID this server manages */
  workflowId: string;
  /** Path to the SQLite database */
  dbPath: string;
  /** Path to the repository root */
  repoPath: string;
  /** Optional: Pre-configured execution service (for testing) */
  executionService?: ExecutionService;
  /** Optional: Base URL of the main server for notifications */
  serverUrl?: string;
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * All available workflow MCP tools.
 * Tool handlers are implemented in ./tools/*.ts
 */
const TOOL_DEFINITIONS: ToolDefinition[] = [
  // Workflow control tools
  {
    name: "workflow_status",
    description:
      "Get current workflow state including steps, active executions, and ready issues. " +
      "Use this to understand what work is pending, in progress, or completed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "workflow_complete",
    description:
      "Mark workflow as complete or failed with a summary. " +
      "Call this when all work is done or if the workflow cannot continue.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of work completed or reason for failure",
        },
        status: {
          type: "string",
          enum: ["completed", "failed"],
          description: "Final status (default: completed)",
        },
      },
      required: ["summary"],
    },
  },

  // Execution tools
  {
    name: "execute_issue",
    description:
      "Start an execution for an issue. Returns immediately with execution ID. " +
      "Use execution_status to check progress.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID to execute (e.g., i-abc123)",
        },
        agent_type: {
          type: "string",
          enum: ["claude-code", "codex", "copilot", "cursor"],
          description: "Agent type to use (default: from workflow config)",
        },
        model: {
          type: "string",
          description: "Model override for the agent",
        },
        worktree_mode: {
          type: "string",
          enum: ["create_root", "use_root", "create_branch", "use_branch"],
          description:
            "Worktree strategy: create_root (new workflow worktree), " +
            "use_root (reuse workflow worktree), create_branch (parallel branch), " +
            "use_branch (continue on existing branch)",
        },
        worktree_id: {
          type: "string",
          description:
            "Execution ID to reuse worktree from (required for use_root/use_branch)",
        },
      },
      required: ["issue_id", "worktree_mode"],
    },
  },
  {
    name: "execution_status",
    description:
      "Get status of an execution including exit code, summary, and files changed.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to check",
        },
      },
      required: ["execution_id"],
    },
  },
  {
    name: "execution_cancel",
    description: "Cancel a running execution.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to cancel",
        },
        reason: {
          type: "string",
          description: "Reason for cancellation",
        },
      },
      required: ["execution_id"],
    },
  },

  // Inspection tools
  {
    name: "execution_trajectory",
    description:
      "Get agent actions and tool calls from an execution. " +
      "Useful for understanding what the agent did and debugging issues.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to inspect",
        },
        max_entries: {
          type: "number",
          description: "Maximum entries to return (default: 50)",
        },
      },
      required: ["execution_id"],
    },
  },
  {
    name: "execution_changes",
    description:
      "Get code changes made by an execution including files modified and commits.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to get changes for",
        },
        include_diff: {
          type: "boolean",
          description: "Include full diff content (default: false)",
        },
      },
      required: ["execution_id"],
    },
  },

  // Escalation tools (Human-in-the-Loop)
  {
    name: "escalate_to_user",
    description:
      "Request user input for a decision. Returns immediately with 'pending' status. " +
      "Your session ends here - when the user responds, you'll receive a follow-up message. " +
      "In full_auto mode, returns 'auto_approved' immediately without user interaction.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message explaining what input is needed from the user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional predefined options for user to choose from",
        },
        context: {
          type: "object",
          description: "Additional context to include in the escalation (passed back in response)",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "notify_user",
    description:
      "Send a non-blocking notification to the user. Does not wait for response. " +
      "Use for progress updates and informational messages.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Notification message",
        },
        level: {
          type: "string",
          enum: ["info", "warning", "error"],
          description: "Notification level (default: info)",
        },
      },
      required: ["message"],
    },
  },
];

// =============================================================================
// WorkflowMCPServer
// =============================================================================

/**
 * MCP server for workflow orchestration.
 *
 * Provides tools for the orchestrator agent to:
 * - Check workflow status
 * - Execute issues
 * - Monitor execution progress
 * - Inspect execution results
 * - Complete the workflow
 *
 * @example
 * ```typescript
 * const server = new WorkflowMCPServer({
 *   workflowId: "wf-abc123",
 *   dbPath: ".sudocode/cache.db",
 *   repoPath: "/path/to/repo",
 * });
 * await server.start();
 * ```
 */
export class WorkflowMCPServer {
  private server: Server;
  private context: WorkflowMCPContext;
  private db: Database.Database;
  private transport: StdioServerTransport | null = null;

  constructor(options: WorkflowMCPServerOptions) {
    // Initialize database connection
    this.db = new Database(options.dbPath);

    // Build context for tool handlers
    this.context = {
      workflowId: options.workflowId,
      db: this.db,
      executionService: options.executionService!,
      repoPath: options.repoPath,
      serverUrl: options.serverUrl,
    };

    // Create MCP server
    this.server = new Server(
      {
        name: "sudocode-workflow",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Set up MCP request handlers.
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOL_DEFINITIONS,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.handleToolCall(
          name,
          (args as Record<string, unknown>) || {}
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: message,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Handle a tool call by dispatching to the appropriate handler.
   */
  private async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Tool handlers will be implemented in subsequent issues
    // For now, return a placeholder response
    switch (name) {
      case "workflow_status":
        return this.handleWorkflowStatus();

      case "workflow_complete":
        return this.handleWorkflowComplete(args);

      case "execute_issue":
        return this.handleExecuteIssue(args);

      case "execution_status":
        return this.handleExecutionStatus(args);

      case "execution_cancel":
        return this.handleExecutionCancel(args);

      case "execution_trajectory":
        return this.handleExecutionTrajectory(args);

      case "execution_changes":
        return this.handleExecutionChanges(args);

      case "escalate_to_user":
        return this.handleEscalateToUser(args);

      case "notify_user":
        return this.handleNotifyUser(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ===========================================================================
  // Tool Handler Stubs (to be implemented in tools/*.ts)
  // ===========================================================================

  private async handleWorkflowStatus(): Promise<unknown> {
    return handleWorkflowStatus(this.context);
  }

  private async handleWorkflowComplete(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: WorkflowCompleteParams = {
      summary: args.summary as string,
      status: args.status as "completed" | "failed" | undefined,
    };
    return handleWorkflowComplete(this.context, params);
  }

  private async handleExecuteIssue(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: ExecuteIssueParams = {
      issue_id: args.issue_id as string,
      agent_type: args.agent_type as ExecuteIssueParams["agent_type"],
      model: args.model as string | undefined,
      worktree_mode: args.worktree_mode as
        | "create_root"
        | "use_root"
        | "create_branch"
        | "use_branch",
      worktree_id: args.worktree_id as string | undefined,
    };
    return handleExecuteIssue(this.context, params);
  }

  private async handleExecutionStatus(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: ExecutionStatusParams = {
      execution_id: args.execution_id as string,
    };
    return handleExecutionStatus(this.context, params);
  }

  private async handleExecutionCancel(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: ExecutionCancelParams = {
      execution_id: args.execution_id as string,
      reason: args.reason as string | undefined,
    };
    return handleExecutionCancel(this.context, params);
  }

  private async handleExecutionTrajectory(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: ExecutionTrajectoryParams = {
      execution_id: args.execution_id as string,
      max_entries: args.max_entries as number | undefined,
    };
    return handleExecutionTrajectory(this.context, params);
  }

  private async handleExecutionChanges(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: ExecutionChangesParams = {
      execution_id: args.execution_id as string,
      include_diff: args.include_diff as boolean | undefined,
    };
    return handleExecutionChanges(this.context, params);
  }

  private async handleEscalateToUser(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: EscalateToUserParams = {
      message: args.message as string,
      options: args.options as string[] | undefined,
      context: args.context as Record<string, unknown> | undefined,
    };
    return handleEscalateToUser(this.context, params);
  }

  private async handleNotifyUser(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const params: NotifyUserParams = {
      message: args.message as string,
      level: args.level as "info" | "warning" | "error" | undefined,
    };
    return handleNotifyUser(this.context, params);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the MCP server with stdio transport.
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);

    // Log startup (to stderr so it doesn't interfere with MCP protocol)
    console.error(
      `[WorkflowMCPServer] Started for workflow ${this.context.workflowId}`
    );
  }

  /**
   * Stop the MCP server and clean up resources.
   */
  async stop(): Promise<void> {
    if (this.transport) {
      await this.server.close();
      this.transport = null;
    }
    this.db.close();

    console.error(`[WorkflowMCPServer] Stopped`);
  }

  /**
   * Get the context (for testing).
   */
  getContext(): WorkflowMCPContext {
    return this.context;
  }
}
