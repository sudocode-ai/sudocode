#!/usr/bin/env node

/**
 * sudocode MCP Server entry point
 */

import { SudocodeMCPServer } from "./server.js";
import { SudocodeMCPServerConfig } from "./types.js";
import {
  resolveScopes,
  hasExtendedScopes,
  getMissingServerUrlScopes,
  ALL_SCOPES,
} from "./scopes.js";

function parseArgs(): SudocodeMCPServerConfig {
  const config: SudocodeMCPServerConfig = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--working-dir":
      case "-w":
        config.workingDir = args[++i];
        break;
      case "--cli-path":
        config.cliPath = args[++i];
        break;
      case "--db-path":
      case "--db":
        config.dbPath = args[++i];
        break;
      case "--no-sync":
        config.syncOnStartup = false;
        break;
      case "--scope":
      case "-s":
        config.scope = args[++i];
        break;
      case "--server-url":
        config.serverUrl = args[++i];
        break;
      case "--project-id":
        config.projectId = args[++i];
        break;
      case "--help":
      case "-h":
        console.log(`
sudocode MCP Server

Usage: sudocode-mcp [options]

Options:
  -w, --working-dir <path>  Working directory (default: cwd or SUDOCODE_WORKING_DIR)
  --cli-path <path>         Path to sudocode CLI (default: 'sudocode' or SUDOCODE_PATH)
  --db-path <path>          Database path (default: auto-discover or SUDOCODE_DB)
  --no-sync                 Skip initial sync on startup (default: sync enabled)
  -s, --scope <scopes>      Comma-separated list of scopes to enable (default: "default")
  --server-url <url>        Local server URL for extended tools (required if scope != default)
  --project-id <id>         Project ID for API calls (auto-discovered if not provided)
  -h, --help                Show this help message

Scopes:
  default                   Original 10 CLI-wrapped tools (no server required)
  overview                  project_status tool
  executions                Execution management (list, show, start, follow-up, cancel)
  executions:read           Read-only execution tools (list, show)
  executions:write          Write execution tools (start, follow-up, cancel)
  inspection                Execution inspection (trajectory, changes, chain)
  workflows                 Workflow orchestration (list, show, status, create, control)
  workflows:read            Read-only workflow tools
  workflows:write           Write workflow tools
  escalation                User communication (escalate, notify)

Meta-scopes:
  project-assistant         All extended scopes (overview, executions, inspection, workflows, escalation)
  all                       default + project-assistant

Examples:
  # Default behavior (original 10 tools)
  sudocode-mcp --working-dir /path/to/repo

  # Enable execution monitoring
  sudocode-mcp -w /path/to/repo --scope default,executions:read --server-url http://localhost:3000

  # Full project assistant mode
  sudocode-mcp -w /path/to/repo --scope all --server-url http://localhost:3000

Environment Variables:
  SUDOCODE_WORKING_DIR      Default working directory
  SUDOCODE_PATH             Default CLI path
  SUDOCODE_DB               Default database path
  SUDOCODE_SERVER_URL       Default server URL for extended tools
        `);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error("Use --help for usage information");
        process.exit(1);
    }
  }

  return config;
}

/**
 * Validate configuration and resolve scopes.
 */
function validateConfig(config: SudocodeMCPServerConfig): void {
  // Default scope if not specified
  const scopeArg = config.scope || "default";

  // Use env var for server URL if not specified
  if (!config.serverUrl && process.env.SUDOCODE_SERVER_URL) {
    config.serverUrl = process.env.SUDOCODE_SERVER_URL;
  }

  try {
    // Validate and resolve scopes
    const scopeConfig = resolveScopes(
      scopeArg,
      config.serverUrl,
      config.projectId
    );

    // Check if extended scopes are enabled without server URL
    if (hasExtendedScopes(scopeConfig.enabledScopes) && !config.serverUrl) {
      const missingScopes = getMissingServerUrlScopes(scopeConfig.enabledScopes);
      console.error("");
      console.error(
        `⚠️  WARNING: Extended scopes require --server-url to be configured`
      );
      console.error(`   The following scopes will be disabled: ${missingScopes.join(", ")}`);
      console.error(`   Only 'default' scope tools will be available.`);
      console.error("");
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

async function main() {
  const config = parseArgs();
  validateConfig(config);
  const server = new SudocodeMCPServer(config);
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
