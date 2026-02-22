import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import { execSync } from "child_process";
import {
  checkForUpdates,
  dismissUpdate,
  isOlderVersion,
} from "@sudocode-ai/cli/update-checker";
import {
  detectInstallSource,
} from "@sudocode-ai/cli/install-source";

// Reference to the HTTP server - set via setServerInstance
let serverInstance: import("http").Server | null = null;

/**
 * Set the HTTP server instance for restart functionality
 */
export function setServerInstance(server: import("http").Server): void {
  serverInstance = server;
}

interface UpdateCheckResponse {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface UpdateInstallResponse {
  success: boolean;
  message: string;
  requiresRestart?: boolean;
}

/**
 * Detect which package is installed (metapackage or CLI)
 */
function detectInstalledPackage(): string {
  try {
    // Check if sudocode metapackage is installed
    execSync("npm list -g sudocode --depth=0", { stdio: "pipe" });
    return "sudocode";
  } catch {
    // Fall back to CLI package
    return "@sudocode-ai/cli";
  }
}

export function createUpdateRouter(): Router {
  const router = Router();

  /**
   * GET /api/update/check
   * Check for available updates
   */
  router.get("/check", async (_req: Request, res: Response) => {
    try {
      const updateInfo = await checkForUpdates();

      if (!updateInfo) {
        // Failed to check for updates (network error, etc.)
        res.status(200).json({
          success: true,
          data: {
            current: "unknown",
            latest: "unknown",
            updateAvailable: false,
          } as UpdateCheckResponse,
        });
        return;
      }

      // Only show update available if latest is actually newer
      const actuallyNewer = isOlderVersion(updateInfo.current, updateInfo.latest);

      res.status(200).json({
        success: true,
        data: {
          current: updateInfo.current,
          latest: updateInfo.latest,
          updateAvailable: actuallyNewer,
        } as UpdateCheckResponse,
      });
    } catch (error) {
      console.error("Failed to check for updates:", error);
      res.status(500).json({
        success: false,
        error: "Failed to check for updates",
      });
    }
  });

  /**
   * POST /api/update/install
   * Install the latest version
   */
  router.post("/install", async (_req: Request, res: Response) => {
    try {
      const source = detectInstallSource();

      // Binary install: not supported via server API
      // (CLI handles binary updates directly; the server binary would need to replace itself)
      if (source === "binary") {
        const isWindows = process.platform === "win32";
        res.status(400).json({
          success: false,
          error: isWindows
            ? "Self-update is not supported on Windows. Please reinstall manually."
            : "Binary updates must be run from the CLI: sudocode update",
          installSource: "binary",
        });
        return;
      }

      // npm/Volta install: existing flow
      const packageToUpdate = detectInstalledPackage();
      console.log(`[update] Installing ${packageToUpdate}...`);

      try {
        // First attempt without --force
        execSync(`npm install -g ${packageToUpdate}@latest`, {
          stdio: "pipe",
          timeout: 120000, // 2 minute timeout
        });
      } catch (firstError) {
        // Check if it's an EEXIST error, retry with --force
        const errorMessage =
          firstError instanceof Error ? firstError.message : String(firstError);
        if (errorMessage.includes("EEXIST")) {
          console.log("[update] EEXIST error, retrying with --force...");
          execSync(`npm install -g ${packageToUpdate}@latest --force`, {
            stdio: "pipe",
            timeout: 120000,
          });
        } else {
          throw firstError;
        }
      }

      console.log(`[update] Successfully installed ${packageToUpdate}`);

      res.status(200).json({
        success: true,
        data: {
          success: true,
          message: `Successfully updated ${packageToUpdate}. Please restart the server to use the new version.`,
          requiresRestart: true,
        } as UpdateInstallResponse,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[update] Failed to install update:", errorMessage);

      res.status(500).json({
        success: false,
        error: `Failed to install update: ${errorMessage}`,
        manualCommand: "npm install -g sudocode@latest",
      });
    }
  });

  /**
   * POST /api/update/dismiss
   * Dismiss update notification for 30 days
   */
  router.post("/dismiss", async (req: Request, res: Response) => {
    try {
      const { version } = req.body as { version?: string };

      if (!version) {
        res.status(400).json({
          success: false,
          error: "Version is required",
        });
        return;
      }

      dismissUpdate(version);

      res.status(200).json({
        success: true,
        data: {
          message: `Update notification dismissed for version ${version}`,
        },
      });
    } catch (error) {
      console.error("Failed to dismiss update:", error);
      res.status(500).json({
        success: false,
        error: "Failed to dismiss update notification",
      });
    }
  });

  /**
   * POST /api/update/restart
   * Restart the server by spawning a new process
   */
  router.post("/restart", async (_req: Request, res: Response) => {
    try {
      console.log("[update] Server restart requested");

      // Send response first
      res.status(200).json({
        success: true,
        data: {
          message: "Server is restarting...",
        },
      });

      // Small delay to ensure response is sent
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Close the HTTP server to release the port
      if (serverInstance) {
        console.log("[update] Closing HTTP server to release port...");
        await new Promise<void>((resolve) => {
          serverInstance!.close(() => {
            console.log("[update] HTTP server closed");
            resolve();
          });
        });
      }

      // Small delay to ensure port is fully released
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Spawn new server process with same arguments
      console.log("[update] Spawning new server process...");
      const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: "inherit",
        cwd: process.cwd(),
        env: process.env,
      });

      child.unref();

      // Exit current process
      console.log("[update] Exiting current process...");
      process.exit(0);
    } catch (error) {
      console.error("Failed to restart server:", error);
      // Response may have already been sent
    }
  });

  return router;
}
