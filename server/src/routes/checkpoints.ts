/**
 * Checkpoints API routes (mapped to /api/checkpoints)
 *
 * Provides endpoints for listing and querying checkpoints in the dataplane.
 * Checkpoints are commit snapshots that can be grouped into diff stacks.
 */

import { Router, Request, Response } from "express";
import { getDataplaneAdapterSync } from "../services/dataplane-adapter.js";

export function createCheckpointsRouter(): Router {
  const router = Router();

  /**
   * GET /api/checkpoints - List checkpoints with optional filters
   *
   * Query params:
   * - issue_id: Filter by issue ID (requires app data association)
   * - stream_id: Filter by stream ID
   * - include_stats: Include file change statistics (default: false)
   *
   * Response: {
   *   checkpoints: DataplaneCheckpoint[];
   *   streams: Stream[];
   * }
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane adapter not found - ensure dataplane is enabled and server has been restarted",
        });
        return;
      }

      if (!dataplaneAdapter.isInitialized || !dataplaneAdapter.checkpointsModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: `Dataplane not fully initialized - isInitialized: ${dataplaneAdapter.isInitialized}, checkpointsModule: ${!!dataplaneAdapter.checkpointsModule}`,
        });
        return;
      }

      const streamId = req.query.stream_id as string | undefined;
      // Note: issue_id filtering would require app data association

      // Get checkpoints from dataplane
      // The checkpointsModule.listCheckpoints returns Checkpoint[] with camelCase fields
      const checkpoints = dataplaneAdapter.checkpointsModule.listCheckpoints(
        dataplaneAdapter.db,
        {
          streamId,
        }
      );

      // Get streams for context
      const streams = dataplaneAdapter.listStreams();

      // Map streams to response format
      const streamResult = streams.map((s: any) => ({
        id: s.id,
        name: s.name,
        agentId: s.agentId,
        baseCommit: s.baseCommit,
        parentStream: s.parentStream,
        branchPointCommit: s.branchPointCommit,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));

      res.json({
        success: true,
        data: {
          checkpoints,
          streams: streamResult,
        },
      });
    } catch (error) {
      console.error("Error listing checkpoints:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list checkpoints",
      });
    }
  });

  /**
   * POST /api/checkpoints/stats - Get statistics for specific checkpoints
   *
   * Body: {
   *   checkpointIds: string[];
   * }
   *
   * Response: Record<string, CheckpointStats>
   *
   * Note: This is a placeholder - actual stats require computing diffs
   * which is expensive. Consider caching or pre-computing.
   */
  router.post("/stats", async (req: Request, res: Response) => {
    try {
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane adapter not found - ensure dataplane is enabled and server has been restarted",
        });
        return;
      }

      if (!dataplaneAdapter.isInitialized || !dataplaneAdapter.checkpointsModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: `Dataplane not fully initialized - isInitialized: ${dataplaneAdapter.isInitialized}, checkpointsModule: ${!!dataplaneAdapter.checkpointsModule}`,
        });
        return;
      }

      const { checkpointIds } = req.body;

      if (!Array.isArray(checkpointIds)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "checkpointIds must be an array",
        });
        return;
      }

      // Get stats for each checkpoint
      // Note: This is a placeholder implementation
      // Actual stats would require computing git diffs
      const stats: Record<string, { filesChanged: number; additions: number; deletions: number }> = {};

      for (const cpId of checkpointIds) {
        const checkpoint = dataplaneAdapter.checkpointsModule.getCheckpoint(
          dataplaneAdapter.db,
          cpId
        );

        if (checkpoint) {
          // Placeholder stats - in production, these would come from git diff
          stats[cpId] = {
            filesChanged: 0,
            additions: 0,
            deletions: 0,
          };
        }
      }

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error getting checkpoint stats:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get checkpoint stats",
      });
    }
  });

  return router;
}
