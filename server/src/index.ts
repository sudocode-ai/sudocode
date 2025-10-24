import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as path from "path";
import type Database from "better-sqlite3";
import { initDatabase, getDatabaseInfo } from "./services/db.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const DB_PATH =
  process.env.SUDOCODE_DB_PATH ||
  // TODO: Extract the cache path from config.json
  path.join(process.cwd(), ".sudocode", "cache.db");

// Initialize database
let db: Database.Database;
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

// Middleware
app.use(cors());
app.use(express.json());

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

// Root endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "sudocode local server",
    version: "0.1.0",
  });
});

app.listen(PORT, () => {
  console.log(`sudocode local server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down server...");
  db.close();
  process.exit(0);
});

export default app;
export { db };
