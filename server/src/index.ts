import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import type Database from "better-sqlite3";

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initDatabase, getDatabaseInfo } from "./services/db.js";
import { ExecutionLifecycleService } from "./services/execution-lifecycle.js";
// import {
//   ExecutionLogsCleanup,
//   DEFAULT_CLEANUP_CONFIG,
//   type CleanupConfig,
// } from "./services/execution-logs-cleanup.js";
import { WorktreeManager } from "./execution/worktree/manager.js";
import { getWorktreeConfig } from "./execution/worktree/config.js";
import { getRepositoryInfo } from "./services/repo-info.js";
import { createIssuesRouter } from "./routes/issues.js";
import { createSpecsRouter } from "./routes/specs.js";
import { createRelationshipsRouter } from "./routes/relationships.js";
import { createFeedbackRouter } from "./routes/feedback.js";
import { createExecutionsRouter } from "./routes/executions.js";
import { createExecutionStreamRoutes } from "./routes/executions-stream.js";
import { createProjectsRouter } from "./routes/projects.js";
import { TransportManager } from "./execution/transport/transport-manager.js";
import { ProjectRegistry } from "./services/project-registry.js";
import { ProjectManager } from "./services/project-manager.js";
import { requireProject } from "./middleware/project-context.js";
import {
  initWebSocketServer,
  getWebSocketStats,
  shutdownWebSocketServer,
  getWebSocketServer,
} from "./services/websocket.js";

// Load environment variables
dotenv.config();

const app = express();
const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 20;

// Falls back to current directory for development/testing
const SUDOCODE_DIR =
  process.env.SUDOCODE_DIR || path.join(process.cwd(), ".sudocode");
const DB_PATH = path.join(SUDOCODE_DIR, "cache.db");
// TODO: Include sudocode install package for serving static files.

// Derive repo root from SUDOCODE_DIR (which is <repo>/.sudocode)
// This ensures consistency across database and execution paths
const REPO_ROOT = path.dirname(SUDOCODE_DIR);

// Initialize database and transport manager
let db!: Database.Database;
let transportManager!: TransportManager;
// let logsCleanup: ExecutionLogsCleanup | null = null;

// Multi-project infrastructure
let projectRegistry!: ProjectRegistry;
let projectManager!: ProjectManager;

// Start file watcher (enabled by default, disable with WATCH=false)
const WATCH_ENABLED = process.env.WATCH !== "false";

// Async initialization function
async function initialize() {
  try {
    console.log(`Initializing database at: ${DB_PATH}`);
    db = initDatabase({ path: DB_PATH });
    const info = getDatabaseInfo(db);
    console.log(`Database initialized with ${info.tables.length} tables`);
    if (!info.hasCliTables) {
      // TODO: Automatically import and sync.
      console.warn(
        "Warning: CLI tables not found. Run 'sudocode sync' to initialize the database."
      );
    }

    // Initialize ProjectRegistry and ProjectManager for multi-project support
    projectRegistry = new ProjectRegistry();
    await projectRegistry.load();
    console.log(
      `ProjectRegistry loaded from: ${projectRegistry.getConfigPath()}`
    );

    projectManager = new ProjectManager(projectRegistry, {
      watchEnabled: WATCH_ENABLED,
    });

    // Auto-open the current project (REPO_ROOT) for backward compatibility
    console.log(`Opening default project at: ${REPO_ROOT}`);
    const openResult = await projectManager.openProject(REPO_ROOT);
    if (!openResult.ok) {
      const errorMsg =
        "message" in openResult.error!
          ? openResult.error!.message
          : `${openResult.error!.type}`;
      throw new Error(`Failed to open default project: ${errorMsg}`);
    }
    // Default project opened successfully

    // Initialize transport manager for SSE streaming
    transportManager = new TransportManager();
    console.log("Transport manager initialized");

    // Note: ExecutionLogsStore is now initialized per-project in ProjectManager

    // Initialize execution logs cleanup service
    // TODO: Enable auto-cleanup config via .sudocode/config.json
    // const cleanupConfig: CleanupConfig = {
    //   enabled: process.env.CLEANUP_ENABLED !== "false",
    //   intervalMs: parseInt(
    //     process.env.CLEANUP_INTERVAL_MS ||
    //       String(DEFAULT_CLEANUP_CONFIG.intervalMs),
    //     10
    //   ),
    //   retentionMs: parseInt(
    //     process.env.CLEANUP_RETENTION_MS ||
    //       String(DEFAULT_CLEANUP_CONFIG.retentionMs),
    //     10
    //   ),
    // };
    // logsCleanup = new ExecutionLogsCleanup(logsStore, cleanupConfig);
    // logsCleanup.start();

    // Cleanup orphaned worktrees on startup (if configured)
    const worktreeConfig = getWorktreeConfig(REPO_ROOT);
    if (worktreeConfig.cleanupOrphanedWorktreesOnStartup) {
      try {
        // TODO: Log if there are worktrees to cleanup
        const worktreeManager = new WorktreeManager(worktreeConfig);
        const lifecycleService = new ExecutionLifecycleService(
          db,
          REPO_ROOT,
          worktreeManager
        );
        console.log("Cleaning up orphaned worktrees...");
        await lifecycleService.cleanupOrphanedWorktrees();
        console.log("Orphaned worktree cleanup complete");
      } catch (error) {
        console.error("Failed to cleanup orphaned worktrees:", error);
        // Don't exit - this is best-effort cleanup
      }
    }
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }
}

// Run initialization
await initialize();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes

// Project management routes (no project context required)
app.use("/api/projects", createProjectsRouter(projectManager, projectRegistry));

// Entity routes (require project context via X-Project-ID header)
app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
app.use("/api/specs", requireProject(projectManager), createSpecsRouter());
app.use(
  "/api/relationships",
  requireProject(projectManager),
  createRelationshipsRouter()
);
app.use(
  "/api/feedback",
  requireProject(projectManager),
  createFeedbackRouter()
);

// Mount execution routes (must be before stream routes to avoid conflicts)
app.use("/api", requireProject(projectManager), createExecutionsRouter());
app.use(
  "/api/executions",
  requireProject(projectManager),
  createExecutionStreamRoutes()
);

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  const dbInfo = getDatabaseInfo(db);
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      path: DB_PATH,
      tables: dbInfo.tables.length,
      hasCliTables: dbInfo.hasCliTables,
    },
  });
});

// Version endpoint - returns versions of all packages
app.get("/api/version", (_req: Request, res: Response) => {
  try {
    // Read package.json files - going up from server/dist to project root
    const projectRoot = path.join(__dirname, "../..");
    const cliPackagePath = path.join(projectRoot, "cli/package.json");
    const serverPackagePath = path.join(projectRoot, "server/package.json");
    const frontendPackagePath = path.join(projectRoot, "frontend/package.json");

    const cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf-8"));
    const serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf-8"));
    const frontendPackage = JSON.parse(
      readFileSync(frontendPackagePath, "utf-8")
    );

    res.status(200).json({
      success: true,
      data: {
        cli: cliPackage.version,
        server: serverPackage.version,
        frontend: frontendPackage.version,
      },
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

// Config endpoint - returns sudocode configuration
app.get("/api/config", (_req: Request, res: Response) => {
  try {
    const configPath = path.join(SUDOCODE_DIR, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    res.status(200).json(config);
  } catch (error) {
    console.error("Failed to read config:", error);
    res.status(500).json({ error: "Failed to read config" });
  }
});

// Repository info endpoint - returns git repository information for current project
app.get(
  "/api/repo-info",
  requireProject(projectManager),
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

// WebSocket stats endpoint
app.get("/ws/stats", (_req: Request, res: Response) => {
  const stats = getWebSocketStats();
  res.status(200).json(stats);
});

// Serve static frontend
// In development: ../../frontend/dist (workspace)
// In production: ./public (bundled with server package in dist/public)
const isDev =
  process.env.NODE_ENV !== "production" &&
  existsSync(path.join(__dirname, "../../frontend/dist"));
const frontendPath = isDev
  ? path.join(__dirname, "../../frontend/dist")
  : path.join(__dirname, "public");
console.log(`[server] Serving static frontend from: ${frontendPath}`);

// Serve static files
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for all non-API/non-WS routes
app.get("*", (req: Request, res: Response) => {
  // Skip API and WebSocket routes
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/ws") ||
    req.path.startsWith("/health")
  ) {
    res.status(404).json({ error: "Not found" });
  } else {
    res.sendFile(path.join(frontendPath, "index.html"));
  }
});

// Create HTTP server
const server = http.createServer(app);

/**
 * Attempts to start the server (HTTP + WebSocket) on the given port, incrementing if unavailable.
 * Only scans for ports if no explicit PORT was provided.
 * Both HTTP and WebSocket must successfully initialize on the same port.
 */
async function startServer(
  initialPort: number,
  maxAttempts: number
): Promise<number> {
  const explicitPort = process.env.PORT;
  const shouldScan = !explicitPort;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = initialPort + attempt;
    let httpStarted = false;

    try {
      // First, try to bind the HTTP server
      await new Promise<void>((resolve, reject) => {
        const errorHandler = (err: NodeJS.ErrnoException) => {
          server.removeListener("error", errorHandler);
          server.removeListener("listening", listeningHandler);
          reject(err);
        };

        const listeningHandler = () => {
          server.removeListener("error", errorHandler);
          resolve();
        };

        server.once("error", errorHandler);
        server.once("listening", listeningHandler);
        server.listen(port);
      });

      httpStarted = true;
      console.log(`[server] HTTP server bound to port ${port}`);

      // Now try to initialize WebSocket on the same server
      console.log(`[server] Initializing WebSocket server on port ${port}...`);
      initWebSocketServer(server, "/ws");

      // Verify WebSocket server is accessible
      const wss = getWebSocketServer();
      if (!wss) {
        throw new Error(
          "WebSocket server failed to initialize - server instance is null"
        );
      }

      console.log(
        `[server] WebSocket server successfully initialized on port ${port}`
      );

      // Both HTTP and WebSocket succeeded! Return the port
      return port;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      // Clean up if we partially started
      if (httpStarted) {
        console.log(`[server] Cleaning up HTTP server on port ${port}...`);
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }

      // Clean up WebSocket if it was partially initialized
      const wss = getWebSocketServer();
      if (wss) {
        console.log(`[server] Cleaning up WebSocket server on port ${port}...`);
        await shutdownWebSocketServer();
      }

      // Determine if we should retry
      const isPortConflict =
        error.code === "EADDRINUSE" ||
        (error.message && error.message.includes("address already in use"));

      if (
        isPortConflict ||
        (httpStarted && error.message?.includes("WebSocket"))
      ) {
        if (!shouldScan) {
          // Explicit port was specified and it's in use - fail immediately
          throw new Error(
            `Port ${port} is already in use or WebSocket initialization failed. Please specify a different PORT.`
          );
        }

        // Port is in use or WebSocket failed, try next one if we have attempts left
        if (attempt < maxAttempts - 1) {
          const reason = httpStarted
            ? "WebSocket initialization failed"
            : "port is already in use";
          console.log(`[server] Port ${port} ${reason}, trying ${port + 1}...`);
          continue;
        } else {
          throw new Error(
            `Could not find an available port after ${maxAttempts} attempts (${initialPort}-${port})`
          );
        }
      } else {
        // Some other error - fail immediately
        console.error(
          `[server] Unexpected error on port ${port}:`,
          error.message
        );
        throw error;
      }
    }
  }

  throw new Error(`Could not start server after ${maxAttempts} attempts`);
}

// Start listening with port scanning (includes both HTTP and WebSocket)
const startPort = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : DEFAULT_PORT;
const actualPort = await startServer(startPort, MAX_PORT_ATTEMPTS);

// Format URLs as clickable links with color
const httpUrl = `http://localhost:${actualPort}`;
const wsUrl = `ws://localhost:${actualPort}/ws`;

// ANSI escape codes for green color and clickable links
const green = "\u001b[32m";
const bold = "\u001b[1m";
const reset = "\u001b[0m";
const makeClickable = (url: string, text: string) =>
  `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;

// ASCII art banner (split-line version for narrower terminals)
console.log(`\n${green}${bold}`);
console.log(" ███████╗ ██╗   ██╗ ██████╗   ██████╗ ");
console.log(" ██╔════╝ ██║   ██║ ██╔══██╗ ██╔═══██╗");
console.log(" ███████╗ ██║   ██║ ██║  ██║ ██║   ██║");
console.log(" ╚════██║ ██║   ██║ ██║  ██║ ██║   ██║");
console.log(" ███████║ ╚██████╔╝ ██████╔╝ ╚██████╔╝");
console.log(" ╚══════╝  ╚═════╝  ╚═════╝   ╚═════╝ ");
console.log("  ██████╗  ██████╗  ██████╗  ███████╗");
console.log(" ██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝");
console.log(" ██║      ██║   ██║ ██║  ██║ █████╗  ");
console.log(" ██║      ██║   ██║ ██║  ██║ ██╔══╝  ");
console.log(" ╚██████╗ ╚██████╔╝ ██████╔╝ ███████╗");
console.log(` ╚═════╝  ╚═════╝  ╚═════╝  ╚══════╝${reset}\n`);

console.log(
  `${bold}${green}sudocode local server running on: ${makeClickable(
    httpUrl,
    httpUrl
  )}${reset}`
);
console.log(`WebSocket server available at: ${makeClickable(wsUrl, wsUrl)}`);

// Error handlers for debugging
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  console.error("Stack trace:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise);
  console.error("Reason:", reason);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");

  // Stop logs cleanup service
  // TODO: Re-enable when logs cleanup is supported
  // if (logsCleanup) {
  //   logsCleanup.stop();
  // }

  // Shutdown ProjectManager (closes all projects and their watchers)
  // This will shutdown all per-project ExecutionServices
  if (projectManager) {
    await projectManager.shutdown();
  }

  // Shutdown WebSocket server
  await shutdownWebSocketServer();

  // Shutdown transport manager
  if (transportManager) {
    transportManager.shutdown();
    console.log("Transport manager shutdown complete");
  }

  // Close database
  db.close();

  // Close HTTP server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error("Shutdown timeout - forcing exit");
    process.exit(1);
  }, 10000);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down server...");

  // Stop logs cleanup service
  // TODO: Re-enable when logs cleanup is supported
  // if (logsCleanup) {
  //   logsCleanup.stop();
  // }

  // Shutdown ProjectManager (closes all projects and their watchers)
  // This will shutdown all per-project ExecutionServices
  if (projectManager) {
    await projectManager.shutdown();
  }

  // Shutdown WebSocket server
  await shutdownWebSocketServer();

  // Shutdown transport manager
  if (transportManager) {
    transportManager.shutdown();
    console.log("Transport manager shutdown complete");
  }

  // Close database
  db.close();

  // Close HTTP server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
export { db, transportManager };
