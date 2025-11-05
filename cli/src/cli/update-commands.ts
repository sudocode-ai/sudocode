/**
 * Update command handlers
 */

import chalk from "chalk";
import { execSync } from "child_process";
import { checkForUpdates, dismissUpdate } from "../update-checker.js";

const PACKAGE_NAME = "@sudocode-ai/cli";

/**
 * Handle update check command
 */
export async function handleUpdateCheck(): Promise<void> {
  console.log(chalk.cyan("Checking for updates..."));

  const info = await checkForUpdates();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    console.log("Please try again later or check manually:");
    console.log(`  npm view ${PACKAGE_NAME} version`);
    return;
  }

  console.log(`Current version: ${chalk.cyan(info.current)}`);
  console.log(`Latest version:  ${chalk.cyan(info.latest)}`);

  if (info.updateAvailable) {
    console.log();
    console.log(chalk.green("✓ Update available!"));
    console.log();
    console.log("To update, run:");
    console.log(chalk.yellow(`  npm install -g ${PACKAGE_NAME}`));
    console.log(chalk.yellow(`  sudocode update`));
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

  try {
    console.log();
    console.log(chalk.cyan("Running: npm install -g " + PACKAGE_NAME));
    console.log();

    execSync(`npm install -g ${PACKAGE_NAME}`, {
      stdio: "inherit",
    });

    console.log();
    console.log(chalk.green("✓ Update completed successfully!"));
    console.log();
    console.log("Run 'sudocode --version' to verify the new version");
  } catch (error) {
    console.log();
    console.error(chalk.red("✗ Update failed"));
    console.log();
    console.log("Please try updating manually:");
    console.log(chalk.yellow(`  npm install -g ${PACKAGE_NAME}`));
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
