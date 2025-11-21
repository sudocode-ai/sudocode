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
import { broadcastSpecUpdate } from "../services/websocket.js";
import { triggerExport, syncEntityToMarkdown } from "../services/export.js";
import * as path from "path";

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

      // Generate file path for the spec
      const file_path = path.join(outputDir, "specs", `${id}.md`);

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
      syncEntityToMarkdown(req.project!.db, spec.id, "spec", req.project!.sudocodeDir).catch((error) => {
        console.error(`Failed to sync spec ${spec.id} to markdown:`, error);
      });

      // Broadcast spec creation to WebSocket clients
      broadcastSpecUpdate(spec.id, "created", spec);

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
  router.put("/:id", (req: Request, res: Response) => {
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

      // Trigger export to JSONL files
      triggerExport(req.project!.db, req.project!.sudocodeDir);

      // Sync this specific spec to its markdown file (don't wait for it)
      syncEntityToMarkdown(req.project!.db, spec.id, "spec", req.project!.sudocodeDir).catch((error) => {
        console.error(`Failed to sync spec ${spec.id} to markdown:`, error);
      });

      // Broadcast spec update to WebSocket clients
      broadcastSpecUpdate(spec.id, "updated", spec);

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
  router.delete("/:id", (req: Request, res: Response) => {
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

      // Delete spec using CLI operation
      const deleted = deleteExistingSpec(req.project!.db, id);

      if (deleted) {
        // Trigger export to JSONL files
        triggerExport(req.project!.db, req.project!.sudocodeDir);

        // Broadcast spec deletion to WebSocket clients
        broadcastSpecUpdate(id, "deleted", { id });

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

  return router;
}
