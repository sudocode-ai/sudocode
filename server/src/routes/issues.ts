/**
 * Issues API routes (mapped to /api/issues)
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import {
  getAllIssues,
  getIssueById,
  createNewIssue,
  updateExistingIssue,
  deleteExistingIssue,
} from "../services/issues.js";
import { generateIssueId } from "@sudocode-ai/cli/dist/id-generator.js";
import { getIssueFromJsonl } from "@sudocode-ai/cli/dist/operations/external-links.js";
import { broadcastIssueUpdate } from "../services/websocket.js";
import { triggerExport, executeExportNow, syncEntityToMarkdown } from "../services/export.js";
import { refreshIssue } from "../services/external-refresh-service.js";
import { getDataplaneAdapterSync } from "../services/dataplane-adapter.js";
import { getStackForIssue } from "../services/stack-service.js";
import * as path from "path";
import * as fs from "fs";

export function createIssuesRouter(): Router {
  const router = Router();

  /**
   * GET /api/issues - List all issues
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      // Parse query parameters for filtering
      const options: any = {};

      if (req.query.status) {
        options.status = req.query.status as string;
      }
      if (req.query.priority) {
        options.priority = parseInt(req.query.priority as string, 10);
      }
      if (req.query.assignee) {
        options.assignee = req.query.assignee as string;
      }
      // Default to excluding archived unless explicitly specified
      options.archived =
        req.query.archived !== undefined
          ? req.query.archived === "true"
          : false;
      if (req.query.limit) {
        options.limit = parseInt(req.query.limit as string, 10);
      }
      if (req.query.offset) {
        options.offset = parseInt(req.query.offset as string, 10);
      }

      const issues = getAllIssues(req.project!.db, options);

      res.json({
        success: true,
        data: issues,
      });
    } catch (error) {
      console.error("Error listing issues:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list issues",
      });
    }
  });

  /**
   * GET /api/issues/:id - Get a specific issue
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const issue = getIssueById(req.project!.db, id);

      if (!issue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: issue,
      });
    } catch (error) {
      console.error("Error getting issue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get issue",
      });
    }
  });

  /**
   * POST /api/issues - Create a new issue
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const { title, content, status, priority, assignee, parent_id } =
        req.body;

      // Validate required fields
      if (!title || typeof title !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "Title is required and must be a string",
        });
        return;
      }

      if (title.length > 500) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Title must be 500 characters or less",
        });
        return;
      }

      // Generate new issue ID
      const outputDir = req.project!.sudocodeDir;
      const { id, uuid } = generateIssueId(req.project!.db, outputDir);

      // Create issue using CLI operation
      const issue = createNewIssue(req.project!.db, {
        id,
        uuid,
        title,
        content: content || "",
        status: status || "open",
        priority: priority !== undefined ? priority : 2,
        assignee: assignee || undefined,
        parent_id: parent_id || undefined,
      });

      // Trigger export to JSONL files
      triggerExport(req.project!.db, req.project!.sudocodeDir);

      // Sync this specific issue to its markdown file (don't wait for it)
      syncEntityToMarkdown(req.project!.db, issue.id, "issue", req.project!.sudocodeDir).catch((error) => {
        console.error(`Failed to sync issue ${issue.id} to markdown:`, error);
      });

      // Broadcast issue creation to WebSocket clients
      broadcastIssueUpdate(req.project!.id, issue.id, "created", issue);

      res.status(201).json({
        success: true,
        data: issue,
      });
    } catch (error) {
      console.error("Error creating issue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create issue",
      });
    }
  });

  /**
   * PUT /api/issues/:id - Update an existing issue
   */
  router.put("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        title,
        content,
        status,
        priority,
        assignee,
        parent_id,
        archived,
      } = req.body;

      // Validate that at least one field is provided
      if (
        title === undefined &&
        content === undefined &&
        status === undefined &&
        priority === undefined &&
        assignee === undefined &&
        parent_id === undefined &&
        archived === undefined
      ) {
        res.status(400).json({
          success: false,
          data: null,
          message: "At least one field must be provided for update",
        });
        return;
      }

      // Validate title length if provided
      if (
        title !== undefined &&
        typeof title === "string" &&
        title.length > 500
      ) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Title must be 500 characters or less",
        });
        return;
      }

      // Build update input
      const updateInput: any = {};
      if (title !== undefined) updateInput.title = title;
      if (content !== undefined) updateInput.content = content;
      if (status !== undefined) updateInput.status = status;
      if (priority !== undefined) updateInput.priority = priority;
      if (assignee !== undefined) updateInput.assignee = assignee;
      if (parent_id !== undefined) updateInput.parent_id = parent_id;
      if (archived !== undefined) {
        updateInput.archived = archived;
        updateInput.archived_at = archived ? new Date().toISOString() : null;
      }

      // Update issue using CLI operation
      const issue = updateExistingIssue(req.project!.db, id, updateInput);

      // If integration sync is enabled, export immediately so JSONL is updated before sync
      // Otherwise use debounced export
      if (req.project!.integrationSyncService) {
        // Execute export now to ensure JSONL is updated before integration sync
        await executeExportNow(req.project!.db, req.project!.sudocodeDir);

        // Sync to external integrations
        req.project!.integrationSyncService.syncEntity(issue.id).catch((error) => {
          console.error(`Failed to sync issue ${issue.id} to external integrations:`, error);
        });
      } else {
        // Trigger debounced export when no integration sync is needed
        triggerExport(req.project!.db, req.project!.sudocodeDir);
      }

      // Sync this specific issue to its markdown file (don't wait for it)
      syncEntityToMarkdown(req.project!.db, issue.id, "issue", req.project!.sudocodeDir).catch((error) => {
        console.error(`Failed to sync issue ${issue.id} to markdown:`, error);
      });

      // Broadcast issue update to WebSocket clients
      broadcastIssueUpdate(req.project!.id, issue.id, "updated", issue);

      res.json({
        success: true,
        data: issue,
      });
    } catch (error) {
      console.error("Error updating issue:", error);

      // Handle "not found" errors
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          data: null,
          message: error.message,
        });
        return;
      }

      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to update issue",
      });
    }
  });

  /**
   * DELETE /api/issues/:id - Delete an issue
   */
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check if issue exists first
      const existingIssue = getIssueById(req.project!.db, id);
      if (!existingIssue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      // Read external_links from JSONL BEFORE deleting (for outbound propagation)
      const jsonlIssue = getIssueFromJsonl(req.project!.sudocodeDir, id);
      const externalLinks = jsonlIssue?.external_links || [];

      // Save file_path before deletion (issues use standard path format)
      const markdownPath = path.join(
        req.project!.sudocodeDir,
        "issues",
        `${id}.md`
      );

      // Delete issue using CLI operation
      const deleted = deleteExistingIssue(req.project!.db, id);

      if (deleted) {
        // Delete markdown file if it exists
        if (fs.existsSync(markdownPath)) {
          try {
            fs.unlinkSync(markdownPath);
          } catch (err) {
            console.warn(`Failed to delete markdown file: ${markdownPath}`, err);
          }
        }

        // Trigger export to JSONL files
        triggerExport(req.project!.db, req.project!.sudocodeDir);

        // Propagate deletion to external systems (if any links exist)
        if (externalLinks.length > 0 && req.project!.integrationSyncService) {
          req.project!.integrationSyncService.handleEntityDeleted(id, externalLinks).catch((error) => {
            console.error(`[issues] Failed to propagate deletion to external systems:`, error);
          });
        }

        // Broadcast issue deletion to WebSocket clients
        broadcastIssueUpdate(req.project!.id, id, "deleted", { id });

        res.json({
          success: true,
          data: {
            id,
            deleted: true,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          data: null,
          message: "Failed to delete issue",
        });
      }
    } catch (error) {
      console.error("Error deleting issue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete issue",
      });
    }
  });

  /**
   * POST /api/issues/:id/refresh_from_external - Refresh an issue from its external source
   *
   * Query params:
   * - force=true: Skip conflict check, overwrite local changes
   *
   * Response:
   * - updated: boolean - Whether the entity was updated
   * - hasLocalChanges: boolean - Whether local changes were detected
   * - changes?: Array<{field, localValue, remoteValue}> - Field-level changes (when hasLocalChanges=true)
   * - entity?: Issue - The updated entity (when updated=true)
   */
  router.post("/:id/refresh_from_external", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const force = req.query.force === "true";

      // Check if issue exists
      const existingIssue = getIssueById(req.project!.db, id);
      if (!existingIssue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      // Refresh from external source
      const result = await refreshIssue(
        req.project!.db,
        req.project!.sudocodeDir,
        req.project!.path,
        id,
        force
      );

      // Handle stale links (external entity deleted)
      if (result.stale) {
        res.status(200).json({
          success: true,
          data: {
            updated: false,
            hasLocalChanges: false,
            stale: true,
            message: result.error || "External entity no longer exists",
          },
        });
        return;
      }

      // Handle errors
      if (result.error && !result.hasLocalChanges) {
        res.status(400).json({
          success: false,
          data: null,
          message: result.error,
        });
        return;
      }

      // Handle local changes preview (not forced)
      if (result.hasLocalChanges && !result.updated) {
        res.status(200).json({
          success: true,
          data: {
            updated: false,
            hasLocalChanges: true,
            changes: result.changes,
          },
        });
        return;
      }

      // Handle successful update
      if (result.updated && result.entity) {
        // Trigger export to JSONL files
        triggerExport(req.project!.db, req.project!.sudocodeDir);

        // Sync to markdown file
        syncEntityToMarkdown(
          req.project!.db,
          id,
          "issue",
          req.project!.sudocodeDir
        ).catch((error) => {
          console.error(`Failed to sync issue ${id} to markdown:`, error);
        });

        // Broadcast issue update to WebSocket clients
        broadcastIssueUpdate(req.project!.id, id, "updated", result.entity);

        res.status(200).json({
          success: true,
          data: {
            updated: true,
            hasLocalChanges: false,
            entity: result.entity,
          },
        });
        return;
      }

      // No changes needed
      res.status(200).json({
        success: true,
        data: {
          updated: false,
          hasLocalChanges: false,
        },
      });
    } catch (error) {
      console.error("Error refreshing issue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to refresh issue",
      });
    }
  });

  /**
   * GET /api/issues/:id/checkpoints - List all checkpoints for an issue
   *
   * Returns all checkpoints created for this issue, ordered by creation time (newest first).
   * Also identifies the current/active checkpoint.
   *
   * Response:
   * - checkpoints: Array of checkpoint records
   * - current: The most recent checkpoint (or null if none)
   */
  router.get("/:id/checkpoints", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = req.project!.db;

      // Check if issue exists
      const issue = getIssueById(db, id);
      if (!issue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      // Get all checkpoints for this issue, ordered by creation time (newest first)
      const checkpoints = db
        .prepare(
          `SELECT
            id,
            issue_id,
            execution_id,
            stream_id,
            commit_sha,
            parent_commit,
            changed_files,
            additions,
            deletions,
            message,
            checkpointed_at,
            checkpointed_by,
            review_status,
            reviewed_at,
            reviewed_by,
            review_notes
          FROM checkpoints
          WHERE issue_id = ?
          ORDER BY checkpointed_at DESC`
        )
        .all(id);

      // The first checkpoint in the list (if any) is the current/most recent
      const current = checkpoints.length > 0 ? checkpoints[0] : null;

      res.json({
        success: true,
        data: {
          checkpoints,
          current,
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
   * GET /api/issues/:id/checkpoint/current - Get the current checkpoint for an issue
   *
   * Returns the most recent checkpoint for this issue, or null if none exist.
   * This is a convenience endpoint for quickly checking the latest checkpoint state.
   */
  router.get("/:id/checkpoint/current", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = req.project!.db;

      // Check if issue exists
      const issue = getIssueById(db, id);
      if (!issue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      // Get the most recent checkpoint for this issue
      const checkpoint = db
        .prepare(
          `SELECT
            id,
            issue_id,
            execution_id,
            stream_id,
            commit_sha,
            parent_commit,
            changed_files,
            additions,
            deletions,
            message,
            checkpointed_at,
            checkpointed_by,
            review_status,
            reviewed_at,
            reviewed_by,
            review_notes
          FROM checkpoints
          WHERE issue_id = ?
          ORDER BY checkpointed_at DESC
          LIMIT 1`
        )
        .get(id);

      res.json({
        success: true,
        data: checkpoint || null,
      });
    } catch (error) {
      console.error("Error getting current checkpoint:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get current checkpoint",
      });
    }
  });

  /**
   * POST /api/issues/:id/review - Review (approve/reject) the current checkpoint
   *
   * This endpoint allows approving or requesting changes on an issue's checkpoint.
   * This is part of the two-tier merge workflow: checkpoint → review → promote.
   *
   * Request body:
   * - action: 'approve' | 'request_changes' | 'reset'
   * - notes?: string - Review notes/feedback
   * - reviewed_by?: string - Reviewer identifier
   *
   * Response:
   * - issue_id: string
   * - checkpoint_id: string
   * - review_status: 'approved' | 'changes_requested' | 'pending'
   * - reviewed_at: string
   * - reviewed_by?: string
   * - review_notes?: string
   */
  router.post("/:id/review", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action, notes, reviewed_by } = req.body;
      const db = req.project!.db;
      const repoPath = req.project!.path;

      // Validate action
      const validActions = ["approve", "request_changes", "reset"];
      if (!action || !validActions.includes(action)) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Invalid action. Must be one of: ${validActions.join(", ")}`,
        });
        return;
      }

      // Check if issue exists
      const issue = getIssueById(db, id);
      if (!issue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      // Get the current checkpoint for this issue
      const checkpoint = db
        .prepare(
          `SELECT id, review_status
           FROM checkpoints
           WHERE issue_id = ?
           ORDER BY checkpointed_at DESC
           LIMIT 1`
        )
        .get(id) as { id: string; review_status: string } | undefined;

      if (!checkpoint) {
        res.status(400).json({
          success: false,
          data: null,
          message: "No checkpoint found for this issue. Create a checkpoint first.",
        });
        return;
      }

      // Map action to review status
      let reviewStatus: "approved" | "changes_requested" | "pending";
      switch (action) {
        case "approve":
          reviewStatus = "approved";
          break;
        case "request_changes":
          reviewStatus = "changes_requested";
          break;
        case "reset":
          reviewStatus = "pending";
          break;
        default:
          reviewStatus = "pending";
      }

      const reviewedAt = new Date().toISOString();

      // Update checkpoint record
      const updateStmt = db.prepare(`
        UPDATE checkpoints
        SET review_status = ?,
            reviewed_at = ?,
            reviewed_by = ?,
            review_notes = ?
        WHERE id = ?
      `);
      updateStmt.run(
        reviewStatus,
        reviewedAt,
        reviewed_by || null,
        notes || null,
        checkpoint.id
      );

      // Update issue stream metadata via DataplaneAdapter
      const dataplaneAdapter = getDataplaneAdapterSync(repoPath);
      if (dataplaneAdapter) {
        try {
          // Map review status to stream metadata status
          const streamStatus =
            reviewStatus === "changes_requested"
              ? "changes_requested"
              : reviewStatus === "approved"
              ? "approved"
              : "pending";
          dataplaneAdapter.updateIssueStreamReviewStatus(id, streamStatus);
        } catch (error) {
          // Log but don't fail - database update succeeded
          console.warn(
            `Failed to update issue stream review status: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      // Broadcast issue update (review status changed)
      broadcastIssueUpdate(req.project!.id, id, "updated", issue);

      res.json({
        success: true,
        data: {
          issue_id: id,
          checkpoint_id: checkpoint.id,
          review_status: reviewStatus,
          reviewed_at: reviewedAt,
          reviewed_by: reviewed_by || null,
          review_notes: notes || null,
        },
      });
    } catch (error) {
      console.error("Error reviewing checkpoint:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to review checkpoint",
      });
    }
  });

  /**
   * POST /api/issues/:id/promote - Promote issue checkpoint to main branch
   *
   * This is the second tier of the two-tier merge workflow.
   * After checkpoints are approved, this merges the issue stream to main.
   *
   * Request body:
   * - target_branch?: string - Target branch (default: main)
   * - strategy?: 'squash' | 'merge' - Merge strategy (default: squash)
   * - include_stack?: boolean - Promote entire stack (default: false)
   * - message?: string - Custom merge commit message
   * - force?: boolean - Skip approval check (default: false)
   *
   * Response codes:
   * - 200: Success
   * - 400: Invalid request
   * - 403: Requires approval
   * - 404: Issue not found
   * - 409: Conflicts or blocked by dependencies
   * - 500: Server error
   * - 501: Dataplane not initialized
   */
  router.post("/:id/promote", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        target_branch,
        strategy,
        include_stack,
        message,
        force,
        promoted_by,
      } = req.body;
      const db = req.project!.db;
      const repoPath = req.project!.path;

      // Check if issue exists
      const issue = getIssueById(db, id);
      if (!issue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${id}`,
        });
        return;
      }

      // Get dataplane adapter
      const dataplaneAdapter = getDataplaneAdapterSync(repoPath);
      if (!dataplaneAdapter) {
        res.status(501).json({
          success: false,
          data: null,
          message: "Dataplane not initialized. Enable dataplane in project config.",
        });
        return;
      }

      // Call promoteSync
      const result = await dataplaneAdapter.promoteSync(id, db, {
        targetBranch: target_branch,
        strategy: strategy,
        includeStack: include_stack,
        message: message,
        force: force === true,
        promotedBy: promoted_by,
      });

      // Handle different result scenarios
      if (result.success) {
        // Success - return merge info
        res.json({
          success: true,
          data: {
            merge_commit: result.mergeCommit,
            files_changed: result.filesChanged,
            additions: result.additions,
            deletions: result.deletions,
            promoted_issues: result.promotedIssues,
            cascade: result.cascade,
          },
        });
        return;
      }

      // Handle blocked by dependencies
      if (result.blockedBy && result.blockedBy.length > 0) {
        res.status(409).json({
          success: false,
          data: null,
          error: "Dependencies not merged",
          blocked_by: result.blockedBy,
          message: `Cannot promote: blocked by unmerged issues: ${result.blockedBy.join(", ")}`,
        });
        return;
      }

      // Handle requires approval
      if (result.requiresApproval) {
        res.status(403).json({
          success: false,
          data: null,
          error: "Checkpoint requires approval",
          message: result.error,
        });
        return;
      }

      // Handle conflicts
      if (result.conflicts && result.conflicts.length > 0) {
        res.status(409).json({
          success: false,
          data: null,
          error: "Conflicts detected",
          conflicts: result.conflicts,
          message: result.error,
        });
        return;
      }

      // Generic error
      res.status(400).json({
        success: false,
        data: null,
        error: result.error || "Promote failed",
        message: result.error || "Failed to promote checkpoint",
      });
    } catch (error) {
      console.error("Error promoting checkpoint:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to promote checkpoint",
      });
    }
  });

  /**
   * GET /api/issues/:id/stack - Get the stack containing this issue
   *
   * Returns the stack (auto or manual) that contains this issue,
   * or null if the issue is not part of any stack.
   *
   * Response: StackInfo | null
   */
  router.get("/:id/stack", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const stackInfo = getStackForIssue(req.project!.db, id);

      res.json({
        success: true,
        data: stackInfo,
      });
    } catch (error) {
      console.error("Error getting stack for issue:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get stack for issue",
      });
    }
  });

  return router;
}
