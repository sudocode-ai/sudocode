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

  /**
   * GET /api/agent-requests/batches
   *
   * Get batches of similar requests
   */
  router.get("/agent-requests/batches", async (req: Request, res: Response) => {
    try {
      const batches = routerService.getBatches();

      // Enhance batches with pattern information
      const enhancedBatches = batches.map((batch) => ({
        ...batch,
        patterns: routerService.getBatchPatterns(batch.id, batch.requests),
      }));

      res.json({
        success: true,
        data: enhancedBatches,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get batches:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get batches",
      });
    }
  });

  /**
   * POST /api/agent-requests/batch/respond
   *
   * Respond to multiple requests in a batch with the same response
   */
  router.post(
    "/agent-requests/batch/respond",
    async (req: Request, res: Response) => {
      try {
        const { requestIds, response } = req.body;

        if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
          res.status(400).json({
            success: false,
            data: null,
            message: "requestIds array is required",
          });
          return;
        }

        if (!response) {
          res.status(400).json({
            success: false,
            data: null,
            message: "Response is required",
          });
          return;
        }

        const responses = await routerService.respondToBatch(
          requestIds,
          response,
          false
        );

        res.json({
          success: true,
          data: {
            responses,
            successCount: responses.length,
            totalCount: requestIds.length,
          },
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to respond to batch:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to respond to batch",
        });
      }
    }
  );

  /**
   * Pattern Management Endpoints
   */

  /**
   * GET /api/agent-requests/patterns
   *
   * Get all learned patterns
   */
  router.get("/agent-requests/patterns", async (req: Request, res: Response) => {
    try {
      const { autoResponseOnly, orderBy, limit } = req.query;

      const patterns = routerService.getPatterns({
        autoResponseOnly: autoResponseOnly === "true",
        orderBy: orderBy as any,
        limit: limit ? parseInt(limit as string) : undefined,
      });

      res.json({
        success: true,
        data: patterns,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get patterns:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get patterns",
      });
    }
  });

  /**
   * GET /api/agent-requests/patterns/:patternId
   *
   * Get a specific pattern
   */
  router.get(
    "/agent-requests/patterns/:patternId",
    async (req: Request, res: Response) => {
      try {
        const { patternId } = req.params;
        const pattern = await routerService.getPattern(patternId);

        if (!pattern) {
          res.status(404).json({
            success: false,
            data: null,
            message: "Pattern not found",
          });
          return;
        }

        res.json({
          success: true,
          data: pattern,
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to get pattern:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get pattern",
        });
      }
    }
  );

  /**
   * PUT /api/agent-requests/patterns/:patternId/auto-response
   *
   * Toggle auto-response for a pattern
   */
  router.put(
    "/agent-requests/patterns/:patternId/auto-response",
    async (req: Request, res: Response) => {
      try {
        const { patternId } = req.params;
        const { enabled } = req.body;

        if (typeof enabled !== "boolean") {
          res.status(400).json({
            success: false,
            data: null,
            message: "enabled must be a boolean",
          });
          return;
        }

        await routerService.setPatternAutoResponse(patternId, enabled);

        res.json({
          success: true,
          data: { patternId, enabled },
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to update pattern auto-response:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to update pattern auto-response",
        });
      }
    }
  );

  /**
   * DELETE /api/agent-requests/patterns/:patternId
   *
   * Delete a pattern
   */
  router.delete(
    "/agent-requests/patterns/:patternId",
    async (req: Request, res: Response) => {
      try {
        const { patternId } = req.params;
        await routerService.deletePattern(patternId);

        res.json({
          success: true,
          data: { patternId },
        });
      } catch (error) {
        console.error("[API Route] ERROR: Failed to delete pattern:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to delete pattern",
        });
      }
    }
  );

  /**
   * GET /api/agent-requests/auto-response/config
   *
   * Get auto-response configuration
   */
  router.get(
    "/agent-requests/auto-response/config",
    async (req: Request, res: Response) => {
      try {
        const config = routerService.getAutoResponseConfig();

        res.json({
          success: true,
          data: config,
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to get auto-response config:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get auto-response config",
        });
      }
    }
  );

  /**
   * PUT /api/agent-requests/auto-response/config
   *
   * Update auto-response configuration
   */
  router.put(
    "/agent-requests/auto-response/config",
    async (req: Request, res: Response) => {
      try {
        const config = req.body;
        routerService.updateAutoResponseConfig(config);

        res.json({
          success: true,
          data: config,
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to update auto-response config:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to update auto-response config",
        });
      }
    }
  );

  /**
   * GET /api/agent-requests/auto-response/stats
   *
   * Get auto-response statistics
   */
  router.get(
    "/agent-requests/auto-response/stats",
    async (req: Request, res: Response) => {
      try {
        const stats = await routerService.getAutoResponseStats();

        res.json({
          success: true,
          data: stats,
        });
      } catch (error) {
        console.error(
          "[API Route] ERROR: Failed to get auto-response stats:",
          error
        );
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get auto-response stats",
        });
      }
    }
  );

  return router;
}
