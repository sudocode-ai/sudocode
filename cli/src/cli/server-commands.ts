/**
 * CLI handlers for server commands
 */

import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

export interface CommandContext {
  db: any;
  outputDir: string;
  jsonOutput: boolean;
}

export interface ServerStartOptions {
  port?: string;
  detach?: boolean;
}

/**
 * Start the sudocode local server
 */
export async function handleServerStart(
  ctx: CommandContext,
  options: ServerStartOptions
): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Find the server package - it should be a sibling workspace
  // TODO: Improve this to handle various installation scenarios
  const serverPath = path.resolve(__dirname, "../../../server/dist/index.js");

  // Set up environment variables
  const env = {
    ...process.env,
    PORT: options.port || process.env.PORT || "3000",
  };

  console.log(chalk.blue("Starting sudocode local server..."));
  if (options.port) {
    console.log(chalk.gray(`Port: ${options.port}`));
  }

  // Start the server process
  const serverProcess = spawn("node", [serverPath], {
    detached: options.detach || false,
    stdio: options.detach ? "ignore" : "inherit",
    env,
  });

  if (options.detach) {
    serverProcess.unref();
    console.log(
      chalk.green(
        `✓ Server started in background on http://localhost:${env.PORT}`
      )
    );
    console.log(chalk.gray(`  Process ID: ${serverProcess.pid}`));
    console.log(
      chalk.gray(`  Health check: http://localhost:${env.PORT}/health`)
    );
  } else {
    // Handle Ctrl+C gracefully
    process.on("SIGINT", () => {
      console.log(chalk.yellow("\n\nShutting down server..."));
      serverProcess.kill();
      process.exit(0);
    });

    serverProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(chalk.red(`Server exited with code ${code}`));
        process.exit(code);
      }
    });
  }
}
