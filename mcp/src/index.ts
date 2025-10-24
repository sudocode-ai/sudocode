#!/usr/bin/env node

/**
 * sudocode MCP Server entry point
 */

import { SudocodeMCPServer } from "./server.js";
import { SudocodeClientConfig } from "./types.js";

function parseArgs(): SudocodeClientConfig {
  const config: SudocodeClientConfig = {};
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
  -h, --help                Show this help message

Environment Variables:
  SUDOCODE_WORKING_DIR      Default working directory
  SUDOCODE_PATH             Default CLI path
  SUDOCODE_DB               Default database path
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

async function main() {
  const config = parseArgs();
  const server = new SudocodeMCPServer(config);
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
