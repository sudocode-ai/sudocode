/**
 * CLI handlers for plugin management commands
 */

import { spawn } from "child_process";
import chalk from "chalk";
import {
  getFirstPartyPlugins,
  loadPlugin,
  resolvePluginPath,
} from "../integrations/plugin-loader.js";

export interface CommandContext {
  db: any;
  outputDir: string;
  jsonOutput: boolean;
}

/**
 * Check if a package is installed
 */
async function isPackageInstalled(packageName: string): Promise<boolean> {
  try {
    await import(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * List available plugins
 */
export async function handlePluginList(
  ctx: CommandContext,
  options: { all?: boolean }
): Promise<void> {
  const firstPartyPlugins = getFirstPartyPlugins();

  if (ctx.jsonOutput) {
    const pluginStatuses = await Promise.all(
      firstPartyPlugins.map(async (p) => ({
        name: p.name,
        package: p.package,
        installed: await isPackageInstalled(p.package),
      }))
    );
    console.log(JSON.stringify(pluginStatuses, null, 2));
    return;
  }

  console.log(chalk.blue.bold("Available Integration Plugins"));
  console.log();

  for (const plugin of firstPartyPlugins) {
    const installed = await isPackageInstalled(plugin.package);
    const status = installed
      ? chalk.green("✓ installed")
      : chalk.gray("not installed");

    console.log(`  ${chalk.bold(plugin.name)}`);
    console.log(`    Package: ${chalk.gray(plugin.package)}`);
    console.log(`    Status:  ${status}`);
    console.log();
  }

  console.log(chalk.gray("Install a plugin with: sudocode plugin install <name>"));
}

export interface PluginInstallOptions {
  global?: boolean;
}

/**
 * Install a plugin
 */
export async function handlePluginInstall(
  ctx: CommandContext,
  pluginName: string,
  options: PluginInstallOptions
): Promise<void> {
  const packageName = resolvePluginPath(pluginName);

  // Check if already installed
  const alreadyInstalled = await isPackageInstalled(packageName);
  if (alreadyInstalled) {
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({
          success: true,
          plugin: pluginName,
          package: packageName,
          message: "Already installed",
        })
      );
    } else {
      console.log(
        chalk.yellow(`Plugin '${pluginName}' (${packageName}) is already installed`)
      );
    }
    return;
  }

  if (!ctx.jsonOutput) {
    console.log(chalk.blue(`Installing plugin '${pluginName}'...`));
    console.log(chalk.gray(`Package: ${packageName}`));
    console.log();
  }

  // Build npm install command
  const args = ["install", packageName];
  if (options.global) {
    args.splice(1, 0, "-g");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      stdio: ctx.jsonOutput ? "pipe" : "inherit",
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    if (ctx.jsonOutput) {
      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("close", (code) => {
      if (code === 0) {
        if (ctx.jsonOutput) {
          console.log(
            JSON.stringify({
              success: true,
              plugin: pluginName,
              package: packageName,
              message: "Installed successfully",
            })
          );
        } else {
          console.log();
          console.log(chalk.green(`✓ Plugin '${pluginName}' installed successfully`));
          console.log();
          console.log(chalk.gray("Configure in .sudocode/config.json:"));
          console.log(
            chalk.gray(`
  "integrations": {
    "${pluginName}": {
      "enabled": true,
      "options": {
        "path": ".${pluginName}"
      }
    }
  }
`)
          );
        }
        resolve();
      } else {
        if (ctx.jsonOutput) {
          console.log(
            JSON.stringify({
              success: false,
              plugin: pluginName,
              package: packageName,
              error: stderr || `npm install exited with code ${code}`,
            })
          );
        } else {
          console.error(chalk.red(`✗ Failed to install plugin '${pluginName}'`));
          console.error(chalk.gray(`Exit code: ${code}`));
        }
        reject(new Error(`npm install failed with code ${code}`));
      }
    });

    child.on("error", (error) => {
      if (ctx.jsonOutput) {
        console.log(
          JSON.stringify({
            success: false,
            plugin: pluginName,
            package: packageName,
            error: error.message,
          })
        );
      } else {
        console.error(chalk.red(`✗ Failed to install plugin '${pluginName}'`));
        console.error(chalk.gray(error.message));
      }
      reject(error);
    });
  });
}

/**
 * Show status of configured plugins
 */
export async function handlePluginStatus(ctx: CommandContext): Promise<void> {
  const firstPartyPlugins = getFirstPartyPlugins();

  const statuses = await Promise.all(
    firstPartyPlugins.map(async (p) => {
      const installed = await isPackageInstalled(p.package);
      let version: string | undefined;
      let displayName: string | undefined;

      if (installed) {
        const plugin = await loadPlugin(p.name);
        if (plugin) {
          version = plugin.version;
          displayName = plugin.displayName;
        }
      }

      return {
        name: p.name,
        displayName,
        package: p.package,
        installed,
        version,
      };
    })
  );

  if (ctx.jsonOutput) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }

  const installed = statuses.filter((s) => s.installed);
  const notInstalled = statuses.filter((s) => !s.installed);

  if (installed.length === 0) {
    console.log(chalk.yellow("No integration plugins installed"));
    console.log();
    console.log(chalk.gray("Install a plugin with: sudocode plugin install <name>"));
    console.log(chalk.gray("List available plugins with: sudocode plugin list"));
    return;
  }

  console.log(chalk.blue.bold("Installed Plugins"));
  console.log();

  for (const status of installed) {
    console.log(
      `  ${chalk.green("✓")} ${chalk.bold(status.displayName || status.name)}`
    );
    console.log(`    Package: ${chalk.gray(status.package)}`);
    console.log(`    Version: ${chalk.gray(status.version || "unknown")}`);
    console.log();
  }

  if (notInstalled.length > 0) {
    console.log(chalk.gray.bold("Available (not installed)"));
    console.log();
    for (const status of notInstalled) {
      console.log(`  ${chalk.gray("○")} ${status.name}`);
    }
    console.log();
  }
}

/**
 * Uninstall a plugin
 */
export async function handlePluginUninstall(
  ctx: CommandContext,
  pluginName: string,
  options: { global?: boolean }
): Promise<void> {
  const packageName = resolvePluginPath(pluginName);

  // Check if installed
  const isInstalled = await isPackageInstalled(packageName);
  if (!isInstalled) {
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({
          success: false,
          plugin: pluginName,
          package: packageName,
          error: "Not installed",
        })
      );
    } else {
      console.log(
        chalk.yellow(`Plugin '${pluginName}' (${packageName}) is not installed`)
      );
    }
    return;
  }

  if (!ctx.jsonOutput) {
    console.log(chalk.blue(`Uninstalling plugin '${pluginName}'...`));
  }

  const args = ["uninstall", packageName];
  if (options.global) {
    args.splice(1, 0, "-g");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      stdio: ctx.jsonOutput ? "pipe" : "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      if (code === 0) {
        if (ctx.jsonOutput) {
          console.log(
            JSON.stringify({
              success: true,
              plugin: pluginName,
              package: packageName,
              message: "Uninstalled successfully",
            })
          );
        } else {
          console.log();
          console.log(chalk.green(`✓ Plugin '${pluginName}' uninstalled`));
        }
        resolve();
      } else {
        if (ctx.jsonOutput) {
          console.log(
            JSON.stringify({
              success: false,
              plugin: pluginName,
              package: packageName,
              error: `npm uninstall exited with code ${code}`,
            })
          );
        } else {
          console.error(chalk.red(`✗ Failed to uninstall plugin '${pluginName}'`));
        }
        reject(new Error(`npm uninstall failed with code ${code}`));
      }
    });

    child.on("error", (error) => {
      if (ctx.jsonOutput) {
        console.log(
          JSON.stringify({
            success: false,
            plugin: pluginName,
            package: packageName,
            error: error.message,
          })
        );
      } else {
        console.error(chalk.red(`✗ Failed to uninstall plugin '${pluginName}'`));
        console.error(chalk.gray(error.message));
      }
      reject(error);
    });
  });
}
