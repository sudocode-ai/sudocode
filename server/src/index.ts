import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";
import type Database from "better-sqlite3";

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initDatabase, getDatabaseInfo } from "./services/db.js";
import { createIssuesRouter } from "./routes/issues.js";
import { createSpecsRouter } from "./routes/specs.js";
import { createRelationshipsRouter } from "./routes/relationships.js";
import { createFeedbackRouter } from "./routes/feedback.js";
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

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Falls back to current directory for development/testing
const SUDOCODE_DIR =
  process.env.SUDOCODE_DIR || path.join(process.cwd(), ".sudocode");
const DB_PATH = path.join(SUDOCODE_DIR, "cache.db");

// Initialize database
let db: Database.Database;
let watcher: ServerWatcherControl | null = null;

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
} catch (error) {
  console.error("Failed to initialize database:", error);
  process.exit(1);
}

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

// WebSocket stats endpoint
app.get("/ws/stats", (_req: Request, res: Response) => {
  const stats = getWebSocketStats();
  res.status(200).json(stats);
});

// Serve static frontend
const frontendPath = path.join(__dirname, "../../../frontend/dist");
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

// Create HTTP server and initialize WebSocket
const server = http.createServer(app);

// Initialize WebSocket server
initWebSocketServer(server, "/ws");

// Start listening
server.listen(PORT, () => {
  console.log(`sudocode local server running on http://localhost:${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");

  // Stop file watcher
  if (watcher) {
    await watcher.stop();
  }

  // Shutdown WebSocket server
  await shutdownWebSocketServer();

  // Close database
  db.close();

  // Close HTTP server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down server...");

  // Stop file watcher
  if (watcher) {
    await watcher.stop();
  }

  // Shutdown WebSocket server
  await shutdownWebSocketServer();

  // Close database
  db.close();

  // Close HTTP server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
export { db };
