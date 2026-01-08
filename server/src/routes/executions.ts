/**
 * Executions API routes (mapped to /api)
 *
 * Provides REST API for managing issue executions.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import { agentRegistryService } from "../services/agent-registry.js";
import {
  AgentNotFoundError,
  AgentNotImplementedError,
  AgentError,
} from "../errors/agent-errors.js";
import {
  WorktreeSyncService,
  WorktreeSyncError,
  WorktreeSyncErrorCode,
} from "../services/worktree-sync-service.js";
import { ExecutionChangesService } from "../services/execution-changes-service.js";

/**
 * Get WorktreeSyncService instance for a request
 *
 * @param req - Express request with project context
 * @returns WorktreeSyncService instance
 */
function getWorktreeSyncService(req: Request): WorktreeSyncService {
  const db = req.project!.db;
  const repoPath = req.project!.path;
  return new WorktreeSyncService(db, repoPath);
}

/**
 * Get HTTP status code for WorktreeSyncError
 *
 * @param error - WorktreeSyncError instance
 * @returns HTTP status code
 */
function getStatusCodeForSyncError(error: WorktreeSyncError): number {
  switch (error.code) {
    case WorktreeSyncErrorCode.NO_WORKTREE:
    case WorktreeSyncErrorCode.WORKTREE_MISSING:
    case WorktreeSyncErrorCode.BRANCH_MISSING:
    case WorktreeSyncErrorCode.TARGET_BRANCH_MISSING:
    case WorktreeSyncErrorCode.EXECUTION_NOT_FOUND:
      return 404; // Not found

    case WorktreeSyncErrorCode.DIRTY_WORKING_TREE:
    case WorktreeSyncErrorCode.CODE_CONFLICTS:
    case WorktreeSyncErrorCode.NO_COMMON_BASE:
      return 400; // Bad request (user must fix)

    case WorktreeSyncErrorCode.MERGE_FAILED:
    case WorktreeSyncErrorCode.JSONL_RESOLUTION_FAILED:
    case WorktreeSyncErrorCode.DATABASE_SYNC_FAILED:
      return 500; // Internal error

    default:
      return 500;
  }
}

/**
 * Create executions router
 *
 * Note: ExecutionService and ExecutionLogsStore are accessed via req.project
 * which is injected by the requireProject() middleware
 *
 * @returns Express router with execution endpoints
 */
export function createExecutionsRouter(): Router {
  const router = Router();

  /**
   * GET /api/executions
   *
   * List all executions with filtering and pagination
   *
   * Query parameters:
   * - limit?: number (default: 50)
   * - offset?: number (default: 0)
   * - status?: ExecutionStatus | ExecutionStatus[] (comma-separated for multiple)
   * - issueId?: string
   * - sortBy?: 'created_at' | 'updated_at' (default: 'created_at')
   * - order?: 'asc' | 'desc' (default: 'desc')
   * - since?: ISO date string - only return executions created after this date
   * - includeRunning?: 'true' - when used with 'since', also include running executions regardless of age
   */
  router.get("/executions", (req: Request, res: Response) => {
    try {
      // Parse query parameters
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined;
      const offset = req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : undefined;

      // Parse status (can be single value or comma-separated array)
      let status: any = undefined;
      if (req.query.status) {
        const statusParam = req.query.status as string;
        status = statusParam.includes(",")
          ? statusParam.split(",").map((s) => s.trim())
          : statusParam;
      }

      const issueId = req.query.issueId as string | undefined;
      const sortBy =
        (req.query.sortBy as "created_at" | "updated_at") || undefined;
      const order = (req.query.order as "asc" | "desc") || undefined;
      const since = req.query.since as string | undefined;
      const includeRunning = req.query.includeRunning === "true";

      // Parse tags (can be single value or comma-separated array)
      let tags: string[] | undefined = undefined;
      if (req.query.tags) {
        const tagsParam = req.query.tags as string;
        tags = tagsParam.includes(",")
          ? tagsParam.split(",").map((t) => t.trim())
          : [tagsParam];
      }

      // Validate limit and offset
      if (limit !== undefined && (isNaN(limit) || limit < 0)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Invalid limit parameter",
        });
        return;
      }

      if (offset !== undefined && (isNaN(offset) || offset < 0)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Invalid offset parameter",
        });
        return;
      }

      // Validate sortBy
      if (sortBy && sortBy !== "created_at" && sortBy !== "updated_at") {
        res.status(400).json({
          success: false,
          data: null,
          message:
            "Invalid sortBy parameter. Must be 'created_at' or 'updated_at'",
        });
        return;
      }

      // Validate order
      if (order && order !== "asc" && order !== "desc") {
        res.status(400).json({
          success: false,
          data: null,
          message: "Invalid order parameter. Must be 'asc' or 'desc'",
        });
        return;
      }

      // Validate since (should be valid ISO date)
      if (since) {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Invalid since parameter. Must be a valid ISO date string",
          });
          return;
        }
      }

      // Call service method
      const result = req.project!.executionService!.listAll({
        limit,
        offset,
        status,
        issueId,
        sortBy,
        order,
        since,
        includeRunning,
        tags,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error listing executions:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list executions",
      });
    }
  });

  /**
   * POST /api/executions
   *
   * Create and start an adhoc execution (not tied to an issue)
   *
   * Request body:
   * - prompt: string (required) - The prompt for the execution
   * - config?: ExecutionConfig - Execution configuration
   * - agentType?: string - Agent type (defaults to 'claude-code')
   */
  router.post("/executions", async (req: Request, res: Response) => {
    try {
      const { config, prompt, agentType } = req.body;

      // Validate required fields - prompt is required for adhoc executions
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Prompt is required for adhoc executions",
        });
        return;
      }

      // Validate agentType if provided
      if (agentType) {
        // Check if agent exists in registry
        if (!agentRegistryService.hasAgent(agentType)) {
          const availableAgents = agentRegistryService
            .getAvailableAgents()
            .map((a) => a.name);
          throw new AgentNotFoundError(agentType, availableAgents);
        }

        // Check if agent is implemented
        if (!agentRegistryService.isAgentImplemented(agentType)) {
          throw new AgentNotImplementedError(agentType);
        }
      }

      // Create execution with null issueId (adhoc execution)
      const execution = await req.project!.executionService!.createExecution(
        null, // No issue for adhoc executions
        config || {},
        prompt,
        agentType // Optional, defaults to 'claude-code' in service
      );

      res.status(201).json({
        success: true,
        data: execution,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to create adhoc execution:", error);

      // Handle agent-specific errors with enhanced error responses
      if (error instanceof AgentNotFoundError) {
        res.status(400).json({
          success: false,
          data: null,
          error: error.message,
          code: error.code,
          details: error.details,
        });
        return;
      }

      if (error instanceof AgentNotImplementedError) {
        res.status(501).json({
          success: false,
          data: null,
          error: error.message,
          code: error.code,
          details: error.details,
        });
        return;
      }

      if (error instanceof AgentError) {
        // Generic agent error (400 by default)
        res.status(400).json({
          success: false,
          data: null,
          error: error.message,
          code: error.code,
          details: error.details,
        });
        return;
      }

      // Handle other errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      res.status(500).json({
        success: false,
        data: null,
        error_data: errorMessage,
        message: "Failed to create adhoc execution",
      });
    }
  });

  /**
   * POST /api/issues/:issueId/executions
   *
   * Create and start a new execution
   */
  router.post(
    "/issues/:issueId/executions",
    async (req: Request, res: Response) => {
      try {
        const { issueId } = req.params;
        const { config, prompt, agentType } = req.body;

        // Validate required fields
        if (!prompt) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Prompt is required",
          });
          return;
        }

        // Validate agentType if provided
        if (agentType) {
          // Check if agent exists in registry
          if (!agentRegistryService.hasAgent(agentType)) {
            const availableAgents = agentRegistryService
              .getAvailableAgents()
              .map((a) => a.name);
            throw new AgentNotFoundError(agentType, availableAgents);
          }

          // Check if agent is implemented
          if (!agentRegistryService.isAgentImplemented(agentType)) {
            throw new AgentNotImplementedError(agentType);
          }
        }

        const execution = await req.project!.executionService!.createExecution(
          issueId,
          config || {},
          prompt,
          agentType // Optional, defaults to 'claude-code' in service
        );

        res.status(201).json({
          success: true,
          data: execution,
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to create execution:", error);

        // Handle agent-specific errors with enhanced error responses
        if (error instanceof AgentNotFoundError) {
          res.status(400).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }

        if (error instanceof AgentNotImplementedError) {
          res.status(501).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }

        if (error instanceof AgentError) {
          // Generic agent error (400 by default)
          res.status(400).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }

        // Handle other errors (backwards compatibility)
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const statusCode = errorMessage.includes("not found") ? 404 : 500;

        res.status(statusCode).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Failed to create execution",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId
   *
   * Get a specific execution by ID
   */
  router.get("/executions/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;
      const execution =
        req.project!.executionService!.getExecution(executionId);

      if (!execution) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Execution not found: ${executionId}`,
        });
        return;
      }

      res.json({
        success: true,
        data: execution,
      });
    } catch (error) {
      console.error("Error getting execution:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get execution",
      });
    }
  });

  /**
   * GET /api/executions/:executionId/chain
   *
   * Get execution chain (root execution + all follow-ups)
   *
   * Returns the full chain of executions starting from the root.
   * If the requested execution is a follow-up, finds the root and returns the full chain.
   * Executions are ordered chronologically (oldest first).
   */
  router.get(
    "/executions/:executionId/chain",
    (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const db = req.project!.db;

        // Get the requested execution
        const execution =
          req.project!.executionService!.getExecution(executionId);
        if (!execution) {
          res.status(404).json({
            success: false,
            data: null,
            message: `Execution not found: ${executionId}`,
          });
          return;
        }

        // Find the root execution by traversing up parent_execution_id
        let rootId = executionId;
        let current = execution;
        while (current.parent_execution_id) {
          rootId = current.parent_execution_id;
          const parent = req.project!.executionService!.getExecution(rootId);
          if (!parent) break;
          current = parent;
        }

        // Get all executions in the chain (root + all descendants)
        // Using recursive CTE to get all descendants
        const chain = db
          .prepare(
            `
        WITH RECURSIVE execution_chain AS (
          -- Base case: the root execution
          SELECT * FROM executions WHERE id = ?
          UNION ALL
          -- Recursive case: children of executions in the chain
          SELECT e.* FROM executions e
          INNER JOIN execution_chain ec ON e.parent_execution_id = ec.id
        )
        SELECT * FROM execution_chain
        ORDER BY created_at ASC
      `
          )
          .all(rootId) as any[];

        res.json({
          success: true,
          data: {
            rootId,
            executions: chain,
          },
        });
      } catch (error) {
        console.error("Error getting execution chain:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get execution chain",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId/logs
   *
   * Get CoalescedSessionUpdate events for historical replay
   *
   * Returns logs in unified CoalescedSessionUpdate format.
   * Automatically detects storage format (ACP or legacy) and converts as needed.
   */
  router.get(
    "/executions/:executionId/logs",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        // Verify execution exists
        const execution =
          req.project!.executionService!.getExecution(executionId);
        if (!execution) {
          res.status(404).json({
            success: false,
            data: null,
            message: `Execution not found: ${executionId}`,
          });
          return;
        }

        // Get logs in unified CoalescedSessionUpdate format
        // This handles both ACP (raw_logs) and legacy (normalized_entry) formats
        const events = req.project!.logsStore!.getCoalescedLogs(executionId);
        const metadata = req.project!.logsStore!.getLogMetadata(executionId);
        const format = req.project!.logsStore!.detectLogFormat(executionId);

        res.json({
          success: true,
          data: {
            executionId,
            events,
            format, // Include format for debugging/transparency
            metadata: metadata
              ? {
                  lineCount: metadata.line_count,
                  byteSize: metadata.byte_size,
                  createdAt: metadata.created_at,
                  updatedAt: metadata.updated_at,
                }
              : {
                  lineCount: 0,
                  byteSize: 0,
                  createdAt: execution.created_at,
                  updatedAt: execution.updated_at,
                },
          },
        });
      } catch (error) {
        console.error("[GET /executions/:id/logs] Error:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to fetch execution logs",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId/changes
   *
   * Get code changes (file list + diff statistics) for an execution
   *
   * Calculates changes on-demand from commit SHAs. Supports:
   * - Committed changes (commit-to-commit diff)
   * - Uncommitted changes (working tree diff)
   * - Unavailable states with clear error reasons
   */
  router.get(
    "/executions/:executionId/changes",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const db = req.project!.db;
        const repoPath = req.project!.path;

        // Create changes service
        const changesService = new ExecutionChangesService(db, repoPath);

        // Get changes
        const result = await changesService.getChanges(executionId);

        res.json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error("[GET /executions/:id/changes] Error:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to calculate changes",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId/changes/file
   *
   * Get diff content for a specific file in an execution
   *
   * Query params:
   * - filePath: Path to the file to get diff for
   */
  router.get(
    "/executions/:executionId/changes/file",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { filePath } = req.query;

        if (!filePath || typeof filePath !== "string") {
          res.status(400).json({
            success: false,
            data: null,
            message: "filePath query parameter is required",
          });
          return;
        }

        const db = req.project!.db;
        const repoPath = req.project!.path;

        // Create changes service
        const changesService = new ExecutionChangesService(db, repoPath);

        // Get file diff
        const result = await changesService.getFileDiff(executionId, filePath);

        if (!result.success) {
          res.status(400).json({
            success: false,
            data: null,
            message: result.error || "Failed to get file diff",
          });
          return;
        }

        res.json({
          success: true,
          data: {
            filePath,
            oldContent: result.oldContent,
            newContent: result.newContent,
          },
        });
      } catch (error) {
        console.error("[GET /executions/:id/changes/file] Error:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get file diff",
        });
      }
    }
  );

  /**
   * GET /api/issues/:issueId/executions
   *
   * List all executions for an issue
   */
  router.get("/issues/:issueId/executions", (req: Request, res: Response) => {
    try {
      const { issueId } = req.params;
      const executions = req.project!.executionService!.listExecutions(issueId);

      res.json({
        success: true,
        data: executions,
      });
    } catch (error) {
      console.error("Error listing executions:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list executions",
      });
    }
  });

  /**
   * POST /api/executions/:executionId/follow-up
   *
   * Create a follow-up execution that reuses the parent's worktree
   */
  router.post(
    "/executions/:executionId/follow-up",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { feedback } = req.body;

        // Validate required fields
        if (!feedback) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Feedback is required",
          });
          return;
        }

        const followUpExecution =
          await req.project!.executionService!.createFollowUp(
            executionId,
            feedback
          );

        res.status(201).json({
          success: true,
          data: followUpExecution,
        });
      } catch (error) {
        console.error("Error creating follow-up execution:", error);

        // Handle specific error cases
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const statusCode =
          errorMessage.includes("not found") ||
          errorMessage.includes("no worktree")
            ? 404
            : 500;

        res.status(statusCode).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Failed to create follow-up execution",
        });
      }
    }
  );

  /**
   * POST /api/executions/:executionId/cancel
   *
   * Cancel a running execution
   */
  router.post(
    "/executions/:executionId/cancel",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        await req.project!.executionService!.cancelExecution(executionId);

        res.json({
          success: true,
          data: { executionId },
          message: "Execution cancelled successfully",
        });
      } catch (error) {
        console.error("Error cancelling execution:", error);

        // Handle specific error cases
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const statusCode = errorMessage.includes("not found") ? 404 : 500;

        res.status(statusCode).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Failed to cancel execution",
        });
      }
    }
  );

  /**
   * DELETE /api/executions/:executionId
   *
   * Delete an execution and its entire chain (or cancel if ?cancel=true)
   *
   * Query parameters:
   * - cancel: if "true", cancel the execution instead of deleting it
   * - deleteBranch: if "true", also delete the execution's branch
   * - deleteWorktree: if "true", also delete the execution's worktree
   */
  router.delete(
    "/executions/:executionId",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { cancel, deleteBranch, deleteWorktree } = req.query;

        // If cancel query param is true, cancel the execution
        if (cancel === "true") {
          await req.project!.executionService!.cancelExecution(executionId);

          res.json({
            success: true,
            data: { executionId },
            message: "Execution cancelled successfully",
          });
          return;
        }

        // Otherwise, delete the execution and its chain
        await req.project!.executionService!.deleteExecution(
          executionId,
          deleteBranch === "true",
          deleteWorktree === "true"
        );

        res.json({
          success: true,
          data: { executionId },
          message: "Execution deleted successfully",
        });
      } catch (error) {
        console.error("Error deleting/cancelling execution:", error);

        // Handle specific error cases
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const statusCode = errorMessage.includes("not found") ? 404 : 500;

        res.status(statusCode).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Failed to delete/cancel execution",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId/worktree
   *
   * Check if worktree exists for an execution
   */
  router.get(
    "/executions/:executionId/worktree",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        const exists =
          await req.project!.executionService!.worktreeExists(executionId);

        res.json({
          success: true,
          data: { exists },
        });
      } catch (error) {
        console.error("Error checking worktree:", error);

        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to check worktree status",
        });
      }
    }
  );

  /**
   * DELETE /api/executions/:executionId/worktree
   *
   * Delete the worktree for an execution
   *
   * Query parameters:
   * - deleteBranch: if "true", also delete the execution's branch
   */
  router.delete(
    "/executions/:executionId/worktree",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { deleteBranch } = req.query;

        await req.project!.executionService!.deleteWorktree(
          executionId,
          deleteBranch === "true"
        );

        res.json({
          success: true,
          data: { executionId },
          message: "Worktree deleted successfully",
        });
      } catch (error) {
        console.error("Error deleting worktree:", error);

        // Handle specific error cases
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        let statusCode = 500;

        if (errorMessage.includes("not found")) {
          statusCode = 404;
        } else if (
          errorMessage.includes("has no worktree") ||
          errorMessage.includes("Cannot delete worktree")
        ) {
          statusCode = 400;
        }

        res.status(statusCode).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Failed to delete worktree",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId/sync/preview
   *
   * Preview sync changes and detect conflicts
   *
   * Returns preview of what would happen if sync is performed,
   * including conflicts, diff, commits, and warnings.
   */
  router.get(
    "/executions/:executionId/sync/preview",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        // Get worktree sync service
        const syncService = getWorktreeSyncService(req);

        // Preview sync
        const preview = await syncService.previewSync(executionId);

        res.json({
          success: true,
          data: preview,
        });
      } catch (error) {
        console.error(
          `Failed to preview sync for execution ${req.params.executionId}:`,
          error
        );

        if (error instanceof WorktreeSyncError) {
          const statusCode = getStatusCodeForSyncError(error);
          res.status(statusCode).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
          });
        } else {
          res.status(500).json({
            success: false,
            data: null,
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  );

  /**
   * POST /api/executions/:executionId/sync/squash
   *
   * Perform squash sync operation
   *
   * Combines all worktree changes into a single commit on the target branch.
   * Automatically resolves JSONL conflicts using merge-resolver.
   *
   * Request body:
   * - commitMessage?: string - Optional custom commit message
   */
  router.post(
    "/executions/:executionId/sync/squash",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { commitMessage } = req.body || {};

        // Get worktree sync service
        const syncService = getWorktreeSyncService(req);

        // Check if squashSync method exists
        if (typeof (syncService as any).squashSync !== "function") {
          res.status(501).json({
            success: false,
            data: null,
            error: "Squash sync not yet implemented",
            message: "The squashSync operation is not available yet",
          });
          return;
        }

        // Perform squash sync
        const result = await (syncService as any).squashSync(
          executionId,
          commitMessage
        );

        res.json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error(
          `Failed to squash sync execution ${req.params.executionId}:`,
          error
        );

        if (error instanceof WorktreeSyncError) {
          const statusCode = getStatusCodeForSyncError(error);
          res.status(statusCode).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
          });
        } else {
          res.status(500).json({
            success: false,
            data: null,
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  );

  /**
   * POST /api/executions/:executionId/sync/stage
   *
   * Perform stage sync operation
   *
   * Applies committed worktree changes to the working directory without committing.
   * Changes are left staged, ready for the user to commit manually.
   *
   * Request body:
   * - includeUncommitted?: boolean - If true, also copy uncommitted files from worktree
   * - overrideLocalChanges?: boolean - If true, skip merge and overwrite local changes
   */
  router.post(
    "/executions/:executionId/sync/stage",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { includeUncommitted, overrideLocalChanges } = req.body || {};

        // Get worktree sync service
        const syncService = getWorktreeSyncService(req);

        // Perform stage sync with options
        const result = await syncService.stageSync(executionId, {
          includeUncommitted: includeUncommitted === true,
          overrideLocalChanges: overrideLocalChanges === true,
        });

        res.json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error(
          `Failed to stage sync execution ${req.params.executionId}:`,
          error
        );

        if (error instanceof WorktreeSyncError) {
          const statusCode = getStatusCodeForSyncError(error);
          res.status(statusCode).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
          });
        } else {
          res.status(500).json({
            success: false,
            data: null,
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  );

  /**
   * POST /api/executions/:executionId/sync/preserve
   *
   * Perform preserve sync operation
   *
   * Merges all commits from worktree branch to target branch, preserving commit history.
   * Only includes committed changes - uncommitted changes are excluded.
   */
  router.post(
    "/executions/:executionId/sync/preserve",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        // Get worktree sync service
        const syncService = getWorktreeSyncService(req);

        // Perform preserve sync
        const result = await syncService.preserveSync(executionId);

        res.json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error(
          `Failed to preserve sync execution ${req.params.executionId}:`,
          error
        );

        if (error instanceof WorktreeSyncError) {
          const statusCode = getStatusCodeForSyncError(error);
          res.status(statusCode).json({
            success: false,
            data: null,
            error: error.message,
            code: error.code,
          });
        } else {
          res.status(500).json({
            success: false,
            data: null,
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  );

  /**
   * POST /api/executions/:executionId/commit
   *
   * Commit uncommitted changes for an execution
   *
   * Commits changes to the appropriate branch based on execution mode:
   * - Local mode: Commits to target_branch (current branch)
   * - Worktree mode: Commits to branch_name (temp branch) in worktree
   *
   * Request body:
   * - message: string (required) - Commit message
   */
  router.post(
    "/executions/:executionId/commit",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { message } = req.body;

        // Validate commit message
        if (!message || typeof message !== "string" || !message.trim()) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Commit message is required and must be non-empty",
          });
          return;
        }

        const db = req.project!.db;
        const repoPath = req.project!.path;

        // Load execution from database
        const execution = db
          .prepare("SELECT * FROM executions WHERE id = ?")
          .get(executionId) as any;

        if (!execution) {
          res.status(404).json({
            success: false,
            data: null,
            message: "Execution not found",
          });
          return;
        }

        // Determine working directory and target branch
        // IMPORTANT: If worktree_path exists, always use it - this is more reliable than the mode field
        // which may not be set correctly on follow-up executions
        const hasWorktree = !!execution.worktree_path;
        const workingDir = hasWorktree ? execution.worktree_path : repoPath;
        const targetBranch = hasWorktree
          ? execution.branch_name
          : execution.target_branch || "main";

        console.log(
          `[Commit] Execution ${executionId}: hasWorktree=${hasWorktree}, workingDir=${workingDir}, targetBranch=${targetBranch}, mode=${execution.mode}`
        );

        // Get current uncommitted files from working directory instead of stale database field
        // This ensures we're working with the current state
        let filesChanged: string[] = [];
        try {
          // Get modified tracked files
          const modifiedOutput = execSync("git diff --name-only", {
            cwd: workingDir,
            encoding: "utf-8",
            stdio: "pipe",
          });

          // Get staged files
          const stagedOutput = execSync("git diff --cached --name-only", {
            cwd: workingDir,
            encoding: "utf-8",
            stdio: "pipe",
          });

          // Get untracked files
          const untrackedOutput = execSync(
            "git ls-files --others --exclude-standard",
            {
              cwd: workingDir,
              encoding: "utf-8",
              stdio: "pipe",
            }
          );

          console.log(`[Commit] Git status in ${workingDir}:`, {
            modified: modifiedOutput.trim().split("\n").filter(Boolean),
            staged: stagedOutput.trim().split("\n").filter(Boolean),
            untracked: untrackedOutput.trim().split("\n").filter(Boolean),
          });

          // Combine all files, removing duplicates
          const allFiles = new Set<string>();
          for (const output of [
            modifiedOutput,
            stagedOutput,
            untrackedOutput,
          ]) {
            output
              .split("\n")
              .filter((line) => line.trim())
              .forEach((file) => allFiles.add(file));
          }
          filesChanged = Array.from(allFiles);
        } catch (error) {
          console.error("Failed to get uncommitted files:", error);
        }

        // Validate has uncommitted changes
        if (filesChanged.length === 0) {
          res.status(400).json({
            success: false,
            data: null,
            message: "No files to commit",
          });
          return;
        }

        // Execute git operations
        try {
          // Add all changes (more reliable than adding specific files)
          // This catches any files that might have been missed in detection
          execSync("git add -A", {
            cwd: workingDir,
            encoding: "utf-8",
            stdio: "pipe",
          });

          console.log(`[Commit] Staged all changes with git add -A`);

          // Verify something is staged
          const stagedAfterAdd = execSync("git diff --cached --name-only", {
            cwd: workingDir,
            encoding: "utf-8",
            stdio: "pipe",
          }).trim();

          if (!stagedAfterAdd) {
            console.log(`[Commit] No files staged after git add -A`);
            res.status(400).json({
              success: false,
              data: null,
              message: "No files staged for commit after git add",
            });
            return;
          }

          console.log(
            `[Commit] Files staged: ${stagedAfterAdd.split("\n").filter(Boolean).join(", ")}`
          );

          // Commit using -F - to read message from stdin (safer than shell escaping)
          const { spawnSync } = await import("child_process");
          const commitResult = spawnSync("git", ["commit", "--no-verify", "-m", message], {
            cwd: workingDir,
            encoding: "utf-8",
            stdio: "pipe",
          });

          if (commitResult.status !== 0) {
            const errorOutput =
              commitResult.stderr || commitResult.stdout || "Unknown error";
            console.error(`[Commit] git commit failed:`, errorOutput);
            throw new Error(`git commit failed: ${errorOutput}`);
          }

          console.log(`[Commit] git commit output:`, commitResult.stdout);

          // Get commit SHA
          const commitSha = execSync("git rev-parse HEAD", {
            cwd: workingDir,
            encoding: "utf-8",
            stdio: "pipe",
          }).trim();

          console.log(
            `[Commit] Successfully committed ${filesChanged.length} files: ${commitSha}`
          );

          // Note: We do NOT update execution.after_commit here
          // That field represents the state at execution completion time
          // Manual commits after execution are tracked separately

          res.json({
            success: true,
            data: {
              commitSha,
              filesCommitted: filesChanged.length,
              branch: targetBranch,
            },
            message: `Successfully committed ${filesChanged.length} file${filesChanged.length !== 1 ? "s" : ""}`,
          });
        } catch (gitError) {
          console.error("Git operation failed:", gitError);
          const errorMessage =
            gitError instanceof Error ? gitError.message : String(gitError);

          res.status(500).json({
            success: false,
            data: null,
            message: "Git commit failed",
            error: errorMessage,
          });
        }
      } catch (error) {
        console.error(
          `Failed to commit for execution ${req.params.executionId}:`,
          error
        );

        res.status(500).json({
          success: false,
          data: null,
          error: "Internal server error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  return router;
}
