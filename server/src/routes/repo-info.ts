import { Router, Request, Response } from "express";
import { getRepositoryInfo } from "../services/repo-info.js";

export function createRepoInfoRouter(): Router {
  const router = Router();

  // Repository info endpoint - returns git repository information for current project
  router.get(
    "/",
    async (req: Request, res: Response): Promise<void> => {
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
    }
  );

  return router;
}
