/**
 * Files API routes (mapped to /api)
 *
 * Provides REST API for file search operations.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import {
  fileSearchRegistry,
  GitLsFilesStrategy,
} from "../services/file-search/index.js";

// Register git-ls-files strategy as default on module load
const gitLsFilesStrategy = new GitLsFilesStrategy();
if (!fileSearchRegistry.has("git-ls-files")) {
  fileSearchRegistry.register("git-ls-files", gitLsFilesStrategy);
}

/**
 * Create files router
 *
 * Note: Project context is accessed via req.project
 * which is injected by the requireProject() middleware
 *
 * @returns Express router with file endpoints
 */
export function createFilesRouter(): Router {
  const router = Router();

  /**
   * GET /api/files/search
   *
   * Search for files in the project workspace
   *
   * Query parameters:
   * - q (required): Search query string
   * - limit (optional): Max results, default 20
   * - includeDirectories (optional): Include directories, default false
   *
   * Returns:
   * {
   *   success: true,
   *   data: {
   *     results: [
   *       {
   *         path: "src/components/AgentConfigPanel.tsx",
   *         name: "AgentConfigPanel.tsx",
   *         isFile: true,
   *         matchType: "prefix"
   *       }
   *     ]
   *   }
   * }
   */
  router.get("/search", async (req: Request, res: Response) => {
    try {
      const {
        q: query,
        limit = "20",
        includeDirectories = "false",
      } = req.query;

      // Validate required query parameter
      if (!query || typeof query !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: 'Query parameter "q" is required',
        });
        return;
      }

      // Get project workspace path
      const workspacePath = req.project!.path;

      // Get file search strategy (uses default if not specified)
      const strategy = fileSearchRegistry.get();

      // Search for files
      const results = await strategy.search(workspacePath, {
        query,
        limit: Number(limit),
        includeDirectories: includeDirectories === "true",
      });

      res.json({
        success: true,
        data: { results },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to search files:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to search files",
      });
    }
  });

  return router;
}
