/**
 * Specs API routes (mapped to /api/specs)
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import {
  getAllSpecs,
  getSpecById,
  createNewSpec,
  updateExistingSpec,
  deleteExistingSpec,
} from "../services/specs.js";
import { generateSpecId } from "@sudocode-ai/cli/dist/id-generator.js";
import { generateUniqueFilename } from "@sudocode-ai/cli/dist/filename-generator.js";
import { getSpecFromJsonl } from "@sudocode-ai/cli/dist/operations/external-links.js";
import { broadcastSpecUpdate } from "../services/websocket.js";
import {
  triggerExport,
  executeExportNow,
  syncEntityToMarkdown,
} from "../services/export.js";
import { refreshSpec } from "../services/external-refresh-service.js";
import * as path from "path";
import * as fs from "fs";

export function createSpecsRouter(): Router {
  const router = Router();

  /**
   * GET /api/specs - List all specs
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      // Parse query parameters for filtering
      const options: any = {};

      if (req.query.priority) {
        options.priority = parseInt(req.query.priority as string, 10);
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

      const specs = getAllSpecs(req.project!.db, options);

      res.json({
        success: true,
        data: specs,
      });
    } catch (error) {
      console.error("Error listing specs:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list specs",
      });
    }
  });

  /**
   * GET /api/specs/:id - Get a specific spec
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const spec = getSpecById(req.project!.db, id);

      if (!spec) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Spec not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: spec,
      });
    } catch (error) {
      console.error("Error getting spec:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get spec",
      });
    }
  });

  /**
   * POST /api/specs - Create a new spec
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const { title, content, priority, parent_id } = req.body;

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

      // Generate new spec ID
      const outputDir = req.project!.sudocodeDir;
      const { id, uuid } = generateSpecId(req.project!.db, outputDir);

      // Generate file path for the spec (relative path)
      const file_path = `specs/${generateUniqueFilename(title, id)}`;

      // Create spec using CLI operation
      const spec = createNewSpec(req.project!.db, {
        id,
        uuid,
        title,
        file_path,
        content: content || "",
        priority: priority !== undefined ? priority : 2,
        parent_id: parent_id || undefined,
      });

      // Trigger export to JSONL files
      triggerExport(req.project!.db, req.project!.sudocodeDir);

      // Sync this specific spec to its markdown file (don't wait for it)
      syncEntityToMarkdown(
        req.project!.db,
        spec.id,
        "spec",
        req.project!.sudocodeDir
      ).catch((error) => {
        console.error(`Failed to sync spec ${spec.id} to markdown:`, error);
      });

      // Broadcast spec creation to WebSocket clients
      broadcastSpecUpdate(req.project!.id, spec.id, "created", spec);

      res.status(201).json({
        success: true,
        data: spec,
      });
    } catch (error) {
      console.error("Error creating spec:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create spec",
      });
    }
  });

  /**
   * PUT /api/specs/:id - Update an existing spec
   */
  router.put("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, content, priority, parent_id, archived } = req.body;

      // Validate that at least one field is provided
      if (
        title === undefined &&
        content === undefined &&
        priority === undefined &&
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
      if (priority !== undefined) updateInput.priority = priority;
      if (parent_id !== undefined) updateInput.parent_id = parent_id;
      if (archived !== undefined) {
        updateInput.archived = archived;
        updateInput.archived_at = archived ? new Date().toISOString() : null;
      }

      // Update spec using CLI operation
      const spec = updateExistingSpec(req.project!.db, id, updateInput);

      // If integration sync is enabled, export immediately so JSONL is updated before sync
      // Otherwise use debounced export
      if (req.project!.integrationSyncService) {
        // Execute export now to ensure JSONL is updated before integration sync
        await executeExportNow(req.project!.db, req.project!.sudocodeDir);

        // Sync to external integrations (for bidirectional/outbound sync)
        req
          .project!.integrationSyncService.syncEntity(spec.id)
          .catch((error) => {
            console.error(
              `Failed to sync spec ${spec.id} to external integrations:`,
              error
            );
          });
      } else {
        // Trigger debounced export when no integration sync is needed
        triggerExport(req.project!.db, req.project!.sudocodeDir);
      }

      // Sync this specific spec to its markdown file (don't wait for it)
      syncEntityToMarkdown(
        req.project!.db,
        spec.id,
        "spec",
        req.project!.sudocodeDir
      ).catch((error) => {
        console.error(`Failed to sync spec ${spec.id} to markdown:`, error);
      });

      // Broadcast spec update to WebSocket clients
      broadcastSpecUpdate(req.project!.id, spec.id, "updated", spec);

      res.json({
        success: true,
        data: spec,
      });
    } catch (error) {
      console.error("Error updating spec:", error);

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
        message: "Failed to update spec",
      });
    }
  });

  /**
   * DELETE /api/specs/:id - Delete a spec
   */
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check if spec exists first
      const existingSpec = getSpecById(req.project!.db, id);
      if (!existingSpec) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Spec not found: ${id}`,
        });
        return;
      }

      // Save file_path before deletion
      const markdownPath = existingSpec.file_path
        ? path.join(req.project!.sudocodeDir, existingSpec.file_path)
        : null;

      // Save external links before deletion (for outbound sync)
      const specFromJsonl = getSpecFromJsonl(req.project!.sudocodeDir, id);
      const externalLinks = specFromJsonl?.external_links || [];

      // Delete spec using CLI operation
      const deleted = deleteExistingSpec(req.project!.db, id);

      if (deleted) {
        // Delete markdown file if it exists
        if (markdownPath && fs.existsSync(markdownPath)) {
          try {
            fs.unlinkSync(markdownPath);
          } catch (err) {
            console.warn(
              `Failed to delete markdown file: ${markdownPath}`,
              err
            );
          }
        }

        // Trigger export to JSONL files
        triggerExport(req.project!.db, req.project!.sudocodeDir);

        // Propagate deletion to external systems (if any links exist)
        if (externalLinks.length > 0 && req.project!.integrationSyncService) {
          req
            .project!.integrationSyncService.handleEntityDeleted(
              id,
              externalLinks
            )
            .catch((error) => {
              console.error(
                `[specs] Failed to propagate deletion to external systems:`,
                error
              );
            });
        }

        // Broadcast spec deletion to WebSocket clients
        broadcastSpecUpdate(req.project!.id, id, "deleted", { id });

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
          message: "Failed to delete spec",
        });
      }
    } catch (error) {
      console.error("Error deleting spec:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete spec",
      });
    }
  });

  /**
   * POST /api/specs/:id/refresh_from_external - Refresh a spec from its external source
   *
   * Query params:
   * - force=true: Skip conflict check, overwrite local changes
   *
   * Response:
   * - updated: boolean - Whether the entity was updated
   * - hasLocalChanges: boolean - Whether local changes were detected
   * - changes?: Array<{field, localValue, remoteValue}> - Field-level changes (when hasLocalChanges=true)
   * - entity?: Spec - The updated entity (when updated=true)
   */
  router.post("/:id/refresh_from_external", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const force = req.query.force === "true";

      // Check if spec exists
      const existingSpec = getSpecById(req.project!.db, id);
      if (!existingSpec) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Spec not found: ${id}`,
        });
        return;
      }

      // Refresh from external source
      const result = await refreshSpec(
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
          "spec",
          req.project!.sudocodeDir
        ).catch((error) => {
          console.error(`Failed to sync spec ${id} to markdown:`, error);
        });

        // Broadcast spec update to WebSocket clients
        broadcastSpecUpdate(req.project!.id, id, "updated", result.entity);

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
      console.error("Error refreshing spec:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to refresh spec",
      });
    }
  });

  return router;
}
