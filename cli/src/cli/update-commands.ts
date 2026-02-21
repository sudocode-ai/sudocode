/**
 * Update command handlers
 */

import chalk from "chalk";
import { execSync } from "child_process";
import { checkForUpdates, dismissUpdate } from "../update-checker.js";

/**
 * Detect which sudocode package is globally installed
 * Returns the package name to update
 */
async function detectInstalledPackage(): Promise<string> {
  try {
    // Check if metapackage is installed
    execSync("npm list -g sudocode --depth=0", {
      stdio: "pipe",
      encoding: "utf8",
    });
    return "sudocode"; // Metapackage is installed
  } catch {
    // Metapackage not found, fall back to CLI
    return "@sudocode-ai/cli";
  }
}

/**
 * Install package with smart force retry
 * Tries without --force first, retries with --force only on EEXIST
 */
function installPackageWithRetry(packageName: string): void {
  const baseCommand = `npm install -g ${packageName}`;

  console.log();
  console.log(chalk.cyan(`Running: ${baseCommand}`));
  console.log();

  try {
    // First attempt: without --force
    execSync(baseCommand, { stdio: "inherit" });
  } catch (error) {
    // Check if it's an EEXIST error
    if (error instanceof Error && error.message.includes("EEXIST")) {
      console.log();
      console.log(
        chalk.yellow("File already exists, retrying with --force...")
      );
      console.log();

      try {
        // Retry with --force
        const forceCommand = `${baseCommand} --force`;
        console.log(chalk.cyan(`Running: ${forceCommand}`));
        console.log();
        execSync(forceCommand, { stdio: "inherit" });
      } catch (retryError) {
        // If retry also fails, throw the error to be handled by caller
        throw retryError;
      }
    } else {
      // Not an EEXIST error, re-throw
      throw error;
    }
  }

  // Refresh Volta shim if sudocode is managed by Volta
  // This is necessary because Volta caches package locations at shell initialization
  if (isUsingVoltaForSudocode()) {
    console.log();
    console.log(chalk.dim("Detected Volta - refreshing package shim..."));
    try {
      execSync(`volta install ${packageName}`, { stdio: "inherit" });
    } catch (voltaError) {
      // Volta refresh failed - not critical since npm install succeeded
      console.log(chalk.yellow("Warning: Failed to refresh Volta shim"));
      console.log(chalk.dim("You may need to re-install sudocode"));
    }
  }
}

/**
 * Check if sudocode was installed via Volta
 *
 * Volta is a Node.js version manager that creates shims for globally installed packages.
 * When a package is installed via npm while Volta is active, the binary is placed in
 * Volta's managed directory (typically ~/.volta/bin or $VOLTA_HOME/bin).
 *
 * This function detects if the sudocode binary is managed by Volta by:
 * 1. Checking if Volta is installed on the system
 * 2. Getting the actual path of the sudocode executable
 * 3. Verifying the path is within Volta's managed directories
 *
 * Why this matters:
 * Volta caches the resolved paths of executables at shell initialization time.
 * When sudocode is updated via `npm install -g`, the files are updated but the
 * current shell session continues to use the old cached path until the shell
 * is restarted. This is Volta's intended behavior for performance.
 *
 * @returns true if sudocode binary is managed by Volta, false otherwise
 */
function isUsingVoltaForSudocode(): boolean {
  try {
    // First check if Volta exists on the system
    execSync("volta --version", { stdio: "pipe" });

    // Get the actual path of the sudocode binary
    const binPath = execSync("which sudocode", {
      stdio: "pipe",
      encoding: "utf8",
    }).trim();

    // Check VOLTA_HOME environment variable if set (user may have custom location)
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      return binPath.startsWith(voltaHome);
    }

    // Fall back to checking for default /.volta/ directory in path
    return binPath.includes("/.volta/");
  } catch {
    // Volta not installed, which command failed, or other error
    return false;
  }
}

/**
 * Best-effort update of the Claude Code marketplace plugin.
 * If the claude CLI is not available, prints a note and moves on.
 */
function updateClaudePlugin(): void {
  try {
    execSync("claude --version", { stdio: "pipe" });
  } catch {
    console.log();
    console.log(
      chalk.dim("Claude CLI not found — skipping marketplace plugin update")
    );
    return;
  }

  try {
    console.log();
    console.log(chalk.dim("Updating Claude Code marketplace plugin..."));
    execSync("claude plugin marketplace update sudocode-ai/sudocode", {
      stdio: "inherit",
    });
    execSync("claude plugin update sudocode@sudocode-marketplace", {
      stdio: "inherit",
    });
    console.log(chalk.green("✓ Claude Code plugin updated"));
  } catch {
    // Best-effort — don't fail the overall update
  }
}

/**
 * Handle update check command
 */
export async function handleUpdateCheck(): Promise<void> {
  console.log(chalk.cyan("Checking for updates..."));

  const info = await checkForUpdates();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    console.log("Please try again later or check manually:");
    const packageName = await detectInstalledPackage();
    console.log(`  npm view ${packageName} version`);
    return;
  }

  const packageName = await detectInstalledPackage();

  console.log(`Current version: ${chalk.cyan(info.current)}`);
  console.log(`Latest version:  ${chalk.cyan(info.latest)}`);
  console.log(`Package: ${chalk.dim(packageName)}`);

  if (info.updateAvailable) {
    console.log();
    console.log(chalk.green("✓ Update available!"));
    console.log();
    console.log("To update, run:");
    console.log(chalk.yellow(`  sudocode update`));
    console.log();
    console.log("Or manually:");
    console.log(chalk.yellow(`  npm install -g ${packageName} --force`));
  } else {
    console.log();
    console.log(chalk.green("✓ You are using the latest version"));
  }
}

/**
 * Handle update install command
 */
export async function handleUpdate(): Promise<void> {
  console.log(chalk.cyan("Checking for updates..."));

  const info = await checkForUpdates();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    console.log("Attempting to update anyway...");
  } else if (!info.updateAvailable) {
    console.log(chalk.green("✓ Already on latest version:"), info.current);
    return;
  } else {
    console.log(`Updating from ${info.current} to ${info.latest}...`);
  }

  // Detect which package to update
  const packageToUpdate = await detectInstalledPackage();

  if (packageToUpdate === "sudocode") {
    console.log(
      chalk.dim("Detected metapackage installation - updating all components")
    );
  } else {
    console.log(chalk.dim("Detected standalone CLI installation"));
  }

  try {
    installPackageWithRetry(packageToUpdate);

    console.log();
    console.log(chalk.green("✓ Update completed successfully!"));
    console.log();
    console.log("Run 'sudocode --version' to verify the new version");

    // Best-effort: update Claude Code marketplace plugin
    updateClaudePlugin();
  } catch (error) {
    console.log();
    console.error(chalk.red("✗ Update failed"));
    console.log();
    console.log("Please try updating manually:");
    console.log(chalk.yellow(`  npm install -g ${packageToUpdate} --force`));
    console.log();

    if (error instanceof Error) {
      console.log("Error details:");
      console.log(chalk.dim(error.message));
    }

    process.exit(1);
  }
}

/**
 * Handle update dismiss command
 */
export async function handleUpdateDismiss(): Promise<void> {
  const info = await checkForUpdates();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    return;
  }

  if (!info.updateAvailable) {
    console.log(chalk.green("✓ Already on latest version:"), info.current);
    console.log("No update notifications to dismiss");
    return;
  }

  dismissUpdate(info.latest);
  console.log(chalk.green("✓ Update notifications dismissed for 30 days"));
  console.log();
  console.log(
    `You won't be notified about version ${info.latest} for the next 30 days`
  );
  console.log("To update now, run:", chalk.cyan("sudocode update"));
}
