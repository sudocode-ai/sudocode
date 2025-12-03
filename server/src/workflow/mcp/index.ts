#!/usr/bin/env node
/**
 * Workflow MCP Server Entry Point
 *
 * Parses CLI arguments and starts the workflow MCP server.
 *
 * Usage:
 *   node dist/workflow/mcp/index.js \
 *     --workflow-id wf-abc123 \
 *     --db-path .sudocode/cache.db \
 *     --repo-path /path/to/repo
 */

import { parseArgs } from "util";
import { WorkflowMCPServer } from "./server.js";

// =============================================================================
// CLI Argument Parsing
// =============================================================================

const { values } = parseArgs({
  options: {
    "workflow-id": {
      type: "string",
      short: "w",
    },
    "db-path": {
      type: "string",
      short: "d",
    },
    "repo-path": {
      type: "string",
      short: "r",
    },
    "server-url": {
      type: "string",
      short: "s",
    },
    help: {
      type: "boolean",
      short: "h",
    },
  },
  strict: true,
});

// =============================================================================
// Help
// =============================================================================

if (values.help) {
  console.error(`
Workflow MCP Server

Provides MCP tools for workflow orchestration.

Usage:
  node index.js --workflow-id <id> --db-path <path> --repo-path <path> [--server-url <url>]

Options:
  -w, --workflow-id  Workflow ID to manage (required)
  -d, --db-path      Path to SQLite database (required)
  -r, --repo-path    Path to repository root (required)
  -s, --server-url   Base URL of main server for notifications (optional)
  -h, --help         Show this help message
`);
  process.exit(0);
}

// =============================================================================
// Validation
// =============================================================================

if (!values["workflow-id"]) {
  console.error("Error: --workflow-id is required");
  process.exit(1);
}

if (!values["db-path"]) {
  console.error("Error: --db-path is required");
  process.exit(1);
}

if (!values["repo-path"]) {
  console.error("Error: --repo-path is required");
  process.exit(1);
}

// =============================================================================
// Start Server
// =============================================================================

const server = new WorkflowMCPServer({
  workflowId: values["workflow-id"],
  dbPath: values["db-path"],
  repoPath: values["repo-path"],
  serverUrl: values["server-url"],
});

// Handle shutdown gracefully
process.on("SIGINT", async () => {
  console.error("[WorkflowMCPServer] Received SIGINT, shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("[WorkflowMCPServer] Received SIGTERM, shutting down...");
  await server.stop();
  process.exit(0);
});

// Start the server
try {
  await server.start();
} catch (error) {
  console.error("[WorkflowMCPServer] Failed to start:", error);
  process.exit(1);
}
