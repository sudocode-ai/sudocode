/**
 * Sessions API routes (mapped to /api/sessions)
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  getAllSessions,
  getSessionById,
  getSessionByClaudeSessionId,
  createNewSession,
  updateExistingSession,
  deleteExistingSession,
} from "../services/sessions.js";
import { generateSessionId } from "@sudocode-ai/cli/dist/id-generator.js";
import { getSudocodeDir } from "../utils/sudocode-dir.js";

export function createSessionsRouter(db: Database.Database): Router {
  const router = Router();

  /**
   * GET /api/sessions - List all sessions
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      // Parse query parameters for filtering
      const options: any = {};

      if (req.query.agent_type) {
        options.agent_type = req.query.agent_type as string;
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

      const sessions = getAllSessions(db, options);

      res.json({
        success: true,
        data: sessions,
      });
    } catch (error) {
      console.error("Error listing sessions:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list sessions",
      });
    }
  });

  /**
   * GET /api/sessions/:id - Get a specific session by ID
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = getSessionById(db, id);

      if (!session) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Session not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: session,
      });
    } catch (error) {
      console.error("Error getting session:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get session",
      });
    }
  });

  /**
   * GET /api/sessions/by-session-id/:sessionId - Get a specific session by Claude session_id
   */
  router.get("/by-session-id/:sessionId", (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = getSessionByClaudeSessionId(db, sessionId);

      if (!session) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Session not found with session_id: ${sessionId}`,
        });
        return;
      }

      res.json({
        success: true,
        data: session,
      });
    } catch (error) {
      console.error("Error getting session by session_id:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get session",
      });
    }
  });

  /**
   * POST /api/sessions - Create a new session
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const { session_id, title, description, agent_type } = req.body;

      // Validate required fields
      if (!session_id || typeof session_id !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "session_id is required and must be a string",
        });
        return;
      }

      if (!title || typeof title !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "title is required and must be a string",
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

      if (!agent_type || !["claude-code", "codex"].includes(agent_type)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "agent_type is required and must be 'claude-code' or 'codex'",
        });
        return;
      }

      // Generate new session ID
      const outputDir = getSudocodeDir();
      const { id, uuid } = generateSessionId(db, outputDir);

      // Create session using CLI operation
      const session = createNewSession(db, {
        id,
        uuid,
        session_id,
        title,
        description: description || undefined,
        agent_type,
      });

      res.status(201).json({
        success: true,
        data: session,
      });
    } catch (error) {
      console.error("Error creating session:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for unique constraint violation
      if (errorMessage.includes("UNIQUE constraint failed")) {
        res.status(409).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Session with this session_id already exists",
        });
        return;
      }

      res.status(500).json({
        success: false,
        data: null,
        error_data: errorMessage,
        message: "Failed to create session",
      });
    }
  });

  /**
   * PUT /api/sessions/:id - Update an existing session
   */
  router.put("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, description, agent_type, archived } = req.body;

      // Validate title if provided
      if (title !== undefined && typeof title !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "title must be a string",
        });
        return;
      }

      if (title && title.length > 500) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Title must be 500 characters or less",
        });
        return;
      }

      // Validate agent_type if provided
      if (
        agent_type !== undefined &&
        !["claude-code", "codex"].includes(agent_type)
      ) {
        res.status(400).json({
          success: false,
          data: null,
          message: "agent_type must be 'claude-code' or 'codex'",
        });
        return;
      }

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (agent_type !== undefined) updateData.agent_type = agent_type;
      if (archived !== undefined) updateData.archived = archived;

      const session = updateExistingSession(db, id, updateData);

      res.json({
        success: true,
        data: session,
      });
    } catch (error) {
      console.error("Error updating session:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if session not found
      if (errorMessage.includes("not found")) {
        res.status(404).json({
          success: false,
          data: null,
          error_data: errorMessage,
          message: "Session not found",
        });
        return;
      }

      res.status(500).json({
        success: false,
        data: null,
        error_data: errorMessage,
        message: "Failed to update session",
      });
    }
  });

  /**
   * DELETE /api/sessions/:id - Delete a session
   */
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = deleteExistingSession(db, id);

      if (!deleted) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Session not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: { id },
        message: "Session deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete session",
      });
    }
  });

  return router;
}
