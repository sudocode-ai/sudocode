/**
 * CLI handlers for server commands
 */

import { spawn } from "child_process";
import chalk from "chalk";
import { getUpdateNotification } from "../update-checker.js";

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
 * Check if @sudocode-ai/local-server is installed and available
 * Uses 'npx --no @sudocode-ai/local-server --version' to check without installing
 */
async function isServerInstalled(): Promise<boolean> {
  const { execSync } = await import("child_process");

  try {
    // Use npx with --no flag to check if package exists without installing
    execSync("npx --no @sudocode-ai/local-server --version", {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the sudocode local server
 */
export async function handleServerStart(
  ctx: CommandContext,
  options: ServerStartOptions
): Promise<void> {
  // Check for updates before starting server
  // Skip if SUDOCODE_DISABLE_UPDATE_CHECK environment variable is set
  if (process.env.SUDOCODE_DISABLE_UPDATE_CHECK !== "true") {
    try {
      const updateNotification = await getUpdateNotification();
      if (updateNotification) {
        console.log();
        console.log(chalk.yellow(updateNotification));
        console.log();
      }
    } catch {
      // Silently ignore update check failures
    }
  }

  // Check if server is installed first
  const serverInstalled = await isServerInstalled();

  if (!serverInstalled) {
    console.error(chalk.red("✗ @sudocode-ai/local-server is not installed"));
    console.log();
    console.log(chalk.yellow("Please install the server package first:"));
    console.log();
    console.log(chalk.blue("  Global installation (recommended):"));
    console.log(chalk.gray("    npm install -g @sudocode-ai/local-server"));
    console.log();
    console.log(chalk.blue("  Or local installation:"));
    console.log(chalk.gray("    npm install @sudocode-ai/local-server"));
    console.log();
    console.log(chalk.blue("  Or run directly without installing:"));
    console.log(chalk.gray("    npx @sudocode-ai/local-server"));
    console.log();
    process.exit(1);
  }

  // Set up environment variables
  const env = {
    ...process.env,
    SUDOCODE_DIR: ctx.outputDir,
    PORT: options.port || process.env.PORT || "3000",
  };

  console.log(chalk.blue("Starting sudocode local server..."));
  if (options.port) {
    console.log(chalk.gray(`Port: ${options.port}`));
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray("Using npx @sudocode-ai/local-server"));
  }

  const serverProcess = spawn(
    "npx",
    ["--no", "@sudocode-ai/local-server"], // --no prevents auto-install
    {
      detached: options.detach || false,
      stdio: options.detach ? "ignore" : "inherit",
      env,
    }
  );

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
