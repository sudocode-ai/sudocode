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
import { ExecutionService } from "./services/execution-service.js";
import { ExecutionLogsStore } from "./services/execution-logs-store.js";
// import {
//   ExecutionLogsCleanup,
//   DEFAULT_CLEANUP_CONFIG,
//   type CleanupConfig,
// } from "./services/execution-logs-cleanup.js";
import { WorktreeManager } from "./execution/worktree/manager.js";
import { getWorktreeConfig } from "./execution/worktree/config.js";
import { createIssuesRouter } from "./routes/issues.js";
import { createSpecsRouter } from "./routes/specs.js";
import { createRelationshipsRouter } from "./routes/relationships.js";
import { createFeedbackRouter } from "./routes/feedback.js";
import { createExecutionsRouter } from "./routes/executions.js";
import { createExecutionStreamRoutes } from "./routes/executions-stream.js";
import { createProjectAgentRouter } from "./routes/project-agent.js";
import { TransportManager } from "./execution/transport/transport-manager.js";
import { getIssueById } from "./services/issues.js";
import { getSpecById } from "./services/specs.js";
import {
  startServerWatcher,
  type ServerWatcherControl,
} from "./services/watcher.js";
import {
  initWebSocketServer,
  getWebSocketStats,
  shutdownWebSocketServer,
  broadcastIssueUpdate,
  broadcastSpecUpdate,
} from "./services/websocket.js";
import {
  createEventBus,
  destroyEventBus,
  type EventBus,
} from "./services/event-bus.js";

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
let watcher: ServerWatcherControl | null = null;
let transportManager!: TransportManager;
let logsStore!: ExecutionLogsStore;
// let logsCleanup: ExecutionLogsCleanup | null = null;
let executionService: ExecutionService | null = null;
let eventBus: EventBus | null = null;

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

    // Initialize transport manager for SSE streaming
    transportManager = new TransportManager();
    console.log("Transport manager initialized");

    // Initialize execution logs store
    logsStore = new ExecutionLogsStore(db);
    console.log("Execution logs store initialized");

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

    // Initialize execution service globally for cleanup on shutdown
    executionService = new ExecutionService(
      db,
      REPO_ROOT,
      undefined,
      transportManager,
      logsStore
    );
    console.log("Execution service initialized");

    // Initialize EventBus for project agent and real-time events
    eventBus = await createEventBus({
      db,
      baseDir: SUDOCODE_DIR,
      debounceDelay: 2000,
    });
    console.log("EventBus initialized");

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

// Start file watcher (enabled by default, disable with WATCH=false)
const WATCH_ENABLED = process.env.WATCH !== "false";
const SYNC_JSONL_TO_MARKDOWN = process.env.SYNC_JSONL_TO_MARKDOWN === "true";
if (WATCH_ENABLED) {
  try {
    watcher = startServerWatcher({
      db,
      baseDir: SUDOCODE_DIR,
      debounceDelay: parseInt(process.env.WATCH_DEBOUNCE || "2000", 10),
      syncJSONLToMarkdown: SYNC_JSONL_TO_MARKDOWN,
      onFileChange: (info) => {
        console.log(
          `[server] File change detected: ${info.entityType || "unknown"} ${
            info.entityId || ""
          }`
        );

        // Broadcast WebSocket updates for issue and spec changes
        if (info.entityType === "issue" && info.entityId) {
          if (info.entityId === "*") {
            // Wildcard update (JSONL file changed) - broadcast to all issue subscribers
            broadcastIssueUpdate("*", "updated", null);
          } else {
            // Specific issue update - fetch and broadcast the specific issue
            const issue = getIssueById(db, info.entityId);
            if (issue) {
              broadcastIssueUpdate(info.entityId, "updated", issue);
            }
          }
        } else if (info.entityType === "spec" && info.entityId) {
          if (info.entityId === "*") {
            // Wildcard update (JSONL file changed) - broadcast to all spec subscribers
            broadcastSpecUpdate("*", "updated", null);
          } else {
            // Specific spec update - fetch and broadcast the specific spec
            const spec = getSpecById(db, info.entityId);
            if (spec) {
              broadcastSpecUpdate(info.entityId, "updated", spec);
            }
          }
        }
      },
    });
    console.log(`[server] File watcher started on: ${SUDOCODE_DIR}`);
  } catch (error) {
    console.error("Failed to start file watcher:", error);
    console.warn(
      "Continuing without file watcher. Set WATCH=false to suppress this warning."
    );
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/issues", createIssuesRouter(db));
app.use("/api/specs", createSpecsRouter(db));
app.use("/api/relationships", createRelationshipsRouter(db));
app.use("/api/feedback", createFeedbackRouter(db));
app.use("/api/project-agent", createProjectAgentRouter(db, REPO_ROOT, executionService));
// Mount execution routes (must be before stream routes to avoid conflicts)
app.use(
  "/api",
  createExecutionsRouter(
    db,
    REPO_ROOT,
    transportManager,
    executionService!,
    logsStore
  )
);
app.use("/api/executions", createExecutionStreamRoutes(transportManager));

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
      cli: cliPackage.version,
      server: serverPackage.version,
      frontend: frontendPackage.version,
    });
  } catch (error) {
    console.error("Failed to read version information:", error);
    res.status(500).json({ error: "Failed to read version information" });
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
 * Attempts to start the server on the given port, incrementing if unavailable.
 * Only scans for ports if no explicit PORT was provided.
 */
async function startServer(
  initialPort: number,
  maxAttempts: number
): Promise<number> {
  const explicitPort = process.env.PORT;
  const shouldScan = !explicitPort;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = initialPort + attempt;

    try {
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

      // Success! Return the port we successfully bound to
      return port;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === "EADDRINUSE") {
        if (!shouldScan) {
          // Explicit port was specified and it's in use - fail immediately
          throw new Error(
            `Port ${port} is already in use. Please specify a different PORT.`
          );
        }

        // Port is in use, try next one if we have attempts left
        if (attempt < maxAttempts - 1) {
          console.log(`Port ${port} is already in use, trying ${port + 1}...`);
          continue;
        } else {
          throw new Error(
            `Could not find an available port after ${maxAttempts} attempts (${initialPort}-${port})`
          );
        }
      } else {
        // Some other error - fail immediately
        throw error;
      }
    }
  }

  throw new Error(`Could not start server after ${maxAttempts} attempts`);
}

// Start listening with port scanning
const startPort = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : DEFAULT_PORT;
const actualPort = await startServer(startPort, MAX_PORT_ATTEMPTS);

// Initialize WebSocket server AFTER successfully binding to a port
initWebSocketServer(server, "/ws");

// Format URLs as clickable links with color
const httpUrl = `http://localhost:${actualPort}`;
const wsUrl = `ws://localhost:${actualPort}/ws`;

// ANSI escape codes for green color and clickable links
const green = "\u001b[32m";
const bold = "\u001b[1m";
const reset = "\u001b[0m";
const makeClickable = (url: string, text: string) =>
  `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;

console.log(`WebSocket server available at: ${makeClickable(wsUrl, wsUrl)}`);
console.log(
  `${bold}${green}sudocode local server running on: ${makeClickable(
    httpUrl,
    httpUrl
  )}${reset}`
);

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

  // Shutdown execution service (cancel active executions)
  if (executionService) {
    await executionService.shutdown();
  }

  // Stop logs cleanup service
  // TODO: Re-enable when logs cleanup is supported
  // if (logsCleanup) {
  //   logsCleanup.stop();
  // }

  // Stop file watcher
  if (watcher) {
    await watcher.stop();
  }

  // Shutdown EventBus
  if (eventBus) {
    await destroyEventBus();
    console.log("EventBus shutdown complete");
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

  // Shutdown execution service (cancel active executions)
  if (executionService) {
    await executionService.shutdown();
  }

  // Stop logs cleanup service
  // TODO: Re-enable when logs cleanup is supported
  // if (logsCleanup) {
  //   logsCleanup.stop();
  // }

  // Stop file watcher
  if (watcher) {
    await watcher.stop();
  }

  // Shutdown EventBus
  if (eventBus) {
    await destroyEventBus();
    console.log("EventBus shutdown complete");
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
