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
import * as path from "path";
import { findExistingEntityFile } from "@sudocode-ai/cli/dist/filename-generator.js";
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

      // Find markdown file before deletion (entity still in DB)
      const issuesDir = path.join(req.project!.sudocodeDir, "issues");
      const markdownPath = findExistingEntityFile(id, issuesDir);

      // Delete issue using CLI operation
      const deleted = deleteExistingIssue(req.project!.db, id);

      if (deleted) {
        // Delete markdown file if it exists
        if (markdownPath && fs.existsSync(markdownPath)) {
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

  return router;
}
