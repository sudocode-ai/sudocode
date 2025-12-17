/**
 * Feedback API routes (mapped to /api/feedback)
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import type { FeedbackType, FeedbackAnchor } from "@sudocode-ai/types";
import {
  createNewFeedback,
  getFeedbackById,
  updateExistingFeedback,
  deleteExistingFeedback,
  getAllFeedback,
} from "../services/feedback.js";
import { broadcastFeedbackUpdate } from "../services/websocket.js";

export function createFeedbackRouter(): Router {
  const router = Router();

  /**
   * GET /api/feedback - List all feedback with optional filters
   * Query params: to_id, from_id, feedback_type, dismissed, limit, offset
   * Legacy params: spec_id (maps to to_id), issue_id (maps to from_id)
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      const options: any = {};

      // Support both new and legacy parameter names
      if (req.query.to_id || req.query.spec_id) {
        options.to_id = (req.query.to_id || req.query.spec_id) as string;
      }
      if (req.query.from_id || req.query.issue_id) {
        options.from_id = (req.query.from_id || req.query.issue_id) as string;
      }
      if (req.query.feedback_type) {
        options.feedback_type = req.query.feedback_type as FeedbackType;
      }
      if (req.query.dismissed !== undefined) {
        options.dismissed = req.query.dismissed === "true";
      }
      if (req.query.limit) {
        options.limit = parseInt(req.query.limit as string, 10);
      }
      if (req.query.offset) {
        options.offset = parseInt(req.query.offset as string, 10);
      }

      const feedback = getAllFeedback(req.project!.db, options);

      res.json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      console.error("Error listing feedback:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list feedback",
      });
    }
  });

  /**
   * GET /api/feedback/:id - Get a specific feedback entry
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const feedback = getFeedbackById(req.project!.db, id);

      if (!feedback) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Feedback not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      console.error("Error getting feedback:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get feedback",
      });
    }
  });

  /**
   * POST /api/feedback - Create a new feedback entry
   * Supports both new fields (from_id, to_id) and legacy fields (issue_id, spec_id)
   * from_id is optional for anonymous feedback
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const {
        from_id,
        to_id,
        issue_id,  // legacy
        spec_id,   // legacy
        feedback_type,
        content,
        agent,
        anchor,
        dismissed,
      } = req.body;

      // Support both new and legacy field names
      const fromId = from_id || issue_id;
      const toId = to_id || spec_id;

      // Validate from_id if provided (must be string if not null/undefined)
      if (fromId !== undefined && fromId !== null && typeof fromId !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "from_id (or issue_id) must be a string if provided",
        });
        return;
      }

      if (!toId || typeof toId !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "to_id (or spec_id) is required and must be a string",
        });
        return;
      }

      if (!feedback_type || typeof feedback_type !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "feedback_type is required and must be a string",
        });
        return;
      }

      // Validate feedback_type
      const validTypes = ["comment", "suggestion", "request"];
      if (!validTypes.includes(feedback_type)) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Invalid feedback_type. Must be one of: ${validTypes.join(", ")}`,
        });
        return;
      }

      if (!content || typeof content !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "content is required and must be a string",
        });
        return;
      }

      // Validate anchor if provided
      if (anchor !== undefined && anchor !== null) {
        if (typeof anchor !== "object") {
          res.status(400).json({
            success: false,
            data: null,
            message: "anchor must be an object if provided",
          });
          return;
        }

        // Validate anchor structure if provided
        if (anchor.anchor_status) {
          const validAnchorStatuses = ["valid", "relocated", "stale"];
          if (!validAnchorStatuses.includes(anchor.anchor_status)) {
            res.status(400).json({
              success: false,
              data: null,
              message: `Invalid anchor.anchor_status. Must be one of: ${validAnchorStatuses.join(", ")}`,
            });
            return;
          }
        }
      }

      // Create feedback using CLI operation
      const feedback = createNewFeedback(req.project!.db, {
        from_id: fromId || undefined,  // Can be undefined for anonymous feedback
        to_id: toId,
        feedback_type: feedback_type as FeedbackType,
        content,
        agent: agent || undefined,
        anchor: anchor as FeedbackAnchor | undefined,
        dismissed: dismissed || false,
      });

      // Broadcast feedback creation to WebSocket clients
      broadcastFeedbackUpdate(req.project!.id, "created", feedback);

      res.status(201).json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      console.error("Error creating feedback:", error);

      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            data: null,
            message: error.message,
          });
          return;
        }

        if (error.message.includes("Constraint violation")) {
          res.status(409).json({
            success: false,
            data: null,
            message: error.message,
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create feedback",
      });
    }
  });

  /**
   * PUT /api/feedback/:id - Update an existing feedback entry
   */
  router.put("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { content, dismissed, anchor } = req.body;

      // Validate that at least one field is provided
      if (
        content === undefined &&
        dismissed === undefined &&
        anchor === undefined
      ) {
        res.status(400).json({
          success: false,
          data: null,
          message: "At least one field must be provided for update",
        });
        return;
      }

      // Validate anchor if provided
      if (anchor !== undefined) {
        if (typeof anchor !== "object") {
          res.status(400).json({
            success: false,
            data: null,
            message: "anchor must be an object",
          });
          return;
        }

        if (!anchor.anchor_status || typeof anchor.anchor_status !== "string") {
          res.status(400).json({
            success: false,
            data: null,
            message: "anchor.anchor_status is required and must be a string",
          });
          return;
        }

        const validAnchorStatuses = ["valid", "relocated", "stale"];
        if (!validAnchorStatuses.includes(anchor.anchor_status)) {
          res.status(400).json({
            success: false,
            data: null,
            message: `Invalid anchor.anchor_status. Must be one of: ${validAnchorStatuses.join(", ")}`,
          });
          return;
        }
      }

      // Build update input
      const updateInput: any = {};
      if (content !== undefined) updateInput.content = content;
      if (dismissed !== undefined) updateInput.dismissed = dismissed;
      if (anchor !== undefined) updateInput.anchor = anchor as FeedbackAnchor;

      // Update feedback using CLI operation
      const feedback = updateExistingFeedback(req.project!.db, id, updateInput);

      // Broadcast feedback update to WebSocket clients
      broadcastFeedbackUpdate(req.project!.id, "updated", feedback);

      res.json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      console.error("Error updating feedback:", error);

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
        message: "Failed to update feedback",
      });
    }
  });

  /**
   * DELETE /api/feedback/:id - Delete a feedback entry
   */
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check if feedback exists first
      const existingFeedback = getFeedbackById(req.project!.db, id);
      if (!existingFeedback) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Feedback not found: ${id}`,
        });
        return;
      }

      // Delete feedback using CLI operation
      const deleted = deleteExistingFeedback(req.project!.db, id);

      if (deleted) {
        // Broadcast feedback deletion to WebSocket clients
        broadcastFeedbackUpdate(req.project!.id, "deleted", { id });

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
          message: "Failed to delete feedback",
        });
      }
    } catch (error) {
      console.error("Error deleting feedback:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete feedback",
      });
    }
  });

  return router;
}
