/**
 * Editors API routes (mapped to /api)
 *
 * Provides REST API for IDE/editor integration.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { EditorService } from "../services/editor-service.js";
import { EditorOpenError, EditorType } from "../types/editor.js";

/**
 * Create editors router
 *
 * @returns Express router with editor endpoints
 */
export function createEditorsRouter(): Router {
  const router = Router();

  /**
   * POST /api/open-in-ide
   *
   * Open a worktree path in configured IDE
   *
   * Request body:
   * - worktreePath: string - Path to the worktree to open
   * - editorType?: string - Optional editor type override
   *
   * Response:
   * - success: boolean
   * - message?: string
   * - error?: { code: string, details: string }
   */
  router.post("/open-in-ide", async (req: Request, res: Response) => {
    try {
      const { worktreePath, editorType } = req.body || {};

      // Validate worktree path
      if (!worktreePath) {
        res.status(400).json({
          success: false,
          message: "worktreePath is required",
          error: {
            code: "MISSING_WORKTREE_PATH",
            details: "Request body must include worktreePath",
          },
        });
        return;
      }

      // Create EditorService instance
      const editorService = new EditorService(req.project!.path);

      // Open worktree in IDE (with optional editor type override)
      const editorTypeOverride = editorType
        ? (editorType as EditorType)
        : undefined;

      await editorService.openWorktree(worktreePath, editorTypeOverride);

      res.json({
        success: true,
        message: "Opening worktree in IDE...",
      });
    } catch (error) {
      console.error(`Failed to open worktree in IDE:`, error);

      // Handle EditorOpenError with specific error codes and HTTP status mapping
      if (error instanceof EditorOpenError) {
        let statusCode = 500;

        switch (error.code) {
          case "EDITOR_NOT_FOUND":
            statusCode = 404;
            break;
          case "WORKTREE_MISSING":
            statusCode = 400;
            break;
          case "SPAWN_FAILED":
            statusCode = 500;
            break;
        }

        res.status(statusCode).json({
          success: false,
          message: error.message,
          error: {
            code: error.code,
            details: error.details || "",
          },
        });
        return;
      }

      // Generic error handling
      res.status(500).json({
        success: false,
        message: "Failed to open worktree in IDE",
        error: {
          code: "INTERNAL_ERROR",
          details: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  return router;
}
