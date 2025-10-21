#!/usr/bin/env node

/**
 * sudocode MCP Server entry point
 */

import { SudocodeMCPServer } from "./server.js";

async function main() {
  const server = new SudocodeMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
