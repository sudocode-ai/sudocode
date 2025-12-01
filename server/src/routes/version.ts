import { Router, Request, Response } from "express";
import { getVersionInfo } from "../services/version-service.js";

export function createVersionRouter(): Router {
  const router = Router();

  // Version endpoint - returns versions of all packages
  router.get("/", (_req: Request, res: Response) => {
    try {
      const versions = getVersionInfo();
      res.status(200).json({
        success: true,
        data: versions,
      });
    } catch (error) {
      console.error("Failed to read version information:", error);
      res.status(500).json({
        success: false,
        data: null,
        message: "Failed to read version information",
      });
    }
  });

  return router;
}
