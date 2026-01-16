import express, { Request, Response } from "express";
import cors from "cors";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import getPort from "get-port";

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createIssuesRouter } from "./routes/issues.js";
import { createSpecsRouter } from "./routes/specs.js";
import { createRelationshipsRouter } from "./routes/relationships.js";
import { createFeedbackRouter } from "./routes/feedback.js";
import { createExecutionsRouter } from "./routes/executions.js";
import { createEditorsRouter } from "./routes/editors.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createConfigRouter } from "./routes/config.js";
import { createPluginsRouter } from "./routes/plugins.js";
import { createImportRouter } from "./routes/import.js";
import { createFilesRouter } from "./routes/files.js";
import { createRepoInfoRouter } from "./routes/repo-info.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createVersionRouter } from "./routes/version.js";
import { createUpdateRouter, setServerInstance } from "./routes/update.js";
import { createWorkflowsRouter } from "./routes/workflows.js";
import { createVoiceRouter } from "./routes/voice.js";
import {
  createMacroAgentRouter,
  createExecutionMacroRouter,
} from "./routes/macro-agent.js";
import { ProjectRegistry } from "./services/project-registry.js";
import { ProjectManager } from "./services/project-manager.js";
import { requireProject } from "./middleware/project-context.js";
import {
  initWebSocketServer,
  getWebSocketStats,
  shutdownWebSocketServer,
  getWebSocketServer,
} from "./services/websocket.js";
import {
  getMacroAgentServerManager,
  type MacroAgentServerManager,
} from "./services/macro-agent-server-manager.js";
import { readMacroAgentConfig } from "./utils/macro-agent-config.js";

const app = express();
const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 20;

// Multi-project infrastructure
let projectRegistry!: ProjectRegistry;
let projectManager!: ProjectManager;

// Macro-agent server manager (shared across projects)
let macroAgentServerManager: MacroAgentServerManager | null = null;

// Start file watcher (enabled by default, disable with SUDOCODE_WATCH=false)
const WATCH_ENABLED = process.env.SUDOCODE_WATCH !== "false";

// Async initialization function
async function initialize() {
  try {
    // Initialize ProjectRegistry and ProjectManager for multi-project support
    projectRegistry = new ProjectRegistry();
    await projectRegistry.load();
    console.log(
      `ProjectRegistry loaded from: ${projectRegistry.getConfigPath()}`
    );

    projectManager = new ProjectManager(projectRegistry, {
      watchEnabled: WATCH_ENABLED,
    });

    // Auto-open strategy:
    // 1. If current directory has .sudocode, open it (highest priority)
    // 2. Otherwise, open the most recently opened project (if available)
    const currentDir = process.cwd();
    const sudocodeDir = path.join(currentDir, ".sudocode");
    const hasLocalProject = existsSync(sudocodeDir);

    if (hasLocalProject) {
      console.log(
        `Found .sudocode in current directory, opening: ${currentDir}`
      );
      const openResult = await projectManager.openProject(currentDir);
      if (!openResult.ok) {
        const errorMsg =
          "message" in openResult.error!
            ? openResult.error!.message
            : `${openResult.error!.type}`;
        console.warn(`Failed to open local project: ${errorMsg}`);
        console.log("Server will start with no projects open");
      } else {
        const projectInfo = projectRegistry.getProject(openResult.value!.id);
        console.log(
          `Auto-opened local project: ${projectInfo?.name || path.basename(currentDir)}`
        );
      }
    } else {
      // No local project, try most recent
      const recentProjects = projectRegistry.getRecentProjects();
      if (recentProjects.length > 0) {
        const mostRecent = recentProjects[0];
        console.log(
          `Auto-opening most recent project: ${mostRecent.name} (${mostRecent.path})`
        );
        const openResult = await projectManager.openProject(mostRecent.path);
        if (!openResult.ok) {
          const errorMsg =
            "message" in openResult.error!
              ? openResult.error!.message
              : `${openResult.error!.type}`;
          console.warn(`Failed to auto-open most recent project: ${errorMsg}`);
          console.log("Server will start with no projects open");
        } else {
          console.log(`Auto-opened project: ${mostRecent.name}`);
        }
      } else {
        console.log(
          "No recent projects found. Server will start with no projects open"
        );
      }
    }
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

// Run initialization
await initialize();

// Start macro-agent server if enabled
// Note: This uses the current working directory for config, which should be fine
// since initialize() already opened a project from cwd if it exists
const macroAgentConfig = readMacroAgentConfig(process.cwd());
if (macroAgentConfig.enabled) {
  macroAgentServerManager = getMacroAgentServerManager({
    serverConfig: macroAgentConfig,
    cwd: process.cwd(),
  });
  try {
    await macroAgentServerManager.start();
    if (macroAgentServerManager.isReady()) {
      const acpUrl = macroAgentServerManager.getAcpUrl();
      console.log(`Macro-agent server running at: ${acpUrl ?? "unknown"}`);
    }
  } catch (error) {
    // Non-fatal: log warning but continue
    console.warn(
      "[MacroAgent] Failed to start macro-agent server:",
      error instanceof Error ? error.message : error
    );
    console.warn("[MacroAgent] Macro-agent will be unavailable");
  }
}

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
app.use(
  "/api/workflows",
  requireProject(projectManager),
  createWorkflowsRouter()
);
app.use("/api/config", requireProject(projectManager), createConfigRouter());
app.use("/api/plugins", requireProject(projectManager), createPluginsRouter());
app.use("/api/import", requireProject(projectManager), createImportRouter());
app.use(
  "/api/repo-info",
  requireProject(projectManager),
  createRepoInfoRouter()
);

// File search endpoint (requires project context)
app.use("/api/files", requireProject(projectManager), createFilesRouter());

// Agents endpoint - global, not project-specific
app.use("/api/agents", createAgentsRouter());

// Macro-agent observability endpoint - global, not project-specific
app.use("/api/macro-agent", createMacroAgentRouter());

// Voice endpoint - requires project context for config
app.use("/api/voice", requireProject(projectManager), createVoiceRouter());

// Project status endpoint - returns ready issues, active executions, running workflows
app.get(
  "/api/project/status",
  requireProject(projectManager),
  (req: Request, res: Response) => {
    try {
      const db = req.project!.db;

      // Get ready issues (open, not blocked)
      const readyIssues = db
        .prepare(
          `SELECT i.id, i.title, i.priority
           FROM issues i
           WHERE i.status = 'open'
           AND i.archived = 0
           AND NOT EXISTS (
             SELECT 1 FROM relationships r
             WHERE r.to_id = i.id
             AND r.relationship_type IN ('blocks', 'depends-on')
             AND EXISTS (
               SELECT 1 FROM issues blocker
               WHERE blocker.id = r.from_id
               AND blocker.status != 'closed'
             )
           )
           ORDER BY i.priority ASC, i.created_at ASC
           LIMIT 20`
        )
        .all() as Array<{ id: string; title: string; priority: number }>;

      // Get active executions
      const activeExecutions = db
        .prepare(
          `SELECT id, issue_id, status, agent_type
           FROM executions
           WHERE status IN ('running', 'pending', 'preparing')
           ORDER BY created_at DESC
           LIMIT 20`
        )
        .all() as Array<{
        id: string;
        issue_id: string | null;
        status: string;
        agent_type: string;
      }>;

      // Get running workflows
      const runningWorkflows = db
        .prepare(
          `SELECT id, status, title
           FROM workflows
           WHERE status IN ('running', 'pending', 'paused')
           ORDER BY created_at DESC
           LIMIT 20`
        )
        .all() as Array<{ id: string; status: string; title: string | null }>;

      res.json({
        success: true,
        data: {
          ready_issues: readyIssues,
          active_executions: activeExecutions,
          running_workflows: runningWorkflows,
        },
      });
    } catch (error) {
      console.error("Error getting project status:", error);
      res.status(500).json({
        success: false,
        data: null,
        message: "Failed to get project status",
        error_data: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// Mount execution routes
// TODO: Make these all relative to /executions
app.use("/api", requireProject(projectManager), createExecutionsRouter());

// Execution-scoped macro-agent routes
app.use(
  "/api/executions/:id/macro",
  requireProject(projectManager),
  createExecutionMacroRouter()
);

// Mount editor routes
app.use("/api", requireProject(projectManager), createEditorsRouter());

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  const openProjects = projectManager.getAllOpenProjects();
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    projects: {
      totalOpen: openProjects.length,
      openProjects: openProjects.map((p) => {
        const projectInfo = projectRegistry.getProject(p.id);
        return {
          id: p.id,
          name: projectInfo?.name || path.basename(p.path),
          path: p.path,
        };
      }),
    },
  });
});

// Version endpoint - returns versions of all packages
app.use("/api/version", createVersionRouter());

// Update endpoint - check for updates and manage updates (global, no project context)
app.use("/api/update", createUpdateRouter());

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

// API 404 handler - catch all unmatched API routes (any HTTP method)
app.all("/api/*", (req: Request, res: Response) => {
  console.error(`[server] 404 for API route: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: "Not found",
    message: `API endpoint not found: ${req.method} ${req.path}`,
  });
});

// SPA fallback - serve index.html for all non-API/non-WS routes
app.get("*", (req: Request, res: Response) => {
  // Skip WebSocket and health routes
  if (req.path.startsWith("/ws") || req.path.startsWith("/health")) {
    res.status(404).json({ error: "Not found" });
  } else {
    res.sendFile(path.join(frontendPath, "index.html"));
  }
});

// Create HTTP server
const server = http.createServer(app);

// Set server instance for update/restart functionality
setServerInstance(server);

/**
 * Attempts to start the server (HTTP + WebSocket) on an available port.
 * Uses get-port to find available ports. If an explicit SUDOCODE_PORT is set,
 * only that port will be used (no scanning).
 * Both HTTP and WebSocket must successfully initialize on the same port.
 */
async function startServer(
  preferredPort: number,
  maxAttempts: number
): Promise<number> {
  const explicitPort = process.env.SUDOCODE_PORT;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let port: number;
    let httpStarted = false;

    try {
      // Find an available port using get-port
      if (explicitPort) {
        // Explicit port specified - use it directly (no scanning)
        port = preferredPort;
      } else {
        // Use get-port to find an available port, preferring the initial port
        port = await getPort({ port: preferredPort });
        if (port !== preferredPort && attempt === 0) {
          console.log(
            `[server] Preferred port ${preferredPort} is in use, using port ${port}`
          );
        }
      }

      // Try to bind the HTTP server
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
        console.log(`[server] Cleaning up HTTP server...`);
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }

      // Clean up WebSocket if it was partially initialized
      const wss = getWebSocketServer();
      if (wss) {
        console.log(`[server] Cleaning up WebSocket server...`);
        await shutdownWebSocketServer();
      }

      // Determine if we should retry
      const isPortConflict =
        error.code === "EADDRINUSE" ||
        (error.message && error.message.includes("address already in use"));

      if (explicitPort) {
        // Explicit port was specified - fail immediately on any error
        throw new Error(
          `Port ${preferredPort} is already in use or initialization failed. ` +
            `Please specify a different SUDOCODE_PORT. Error: ${error.message}`
        );
      }

      if (isPortConflict || (httpStarted && error.message?.includes("WebSocket"))) {
        // Port conflict or WebSocket failed - retry with a new port
        if (attempt < maxAttempts - 1) {
          const reason = httpStarted
            ? "WebSocket initialization failed"
            : "port binding failed (race condition)";
          console.log(`[server] ${reason}, retrying...`);
          continue;
        } else {
          throw new Error(
            `Could not start server after ${maxAttempts} attempts`
          );
        }
      } else {
        // Some other error - fail immediately
        console.error(`[server] Unexpected error:`, error.message);
        throw error;
      }
    }
  }

  throw new Error(`Could not start server after ${maxAttempts} attempts`);
}

// Start listening with port scanning (includes both HTTP and WebSocket)
const startPort = process.env.SUDOCODE_PORT
  ? parseInt(process.env.SUDOCODE_PORT, 10)
  : DEFAULT_PORT;
const actualPort = await startServer(startPort, MAX_PORT_ATTEMPTS);

// Update all open projects with the actual server URL
// This is needed because projects are opened before the port is known
const actualServerUrl = `http://localhost:${actualPort}`;
projectManager.updateServerUrl(actualServerUrl);

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

  // Shutdown macro-agent server
  if (macroAgentServerManager) {
    console.log("Stopping macro-agent server...");
    await macroAgentServerManager.stop();
  }

  // Shutdown ProjectManager (closes all projects and their watchers)
  // This will shutdown all per-project ExecutionServices and close all databases
  if (projectManager) {
    await projectManager.shutdown();
  }

  // Shutdown WebSocket server
  await shutdownWebSocketServer();

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

  // Shutdown macro-agent server
  if (macroAgentServerManager) {
    console.log("Stopping macro-agent server...");
    await macroAgentServerManager.stop();
  }

  // Shutdown ProjectManager (closes all projects and their watchers)
  // This will shutdown all per-project ExecutionServices and close all databases
  if (projectManager) {
    await projectManager.shutdown();
  }

  // Shutdown WebSocket server
  await shutdownWebSocketServer();

  // Close HTTP server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
