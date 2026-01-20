/**
 * Diff Stacks API routes (mapped to /api/diff-stacks)
 *
 * Manages diff stacks for the unified checkpoint/diff stack architecture (s-366r).
 * Diff stacks are reviewable/mergeable units that group one or more checkpoints.
 */

import { Router, Request, Response } from "express";
import { getDataplaneAdapterSync } from "../services/dataplane-adapter.js";

export function createDiffStacksRouter(): Router {
  const router = Router();

  /**
   * GET /api/diff-stacks - List all diff stacks
   *
   * Query params:
   * - review_status: Filter by status (pending/approved/rejected/merged/abandoned)
   * - target_branch: Filter by target branch
   * - include_checkpoints: Include checkpoint data (default: true)
   * - queued_only: Only return queued stacks (default: false)
   *
   * Response: {
   *   stacks: DiffStack[] | DiffStackWithCheckpoints[];
   *   total: number;
   * }
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const reviewStatus = req.query.review_status as string | undefined;
      const targetBranch = req.query.target_branch as string | undefined;
      const includeCheckpoints = req.query.include_checkpoints !== "false";
      const queuedOnly = req.query.queued_only === "true";

      let stacks;

      if (queuedOnly) {
        // Get queued stacks for a specific target branch
        stacks = dataplaneAdapter.diffStacksModule.getQueuedStacks(
          dataplaneAdapter.db,
          targetBranch || "main"
        );
      } else {
        // List all stacks with optional filters
        stacks = dataplaneAdapter.diffStacksModule.listDiffStacks(
          dataplaneAdapter.db,
          {
            reviewStatus: reviewStatus as "pending" | "approved" | "rejected" | "merged" | "abandoned" | undefined,
            targetBranch,
          }
        );
      }

      // Optionally include checkpoints for each stack
      let result;
      if (includeCheckpoints) {
        result = stacks.map((stack) => {
          const checkpoints = dataplaneAdapter.diffStacksModule!.getCheckpointsInStack(
            dataplaneAdapter.db,
            stack.id
          );
          return {
            ...stack,
            checkpoints,
          };
        });
      } else {
        result = stacks;
      }

      res.json({
        success: true,
        data: {
          stacks: result,
          total: result.length,
        },
      });
    } catch (error) {
      console.error("Error listing diff stacks:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list diff stacks",
      });
    }
  });

  /**
   * GET /api/diff-stacks/:id - Get a specific diff stack with checkpoints
   *
   * Response: DiffStackWithCheckpoints
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const stack = dataplaneAdapter.diffStacksModule.getDiffStackWithCheckpoints(
        dataplaneAdapter.db,
        id
      );

      if (!stack) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Diff stack not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: stack,
      });
    } catch (error) {
      console.error("Error getting diff stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get diff stack",
      });
    }
  });

  /**
   * POST /api/diff-stacks - Create a new diff stack
   *
   * Request body: {
   *   name?: string;
   *   description?: string;
   *   target_branch?: string;
   *   checkpoint_ids?: string[];
   *   created_by?: string;
   * }
   *
   * Response: DiffStack
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const { name, description, target_branch, checkpoint_ids, created_by } = req.body;

      const stack = dataplaneAdapter.diffStacksModule.createDiffStack(
        dataplaneAdapter.db,
        {
          name,
          description,
          targetBranch: target_branch,
          checkpointIds: checkpoint_ids,
          createdBy: created_by,
        }
      );

      res.status(201).json({
        success: true,
        data: stack,
      });
    } catch (error) {
      console.error("Error creating diff stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create diff stack",
      });
    }
  });

  /**
   * PUT /api/diff-stacks/:id - Update a diff stack
   *
   * Request body: {
   *   name?: string;
   *   description?: string;
   * }
   *
   * Note: Use POST /api/diff-stacks/:id/review to change review status.
   * Note: Use POST /api/diff-stacks/:id/enqueue to manage queue position.
   *
   * Response: DiffStack
   */
  router.put("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      // Check if stack exists
      const existing = dataplaneAdapter.diffStacksModule.getDiffStack(
        dataplaneAdapter.db,
        id
      );
      if (!existing) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Diff stack not found: ${id}`,
        });
        return;
      }

      const { name, description } = req.body;

      // Update name and/or description via direct SQL (not exposed in module)
      // For now, we'll use review notes to update metadata
      if (name !== undefined || description !== undefined) {
        const updates: string[] = [];
        const values: unknown[] = [];

        if (name !== undefined) {
          updates.push("name = ?");
          values.push(name);
        }
        if (description !== undefined) {
          updates.push("description = ?");
          values.push(description);
        }

        if (updates.length > 0) {
          values.push(id);
          dataplaneAdapter.db.prepare(
            `UPDATE dp_diff_stacks SET ${updates.join(", ")} WHERE id = ?`
          ).run(...values);
        }
      }

      // Return updated stack
      const updated = dataplaneAdapter.diffStacksModule.getDiffStack(
        dataplaneAdapter.db,
        id
      );

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error("Error updating diff stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to update diff stack",
      });
    }
  });

  /**
   * DELETE /api/diff-stacks/:id - Delete a diff stack
   *
   * Response: { success: true }
   */
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const deleted = dataplaneAdapter.diffStacksModule.deleteDiffStack(
        dataplaneAdapter.db,
        id
      );

      if (!deleted) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Diff stack not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: null,
      });
    } catch (error) {
      console.error("Error deleting diff stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete diff stack",
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Checkpoint Grouping Endpoints
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/diff-stacks/:id/checkpoints - Add checkpoint(s) to stack
   *
   * Request body: {
   *   checkpoint_id: string;      // Single checkpoint
   *   checkpoint_ids?: string[];  // Or multiple checkpoints
   *   position?: number;          // Optional position (auto-increments if not specified)
   * }
   *
   * Response: DiffStackEntry | DiffStackEntry[]
   */
  router.post("/:id/checkpoints", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      // Check if stack exists
      const existing = dataplaneAdapter.diffStacksModule.getDiffStack(
        dataplaneAdapter.db,
        id
      );
      if (!existing) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Diff stack not found: ${id}`,
        });
        return;
      }

      const { checkpoint_id, checkpoint_ids, position } = req.body;

      // Handle single or multiple checkpoints
      const idsToAdd = checkpoint_ids || (checkpoint_id ? [checkpoint_id] : []);

      if (idsToAdd.length === 0) {
        res.status(400).json({
          success: false,
          data: null,
          message: "checkpoint_id or checkpoint_ids is required",
        });
        return;
      }

      const entries = idsToAdd.map((cpId: string, index: number) =>
        dataplaneAdapter.diffStacksModule!.addCheckpointToStack(
          dataplaneAdapter.db,
          {
            stackId: id,
            checkpointId: cpId,
            position: position !== undefined ? position + index : undefined,
          }
        )
      );

      res.status(201).json({
        success: true,
        data: entries.length === 1 ? entries[0] : entries,
      });
    } catch (error) {
      console.error("Error adding checkpoint to stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to add checkpoint to stack",
      });
    }
  });

  /**
   * DELETE /api/diff-stacks/:id/checkpoints/:cpId - Remove checkpoint from stack
   *
   * Response: { success: true }
   */
  router.delete("/:id/checkpoints/:cpId", (req: Request, res: Response) => {
    try {
      const { id, cpId } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const removed = dataplaneAdapter.diffStacksModule.removeCheckpointFromStack(
        dataplaneAdapter.db,
        id,
        cpId
      );

      if (!removed) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Checkpoint ${cpId} not found in stack ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: null,
      });
    } catch (error) {
      console.error("Error removing checkpoint from stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to remove checkpoint from stack",
      });
    }
  });

  /**
   * PUT /api/diff-stacks/:id/checkpoints/reorder - Reorder checkpoints in stack
   *
   * Request body: {
   *   checkpoint_ids: string[];  // New order of checkpoint IDs
   * }
   *
   * Response: { success: true }
   */
  router.put("/:id/checkpoints/reorder", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const { checkpoint_ids } = req.body;

      if (!checkpoint_ids || !Array.isArray(checkpoint_ids)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "checkpoint_ids array is required",
        });
        return;
      }

      dataplaneAdapter.diffStacksModule.reorderStackCheckpoints(
        dataplaneAdapter.db,
        id,
        checkpoint_ids
      );

      res.json({
        success: true,
        data: null,
      });
    } catch (error) {
      console.error("Error reordering checkpoints:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to reorder checkpoints",
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Review Workflow Endpoints
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/diff-stacks/:id/review - Set review status
   *
   * Request body: {
   *   status: 'pending' | 'approved' | 'rejected' | 'abandoned';
   *   reviewed_by?: string;
   *   notes?: string;
   * }
   *
   * Response: DiffStack
   */
  router.post("/:id/review", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const { status, reviewed_by, notes } = req.body;

      if (!status) {
        res.status(400).json({
          success: false,
          data: null,
          message: "status is required",
        });
        return;
      }

      // Validate status transition
      const existing = dataplaneAdapter.diffStacksModule.getDiffStack(
        dataplaneAdapter.db,
        id
      );
      if (!existing) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Diff stack not found: ${id}`,
        });
        return;
      }

      if (!dataplaneAdapter.diffStacksModule.isValidStatusTransition(
        existing.reviewStatus,
        status
      )) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Invalid status transition: ${existing.reviewStatus} → ${status}`,
        });
        return;
      }

      const updated = dataplaneAdapter.diffStacksModule.setStackReviewStatus(
        dataplaneAdapter.db,
        {
          stackId: id,
          status,
          reviewedBy: reviewed_by,
          notes,
        }
      );

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error("Error setting review status:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to set review status",
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Queue Management Endpoints
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/diff-stacks/:id/enqueue - Add stack to merge queue
   *
   * Note: Stack must be approved to be queued.
   *
   * Response: DiffStack
   */
  router.post("/:id/enqueue", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const updated = dataplaneAdapter.diffStacksModule.enqueueStack(
        dataplaneAdapter.db,
        id
      );

      if (!updated) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Failed to enqueue stack ${id}. Stack must be approved.`,
        });
        return;
      }

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error("Error enqueueing stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to enqueue stack",
      });
    }
  });

  /**
   * DELETE /api/diff-stacks/:id/enqueue - Remove stack from merge queue
   *
   * Response: DiffStack
   */
  router.delete("/:id/enqueue", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      const updated = dataplaneAdapter.diffStacksModule.dequeueStack(
        dataplaneAdapter.db,
        id
      );

      if (!updated) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Stack ${id} not found or not in queue`,
        });
        return;
      }

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error("Error dequeueing stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to dequeue stack",
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Merge Execution Endpoint
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/diff-stacks/:id/merge - Execute merge for stack
   *
   * Merges all checkpoints in the stack to the target branch.
   * Stack must be approved before merging.
   *
   * Request body: {
   *   dry_run?: boolean;  // Preview merge without applying (default: false)
   * }
   *
   * Response: {
   *   merged_checkpoints: string[];
   *   skipped_checkpoints: string[];  // Already merged
   *   conflicts?: string[];           // Only in dry_run mode
   *   target_branch: string;
   *   merge_commit?: string;          // Final merge commit SHA
   * }
   */
  router.post("/:id/merge", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { dry_run = false } = req.body;
      const dataplaneAdapter = getDataplaneAdapterSync(req.project!.path);

      if (!dataplaneAdapter?.isInitialized || !dataplaneAdapter.diffStacksModule) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Dataplane not initialized or diff stacks module not available",
        });
        return;
      }

      // Get stack with checkpoints
      const stack = dataplaneAdapter.diffStacksModule.getDiffStackWithCheckpoints(
        dataplaneAdapter.db,
        id
      );

      if (!stack) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Diff stack not found: ${id}`,
        });
        return;
      }

      // Validate stack is approved
      if (stack.reviewStatus !== "approved") {
        res.status(400).json({
          success: false,
          data: null,
          message: `Stack must be approved before merging. Current status: ${stack.reviewStatus}`,
        });
        return;
      }

      // Get checkpoints in topological order (respects DAG + timestamp tiebreaker)
      const checkpoints = getCheckpointsInMergeOrder(
        stack.checkpoints,
        dataplaneAdapter
      );

      if (checkpoints.length === 0) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Stack has no checkpoints to merge",
        });
        return;
      }

      const { execSync } = await import("child_process");
      const repoPath = req.project!.path;
      const targetBranch = stack.targetBranch;

      const mergedCheckpoints: string[] = [];
      const skippedCheckpoints: string[] = [];
      const conflicts: string[] = [];

      // Check which commits are already in target branch
      for (const cp of checkpoints) {
        try {
          // Check if commit is ancestor of target branch (already merged)
          execSync(`git merge-base --is-ancestor ${cp.commitSha} ${targetBranch}`, {
            cwd: repoPath,
            stdio: "pipe",
          });
          // If no error, commit is already merged
          skippedCheckpoints.push(cp.id);
        } catch {
          // Commit not in target branch - needs to be merged
          if (!dry_run) {
            try {
              // Cherry-pick the commit
              execSync(`git cherry-pick --no-commit ${cp.commitSha}`, {
                cwd: repoPath,
                stdio: "pipe",
              });
              mergedCheckpoints.push(cp.id);
            } catch (cherryPickError) {
              // Cherry-pick failed - likely conflict
              // Abort the cherry-pick
              try {
                execSync("git cherry-pick --abort", { cwd: repoPath, stdio: "pipe" });
              } catch {
                // Ignore abort errors
              }
              conflicts.push(cp.id);
            }
          } else {
            // In dry-run mode, just mark as needing merge
            mergedCheckpoints.push(cp.id);
          }
        }
      }

      // If we had conflicts, don't proceed
      if (conflicts.length > 0) {
        res.status(409).json({
          success: false,
          data: {
            merged_checkpoints: mergedCheckpoints,
            skipped_checkpoints: skippedCheckpoints,
            conflicts,
            target_branch: targetBranch,
          },
          message: "Merge conflicts detected. Cherry-picks have been aborted.",
        });
        return;
      }

      let mergeCommit: string | undefined;

      if (!dry_run && mergedCheckpoints.length > 0) {
        // Commit the cherry-picked changes
        const message = `Merge diff stack: ${stack.name || id}\n\nCheckpoints merged:\n${mergedCheckpoints.map((cpId) => `- ${cpId}`).join("\n")}`;

        try {
          execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
            cwd: repoPath,
            stdio: "pipe",
          });
          mergeCommit = execSync("git rev-parse HEAD", {
            cwd: repoPath,
            encoding: "utf-8",
          }).trim();

          // Update stack status to merged
          dataplaneAdapter.diffStacksModule.setStackReviewStatus(
            dataplaneAdapter.db,
            {
              stackId: id,
              status: "merged",
            }
          );

          // Dequeue from merge queue if queued
          if (stack.queuePosition !== null) {
            dataplaneAdapter.diffStacksModule.dequeueStack(
              dataplaneAdapter.db,
              id
            );
          }
        } catch (commitError) {
          res.status(500).json({
            success: false,
            data: null,
            error_data: commitError instanceof Error ? commitError.message : String(commitError),
            message: "Failed to commit merged changes",
          });
          return;
        }
      }

      res.json({
        success: true,
        data: {
          merged_checkpoints: mergedCheckpoints,
          skipped_checkpoints: skippedCheckpoints,
          target_branch: targetBranch,
          ...(mergeCommit && { merge_commit: mergeCommit }),
          ...(dry_run && { dry_run: true }),
        },
      });
    } catch (error) {
      console.error("Error merging stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to merge stack",
      });
    }
  });

  return router;
}

/**
 * Get checkpoints in merge order (topological + timestamp tiebreaker).
 *
 * Algorithm:
 * 1. Build dependency graph from stream lineage
 * 2. Topological sort
 * 3. For ties (independent checkpoints), sort by createdAt
 */
function getCheckpointsInMergeOrder(
  checkpoints: Array<{
    id: string;
    streamId: string;
    commitSha: string;
    parentCommit: string | null;
    createdAt: number;
    position: number;
  }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataplaneAdapter: any
): Array<{
  id: string;
  streamId: string;
  commitSha: string;
  parentCommit: string | null;
  createdAt: number;
  position: number;
}> {
  if (checkpoints.length <= 1) {
    return checkpoints;
  }

  // Build dependency graph from stream lineage
  // A checkpoint depends on its parent checkpoint (via parentCommit)
  // and on checkpoints from parent streams

  // First, get stream info for each checkpoint
  const streamMap = new Map<string, { parentStream: string | null }>();
  for (const cp of checkpoints) {
    if (!streamMap.has(cp.streamId)) {
      try {
        const stream = dataplaneAdapter.tracker?.getStream(cp.streamId);
        if (stream) {
          streamMap.set(cp.streamId, { parentStream: stream.parentStream });
        }
      } catch {
        // Stream info not available
      }
    }
  }

  // Build checkpoint map by commitSha for dependency lookup
  const commitMap = new Map<string, typeof checkpoints[0]>();
  for (const cp of checkpoints) {
    commitMap.set(cp.commitSha, cp);
  }

  // Build adjacency list for topological sort
  // edges[cpId] = list of checkpoint IDs that depend on cpId
  const edges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const cp of checkpoints) {
    edges.set(cp.id, []);
    inDegree.set(cp.id, 0);
  }

  // Add edges based on:
  // 1. parentCommit -> current (if parentCommit is in the stack)
  // 2. Parent stream's checkpoints -> child stream's checkpoints
  for (const cp of checkpoints) {
    // Check if parentCommit is another checkpoint in the stack
    if (cp.parentCommit) {
      const parent = commitMap.get(cp.parentCommit);
      if (parent) {
        edges.get(parent.id)!.push(cp.id);
        inDegree.set(cp.id, (inDegree.get(cp.id) || 0) + 1);
      }
    }

    // Check if this checkpoint's stream has a parent stream with checkpoints in the stack
    const streamInfo = streamMap.get(cp.streamId);
    if (streamInfo?.parentStream) {
      // Find checkpoints from the parent stream
      const parentStreamCheckpoints = checkpoints.filter(
        (other) => other.streamId === streamInfo.parentStream && other.id !== cp.id
      );
      for (const parentCp of parentStreamCheckpoints) {
        // Parent stream checkpoints should come before child stream checkpoints
        if (!edges.get(parentCp.id)!.includes(cp.id)) {
          edges.get(parentCp.id)!.push(cp.id);
          inDegree.set(cp.id, (inDegree.get(cp.id) || 0) + 1);
        }
      }
    }
  }

  // Kahn's algorithm for topological sort with timestamp tiebreaker
  const result: typeof checkpoints = [];
  const queue: typeof checkpoints = [];

  // Start with checkpoints that have no dependencies
  for (const cp of checkpoints) {
    if (inDegree.get(cp.id) === 0) {
      queue.push(cp);
    }
  }

  // Sort queue by createdAt for timestamp tiebreaker
  queue.sort((a, b) => a.createdAt - b.createdAt);

  while (queue.length > 0) {
    const cp = queue.shift()!;
    result.push(cp);

    // Process dependents
    for (const dependentId of edges.get(cp.id) || []) {
      const newDegree = (inDegree.get(dependentId) || 1) - 1;
      inDegree.set(dependentId, newDegree);

      if (newDegree === 0) {
        const dependent = checkpoints.find((c) => c.id === dependentId);
        if (dependent) {
          // Insert in sorted order by createdAt
          const insertIdx = queue.findIndex((q) => q.createdAt > dependent.createdAt);
          if (insertIdx === -1) {
            queue.push(dependent);
          } else {
            queue.splice(insertIdx, 0, dependent);
          }
        }
      }
    }
  }

  // If we didn't process all checkpoints, there's a cycle - fall back to position order
  if (result.length !== checkpoints.length) {
    console.warn("[getCheckpointsInMergeOrder] Cycle detected, falling back to position order");
    return [...checkpoints].sort((a, b) => a.position - b.position);
  }

  return result;
}

// Export for testing
export { getCheckpointsInMergeOrder };
