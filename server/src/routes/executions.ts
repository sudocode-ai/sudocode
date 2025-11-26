/**
 * Executions API routes (mapped to /api)
 *
 * Provides REST API for managing issue executions.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { NormalizedEntryToAgUiAdapter } from "../execution/output/normalized-to-ag-ui-adapter.js";
import { AgUiEventAdapter } from "../execution/output/ag-ui-adapter.js";
import { agentRegistryService } from "../services/agent-registry.js";
import {
  AgentNotFoundError,
  AgentNotImplementedError,
  AgentError,
} from "../errors/agent-errors.js";

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
   * POST /api/issues/:issueId/executions/prepare
   *
   * Prepare an execution - render template and show preview
   */
  router.post(
    "/issues/:issueId/executions/prepare",
    async (req: Request, res: Response) => {
      try {
        const { issueId } = req.params;
        const options = req.body || {};
        const result = await req.project!.executionService!.prepareExecution(
          issueId,
          options
        );

        res.json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to prepare execution:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to prepare execution",
        });
      }
    }
  );

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
   * Get AG-UI events for historical replay
   *
   * Fetches NormalizedEntry logs from storage and converts them to AG-UI events on-demand.
   * This preserves full structured data in storage while serving UI-ready events to frontend.
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

        // Fetch normalized entries from storage
        const normalizedEntries =
          req.project!.logsStore!.getNormalizedEntries(executionId);
        const metadata = req.project!.logsStore!.getLogMetadata(executionId);

        // Convert NormalizedEntry to AG-UI events on-demand
        const events: any[] = [];

        // Create a temporary AG-UI adapter to collect events
        const agUiAdapter = new AgUiEventAdapter(executionId);
        agUiAdapter.onEvent((event) => {
          events.push(event);
        });

        // Create normalized adapter to transform entries
        const normalizedAdapter = new NormalizedEntryToAgUiAdapter(agUiAdapter);

        // Process all normalized entries through the adapter
        for (const entry of normalizedEntries) {
          await normalizedAdapter.processEntry(entry);
        }

        res.json({
          success: true,
          data: {
            executionId,
            events,
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
   */
  router.delete(
    "/executions/:executionId",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const { cancel } = req.query;

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
        await req.project!.executionService!.deleteExecution(executionId);

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
   */
  router.delete(
    "/executions/:executionId/worktree",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        await req.project!.executionService!.deleteWorktree(executionId);

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

  return router;
}
