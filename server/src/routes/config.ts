import { Router, Request, Response } from "express";
import { existsSync, readFileSync } from "fs";
import * as path from "path";

export function createConfigRouter(): Router {
  const router = Router();

  // Config endpoint - returns sudocode configuration for a specific project
  router.get("/", (req: Request, res: Response) => {
    try {
      const configPath = path.join(req.project!.sudocodeDir, "config.json");
      if (!existsSync(configPath)) {
        // Return empty config if file doesn't exist
        res.status(200).json({});
        return;
      }
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      res.status(200).json(config);
    } catch (error) {
      console.error("Failed to read config:", error);
      res.status(500).json({ error: "Failed to read config" });
    }
  });

  return router;
}
