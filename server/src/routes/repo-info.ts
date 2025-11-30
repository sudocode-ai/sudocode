import { Router, Request, Response } from "express";
import {
  getRepositoryInfo,
  getRepositoryBranches,
} from "../services/repo-info.js";
import * as fs from "fs";
import * as path from "path";

export function createRepoInfoRouter(): Router {
  const router = Router();

  // Repository info endpoint - returns git repository information for current project
  router.get("/", async (req: Request, res: Response): Promise<void> => {
    try {
      const repoInfo = await getRepositoryInfo(req.project!.path);
      res.status(200).json({
        success: true,
        data: repoInfo,
      });
    } catch (error) {
      const err = error as Error;
      if (err.message === "Not a git repository") {
        res.status(404).json({
          success: false,
          data: null,
          message: err.message,
        });
      } else {
        console.error("Failed to get repository info:", error);
        res.status(500).json({
          success: false,
          data: null,
          message: "Failed to get repository info",
        });
      }
    }
  });

  // Repository branches endpoint - returns list of all local branches
  router.get(
    "/branches",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const branchInfo = await getRepositoryBranches(req.project!.path);
        res.status(200).json({
          success: true,
          data: branchInfo,
        });
      } catch (error) {
        const err = error as Error;
        if (err.message === "Not a git repository") {
          res.status(404).json({
            success: false,
            data: null,
            message: err.message,
          });
        } else {
          console.error("Failed to get repository branches:", error);
          res.status(500).json({
            success: false,
            data: null,
            message: "Failed to get repository branches",
          });
        }
      }
    }
  );

  // Worktrees endpoint - returns all worktrees that actually exist in .sudocode/worktrees/
  router.get("/worktrees", (req: Request, res: Response): void => {
    try {
      const db = req.project!.db;
      const repoPath = req.project!.path;
      const worktreesDir = path.join(repoPath, ".sudocode", "worktrees");

      // Check if worktrees directory exists
      if (!fs.existsSync(worktreesDir)) {
        res.json({
          success: true,
          data: [],
        });
        return;
      }

      // Read all directories in .sudocode/worktrees/
      const worktreeDirs = fs
        .readdirSync(worktreesDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      // For each worktree directory, try to find corresponding execution in database
      const worktrees = worktreeDirs
        .map((dirName) => {
          const worktreePath = path.join(worktreesDir, dirName);

          // Find execution by worktree_path
          const execution = db
            .prepare(
              `SELECT * FROM executions
                 WHERE worktree_path = ?
                 LIMIT 1`
            )
            .get(worktreePath);

          // If execution found, return it; otherwise return basic info
          if (execution) {
            return execution;
          } else {
            // Worktree exists but no execution record - return minimal info
            return {
              id: null,
              worktree_path: worktreePath,
              branch_name: dirName,
              status: "orphaned",
              created_at: null,
              updated_at: null,
            };
          }
        })
        .filter((wt) => wt !== null);

      res.json({
        success: true,
        data: worktrees,
      });
    } catch (error) {
      console.error("Error listing worktrees:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list worktrees",
      });
    }
  });

  return router;
}
