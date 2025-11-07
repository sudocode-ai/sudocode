/**
 * Agent Requests API routes (mapped to /api)
 *
 * Provides REST API for managing agent requests and the orchestration queue.
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import { AgentRouter } from "../services/agent-router.js";

/**
 * Create agent requests router
 *
 * @param db - Database instance
 * @param agentRouter - Optional agent router instance
 * @returns Express router with agent request endpoints
 */
export function createAgentRequestsRouter(
  db: Database.Database,
  agentRouter?: AgentRouter
): Router {
  const router = Router();
  const routerService = agentRouter || new AgentRouter(db);

  /**
   * GET /api/agent-requests/queue
   *
   * Get all pending requests in the queue, sorted by priority
   */
  router.get("/agent-requests/queue", async (req: Request, res: Response) => {
    try {
      const queue = routerService.getQueue();

      res.json({
        success: true,
        data: queue,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get queue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get queue",
      });
    }
  });

  /**
   * GET /api/agent-requests/stats
   *
   * Get queue statistics
   */
  router.get("/agent-requests/stats", async (req: Request, res: Response) => {
    try {
      const stats = routerService.getStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get stats:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get stats",
      });
    }
  });

  /**
   * GET /api/agent-requests/:requestId
   *
   * Get a specific request by ID
   */
  router.get(
    "/agent-requests/:requestId",
    async (req: Request, res: Response) => {
      try {
        const { requestId } = req.params;
        const request = routerService.getRequest(requestId);

        if (!request) {
          res.status(404).json({
            success: false,
            data: null,
            message: "Request not found",
          });
          return;
        }

        res.json({
          success: true,
          data: request,
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to get request:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get request",
        });
      }
    }
  );

  /**
   * GET /api/executions/:executionId/agent-requests
   *
   * Get all requests for a specific execution
   */
  router.get(
    "/executions/:executionId/agent-requests",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const requests = routerService.getRequestsForExecution(executionId);

        res.json({
          success: true,
          data: requests,
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to get execution requests:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get execution requests",
        });
      }
    }
  );

  /**
   * POST /api/agent-requests/:requestId/respond
   *
   * Respond to a request
   */
  router.post(
    "/agent-requests/:requestId/respond",
    async (req: Request, res: Response) => {
      try {
        const { requestId } = req.params;
        const { response } = req.body;

        if (!response) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Response is required",
          });
          return;
        }

        const userResponse = await routerService.respondToRequest(
          requestId,
          response,
          false
        );

        res.json({
          success: true,
          data: userResponse,
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to respond to request:", error);

        // Handle specific error cases
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("not found")) {
          res.status(404).json({
            success: false,
            data: null,
            message: errorMessage,
          });
          return;
        }

        if (
          errorMessage.includes("already responded") ||
          errorMessage.includes("expired") ||
          errorMessage.includes("cancelled")
        ) {
          res.status(409).json({
            success: false,
            data: null,
            message: errorMessage,
          });
          return;
        }

        res.status(500).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Failed to respond to request",
        });
      }
    }
  );

  /**
   * POST /api/agent-requests/:requestId/present
   *
   * Mark a request as presented to the user
   */
  router.post(
    "/agent-requests/:requestId/present",
    async (req: Request, res: Response) => {
      try {
        const { requestId } = req.params;
        routerService.markAsPresented(requestId);

        res.json({
          success: true,
          data: { requestId },
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to mark as presented:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to mark as presented",
        });
      }
    }
  );

  /**
   * DELETE /api/agent-requests/:requestId
   *
   * Cancel a request
   */
  router.delete(
    "/agent-requests/:requestId",
    async (req: Request, res: Response) => {
      try {
        const { requestId } = req.params;
        await routerService.cancelRequest(requestId);

        res.json({
          success: true,
          data: { requestId },
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to cancel request:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to cancel request",
        });
      }
    }
  );

  /**
   * DELETE /api/executions/:executionId/agent-requests
   *
   * Cancel all requests for an execution
   */
  router.delete(
    "/executions/:executionId/agent-requests",
    async (req: Request, res: Response) => {
      try {
        const { executionId } = req.params;
        const count = await routerService.cancelRequestsForExecution(
          executionId
        );

        res.json({
          success: true,
          data: { executionId, cancelledCount: count },
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to cancel execution requests:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to cancel execution requests",
        });
      }
    }
  );

  return router;
}
