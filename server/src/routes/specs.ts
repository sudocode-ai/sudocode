/**
 * Specs API routes (mapped to /api/specs)
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  getAllSpecs,
  getSpecById,
  createNewSpec,
  updateExistingSpec,
  deleteExistingSpec,
} from "../services/specs.js";
import { generateSpecId } from "@sudocode/cli/dist/id-generator.js";
import * as path from "path";

export function createSpecsRouter(db: Database.Database): Router {
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
      if (req.query.limit) {
        options.limit = parseInt(req.query.limit as string, 10);
      }
      if (req.query.offset) {
        options.offset = parseInt(req.query.offset as string, 10);
      }

      const specs = getAllSpecs(db, options);

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
      const spec = getSpecById(db, id);

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
      const outputDir = path.join(process.cwd(), ".sudocode");
      const id = generateSpecId(db, outputDir);

      // Generate file path for the spec
      const file_path = path.join(outputDir, "specs", `${id}.md`);

      // Create spec using CLI operation
      const spec = createNewSpec(db, {
        id,
        title,
        file_path,
        content: content || "",
        priority: priority !== undefined ? priority : 2,
        parent_id: parent_id || null,
      });

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
      const { title, content, priority, parent_id } = req.body;

      // Validate that at least one field is provided
      if (
        title === undefined &&
        content === undefined &&
        priority === undefined &&
        parent_id === undefined
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

      // Update spec using CLI operation
      const spec = updateExistingSpec(db, id, updateInput);

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
      const existingSpec = getSpecById(db, id);
      if (!existingSpec) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Spec not found: ${id}`,
        });
        return;
      }

      // Delete spec using CLI operation
      const deleted = deleteExistingSpec(db, id);

      if (deleted) {
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
