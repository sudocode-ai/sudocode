#!/usr/bin/env node
/**
 * Workflow MCP Server Entry Point
 *
 * Parses CLI arguments and starts the workflow MCP server.
 * All communication with the main server goes through the HTTP API.
 *
 * Usage:
 *   node dist/workflow/mcp/index.js \
 *     --workflow-id wf-abc123 \
 *     --server-url http://localhost:3000 \
 *     --project-id proj-123 \
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
    "server-url": {
      type: "string",
      short: "s",
    },
    "project-id": {
      type: "string",
      short: "p",
    },
    "repo-path": {
      type: "string",
      short: "r",
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
All communication with the main server goes through the HTTP API.

Usage:
  node index.js --workflow-id <id> --server-url <url> --project-id <id> --repo-path <path>

Options:
  -w, --workflow-id  Workflow ID to manage (required)
  -s, --server-url   Base URL of main server for API calls (required)
  -p, --project-id   Project ID for API calls (required)
  -r, --repo-path    Path to repository root (required)
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

if (!values["server-url"]) {
  console.error("Error: --server-url is required");
  process.exit(1);
}

if (!values["project-id"]) {
  console.error("Error: --project-id is required");
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
  serverUrl: values["server-url"],
  projectId: values["project-id"],
  repoPath: values["repo-path"],
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
