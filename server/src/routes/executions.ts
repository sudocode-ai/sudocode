/**
 * Executions API routes (mapped to /api)
 *
 * Provides REST API for managing issue executions.
 * Implements endpoints per SPEC-011.
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import { ExecutionService } from "../services/execution-service.js";
import type { TransportManager } from "../execution/transport/transport-manager.js";

/**
 * Create executions router
 *
 * @param db - Database instance
 * @param repoPath - Path to git repository
 * @param transportManager - Optional transport manager for SSE streaming
 * @returns Express router with execution endpoints
 */
export function createExecutionsRouter(
  db: Database.Database,
  repoPath: string,
  transportManager?: TransportManager,
  executionService?: ExecutionService
): Router {
  const router = Router();
  const service =
    executionService ||
    new ExecutionService(db, repoPath, undefined, transportManager);

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
        const result = await service.prepareExecution(issueId, options);

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
        const { config, prompt } = req.body;

        // Validate required fields
        if (!prompt) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Prompt is required",
          });
          return;
        }

        const execution = await service.createExecution(
          issueId,
          config || {},
          prompt
        );

        res.status(201).json({
          success: true,
          data: execution,
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to create execution:", error);

        // Handle specific error cases
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
      const execution = service.getExecution(executionId);

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
   * GET /api/issues/:issueId/executions
   *
   * List all executions for an issue
   */
  router.get("/issues/:issueId/executions", (req: Request, res: Response) => {
    try {
      const { issueId } = req.params;
      const executions = service.listExecutions(issueId);

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

        const followUpExecution = await service.createFollowUp(
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
   * DELETE /api/executions/:executionId
   *
   * Cancel a running execution
   */
  router.delete(
    "/executions/:executionId",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        await service.cancelExecution(executionId);

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
   * DELETE /api/executions/:executionId/worktree
   *
   * Delete the worktree for an execution
   */
  router.delete(
    "/executions/:executionId/worktree",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;

        await service.deleteWorktree(executionId);

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
