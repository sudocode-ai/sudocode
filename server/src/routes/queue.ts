/**
 * Queue API routes (mapped to /api/queue)
 *
 * Manages the merge queue for stacked diffs workflow.
 * Provides enriched queue entries with issue and stack information.
 */

import { Router, Request, Response } from "express";
import { getDataplaneAdapterSync } from "../services/dataplane-adapter.js";
import {
  getQueueWithStats,
  validateReorder,
  getQueueStats,
  type QueueStatus,
} from "../services/queue-view-service.js";
import { broadcastQueueUpdate } from "../services/websocket.js";

export function createQueueRouter(): Router {
  const router = Router();

  /**
   * GET /api/queue - List queue entries with optional filtering
   *
   * Query params:
   * - target_branch: Target branch to filter by (default: 'main')
   * - status: Filter by status (can be multiple)
   * - include_merged: Include merged entries (default: false)
   *
   * Response: {
   *   entries: EnrichedQueueEntry[];
   *   stats: QueueStats;
   * }
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const repoPath = req.project!.path;
      const dataplaneAdapter = getDataplaneAdapterSync(repoPath);

      if (!dataplaneAdapter) {
        res.status(501).json({
          success: false,
          data: null,
          message: "Dataplane not initialized for this project",
        });
        return;
      }

      // Parse query params
      const targetBranch = (req.query.target_branch as string) || "main";
      const includeMerged = req.query.include_merged === "true";

      // Parse status filter
      let statusFilter: QueueStatus[] | undefined;
      if (req.query.status) {
        const statuses = Array.isArray(req.query.status)
          ? req.query.status
          : [req.query.status];
        statusFilter = statuses as QueueStatus[];
      }

      // Build options
      const excludeStatuses: QueueStatus[] = [];
      if (!includeMerged) {
        excludeStatuses.push("merged");
      }

      const result = await getQueueWithStats(req.project!.db, dataplaneAdapter, {
        targetBranch,
        includeStatuses: statusFilter,
        excludeStatuses: excludeStatuses.length > 0 ? excludeStatuses : undefined,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error listing queue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list queue",
      });
    }
  });

  /**
   * POST /api/queue/reorder - Reorder a queue entry
   *
   * Body: {
   *   execution_id: string;
   *   new_position: number;
   *   target_branch?: string;
   * }
   *
   * Response (success): {
   *   new_order: string[];
   *   warning?: string;
   * }
   *
   * Response (dependency violation - 400): {
   *   blocked_by: string[];
   * }
   */
  router.post("/reorder", async (req: Request, res: Response) => {
    try {
      const repoPath = req.project!.path;
      const dataplaneAdapter = getDataplaneAdapterSync(repoPath);

      if (!dataplaneAdapter) {
        res.status(501).json({
          success: false,
          data: null,
          message: "Dataplane not initialized for this project",
        });
        return;
      }

      const { execution_id, new_position, target_branch } = req.body;

      // Validate input
      if (!execution_id || typeof execution_id !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "execution_id is required and must be a string",
        });
        return;
      }

      if (typeof new_position !== "number" || new_position < 1) {
        res.status(400).json({
          success: false,
          data: null,
          message: "new_position is required and must be a positive number",
        });
        return;
      }

      const targetBranch = target_branch || "main";

      // Validate reorder for dependency violations
      const validation = await validateReorder(
        req.project!.db,
        dataplaneAdapter,
        execution_id,
        new_position,
        targetBranch
      );

      if (!validation.valid) {
        if (validation.blockedBy && validation.blockedBy.length > 0) {
          res.status(400).json({
            success: false,
            message: validation.warning || "Cannot reorder due to dependency violation",
            data: {
              blocked_by: validation.blockedBy,
            },
          });
          return;
        }

        // Entry not found or other validation error
        res.status(404).json({
          success: false,
          data: null,
          message: validation.warning || "Queue entry not found",
        });
        return;
      }

      // Perform the reorder
      const result = await dataplaneAdapter.reorderQueue(
        execution_id,
        new_position,
        targetBranch
      );

      if (!result.success) {
        res.status(500).json({
          success: false,
          data: null,
          message: result.error || "Failed to reorder queue",
        });
        return;
      }

      // Broadcast WebSocket update
      broadcastQueueUpdate(req.project!.id, "reordered", {
        executionId: execution_id,
        newOrder: result.newOrder,
      });

      res.json({
        success: true,
        data: {
          new_order: result.newOrder,
        },
      });
    } catch (error) {
      console.error("Error reordering queue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to reorder queue",
      });
    }
  });

  /**
   * GET /api/queue/stats - Get queue statistics
   *
   * Query params:
   * - target_branch: Target branch (default: 'main')
   *
   * Response: QueueStats
   */
  router.get("/stats", async (req: Request, res: Response) => {
    try {
      const repoPath = req.project!.path;
      const dataplaneAdapter = getDataplaneAdapterSync(repoPath);

      if (!dataplaneAdapter) {
        res.status(501).json({
          success: false,
          data: null,
          message: "Dataplane not initialized for this project",
        });
        return;
      }

      const targetBranch = (req.query.target_branch as string) || "main";
      const stats = await getQueueStats(
        req.project!.db,
        dataplaneAdapter,
        targetBranch
      );

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error getting queue stats:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get queue stats",
      });
    }
  });

  return router;
}
