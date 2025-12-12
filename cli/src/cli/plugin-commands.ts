/**
 * CLI handlers for plugin management commands
 */

import { spawn } from "child_process";
import chalk from "chalk";
import {
  getFirstPartyPlugins,
  loadPlugin,
  resolvePluginPath,
  testProviderConnection,
} from "../integrations/plugin-loader.js";
import { getConfig, updateConfig } from "../config.js";
import type {
  IntegrationProviderConfig,
  IntegrationsConfig,
} from "@sudocode-ai/types";

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
  _options: { all?: boolean }
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

export interface PluginConfigureOptions {
  /** Plugin-specific options as JSON string */
  options?: string;
  /** Individual option key=value pairs */
  set?: string[];
  /** Enable the integration */
  enable?: boolean;
  /** Disable the integration */
  disable?: boolean;
  /** Enable auto-sync */
  autoSync?: boolean;
  /** Enable auto-import */
  autoImport?: boolean;
  /** Delete behavior: close, delete, or ignore */
  deleteBehavior?: "close" | "delete" | "ignore";
  /** Run test after configuration */
  test?: boolean;
}

/**
 * Configure a plugin
 */
export async function handlePluginConfigure(
  ctx: CommandContext,
  pluginName: string,
  options: PluginConfigureOptions
): Promise<void> {
  // Load the plugin to validate it exists and get config schema
  const plugin = await loadPlugin(pluginName);
  if (!plugin) {
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({
          success: false,
          plugin: pluginName,
          error: "Plugin not installed. Install with: sudocode plugin install " + pluginName,
        })
      );
    } else {
      console.error(
        chalk.red(`✗ Plugin '${pluginName}' not installed.`)
      );
      console.log(chalk.gray(`Install with: sudocode plugin install ${pluginName}`));
    }
    return;
  }

  // Get current config
  const config = getConfig(ctx.outputDir);
  const integrations: IntegrationsConfig = config.integrations || {};
  const existingConfig = integrations[pluginName] || { enabled: false };

  // Parse options
  let pluginOptions: Record<string, unknown> = existingConfig.options || {};

  // Apply --options JSON if provided
  if (options.options) {
    try {
      const parsed = JSON.parse(options.options);
      pluginOptions = { ...pluginOptions, ...parsed };
    } catch (e) {
      if (ctx.jsonOutput) {
        console.log(
          JSON.stringify({
            success: false,
            plugin: pluginName,
            error: "Invalid JSON in --options",
          })
        );
      } else {
        console.error(chalk.red("✗ Invalid JSON in --options"));
      }
      return;
    }
  }

  // Apply --set key=value pairs
  if (options.set && options.set.length > 0) {
    for (const pair of options.set) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) {
        if (ctx.jsonOutput) {
          console.log(
            JSON.stringify({
              success: false,
              plugin: pluginName,
              error: `Invalid --set format: ${pair}. Expected key=value`,
            })
          );
        } else {
          console.error(chalk.red(`✗ Invalid --set format: ${pair}. Expected key=value`));
        }
        return;
      }
      const key = pair.slice(0, eqIdx);
      const value = pair.slice(eqIdx + 1);

      // Try to parse as JSON for booleans/numbers, otherwise use as string
      try {
        pluginOptions[key] = JSON.parse(value);
      } catch {
        pluginOptions[key] = value;
      }
    }
  }

  // Validate the configuration
  const validation = plugin.validateConfig(pluginOptions);
  if (!validation.valid) {
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({
          success: false,
          plugin: pluginName,
          errors: validation.errors,
          warnings: validation.warnings,
        })
      );
    } else {
      console.error(chalk.red("✗ Configuration validation failed:"));
      for (const error of validation.errors) {
        console.error(chalk.red(`  - ${error}`));
      }
      if (validation.warnings.length > 0) {
        console.log(chalk.yellow("\nWarnings:"));
        for (const warning of validation.warnings) {
          console.log(chalk.yellow(`  - ${warning}`));
        }
      }
    }
    return;
  }

  // Show warnings even on success
  if (!ctx.jsonOutput && validation.warnings.length > 0) {
    console.log(chalk.yellow("Warnings:"));
    for (const warning of validation.warnings) {
      console.log(chalk.yellow(`  - ${warning}`));
    }
    console.log();
  }

  // Build the new provider config
  const newConfig: IntegrationProviderConfig = {
    ...existingConfig,
    options: pluginOptions,
  };

  // Apply enable/disable flags
  if (options.enable) {
    newConfig.enabled = true;
  } else if (options.disable) {
    newConfig.enabled = false;
  } else if (existingConfig.enabled === undefined) {
    // Enable by default when first configuring
    newConfig.enabled = true;
  }

  // Apply other flags
  if (options.autoSync !== undefined) {
    newConfig.auto_sync = options.autoSync;
  }
  if (options.autoImport !== undefined) {
    newConfig.auto_import = options.autoImport;
  }
  if (options.deleteBehavior) {
    newConfig.delete_behavior = options.deleteBehavior;
  }

  // Update config
  integrations[pluginName] = newConfig;
  updateConfig(ctx.outputDir, { integrations });

  if (ctx.jsonOutput) {
    console.log(
      JSON.stringify({
        success: true,
        plugin: pluginName,
        config: newConfig,
        message: "Configuration saved",
      })
    );
  } else {
    console.log(chalk.green(`✓ Plugin '${pluginName}' configured successfully`));
    console.log();
    console.log(chalk.bold("Configuration:"));
    console.log(chalk.gray(`  Enabled: ${newConfig.enabled}`));
    console.log(chalk.gray(`  Auto-sync: ${newConfig.auto_sync ?? false}`));
    console.log(chalk.gray(`  Auto-import: ${newConfig.auto_import ?? true}`));
    console.log(chalk.gray(`  Delete behavior: ${newConfig.delete_behavior ?? "close"}`));
    console.log(chalk.gray(`  Options:`));
    for (const [key, value] of Object.entries(newConfig.options || {})) {
      console.log(chalk.gray(`    ${key}: ${JSON.stringify(value)}`));
    }
  }

  // Run test if requested
  if (options.test) {
    console.log();
    await handlePluginTest(ctx, pluginName);
  }
}

/**
 * Test a plugin's connection
 */
export async function handlePluginTest(
  ctx: CommandContext,
  pluginName: string
): Promise<void> {
  // Get current config
  const config = getConfig(ctx.outputDir);
  const integrations: IntegrationsConfig = config.integrations || {};
  const providerConfig = integrations[pluginName];

  if (!providerConfig) {
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({
          success: false,
          plugin: pluginName,
          error: "Plugin not configured. Configure with: sudocode plugin configure " + pluginName,
        })
      );
    } else {
      console.error(
        chalk.red(`✗ Plugin '${pluginName}' not configured.`)
      );
      console.log(chalk.gray(`Configure with: sudocode plugin configure ${pluginName} --set path=.beads`));
    }
    return;
  }

  if (!ctx.jsonOutput) {
    console.log(chalk.blue(`Testing plugin '${pluginName}'...`));
  }

  // Get project root (parent of .sudocode)
  const projectPath = ctx.outputDir.replace(/[/\\]\.sudocode$/, "");

  // Run the test
  const result = await testProviderConnection(pluginName, providerConfig, projectPath);

  if (ctx.jsonOutput) {
    console.log(
      JSON.stringify({
        plugin: pluginName,
        ...result,
      })
    );
  } else {
    if (result.success) {
      console.log(chalk.green(`✓ Plugin '${pluginName}' test passed`));
      if (result.details) {
        console.log();
        console.log(chalk.bold("Details:"));
        for (const [key, value] of Object.entries(result.details)) {
          console.log(chalk.gray(`  ${key}: ${JSON.stringify(value)}`));
        }
      }
    } else {
      console.error(chalk.red(`✗ Plugin '${pluginName}' test failed`));
      if (result.error) {
        console.error(chalk.gray(`  Error: ${result.error}`));
      }
    }
  }
}

/**
 * Show detailed info about a plugin including its config schema
 */
export async function handlePluginInfo(
  ctx: CommandContext,
  pluginName: string
): Promise<void> {
  const plugin = await loadPlugin(pluginName);

  if (!plugin) {
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({
          success: false,
          plugin: pluginName,
          error: "Plugin not installed",
        })
      );
    } else {
      console.error(chalk.red(`✗ Plugin '${pluginName}' not installed`));
      console.log(chalk.gray(`Install with: sudocode plugin install ${pluginName}`));
    }
    return;
  }

  // Get current config if exists
  const config = getConfig(ctx.outputDir);
  const integrations: IntegrationsConfig = config.integrations || {};
  const currentConfig = integrations[pluginName];

  if (ctx.jsonOutput) {
    console.log(
      JSON.stringify({
        success: true,
        plugin: {
          name: plugin.name,
          displayName: plugin.displayName,
          version: plugin.version,
          description: plugin.description,
          configSchema: plugin.configSchema,
        },
        configured: !!currentConfig,
        currentConfig,
      })
    );
  } else {
    console.log(chalk.blue.bold(plugin.displayName));
    console.log(chalk.gray(plugin.description || "No description"));
    console.log();
    console.log(`  ${chalk.bold("Version:")} ${plugin.version}`);
    console.log(`  ${chalk.bold("Package:")} ${resolvePluginPath(pluginName)}`);
    console.log(`  ${chalk.bold("Configured:")} ${currentConfig ? chalk.green("Yes") : chalk.yellow("No")}`);

    if (currentConfig) {
      console.log(`  ${chalk.bold("Enabled:")} ${currentConfig.enabled ? chalk.green("Yes") : chalk.gray("No")}`);
    }

    console.log();

    // Show config schema
    if (plugin.configSchema) {
      console.log(chalk.bold("Configuration Options:"));
      console.log();

      for (const [key, prop] of Object.entries(plugin.configSchema.properties)) {
        const isRequired = plugin.configSchema.required?.includes(key) || prop.required;
        const reqLabel = isRequired ? chalk.red("*") : "";

        console.log(`  ${chalk.cyan(key)}${reqLabel} (${prop.type})`);
        if (prop.description) {
          console.log(`    ${chalk.gray(prop.description)}`);
        }
        if (prop.default !== undefined) {
          console.log(`    ${chalk.gray(`Default: ${JSON.stringify(prop.default)}`)}`);
        }
        console.log();
      }

      console.log(chalk.gray("* = required"));
    }

    // Show example command
    console.log();
    console.log(chalk.bold("Quick Start:"));

    if (!currentConfig) {
      // Build example command from schema
      const exampleOpts: string[] = [];
      if (plugin.configSchema) {
        for (const [key, prop] of Object.entries(plugin.configSchema.properties)) {
          const isRequired = plugin.configSchema.required?.includes(key) || prop.required;
          if (isRequired) {
            const example = prop.default ?? (prop.type === "string" ? `<${key}>` : "");
            exampleOpts.push(`--set ${key}=${example}`);
          }
        }
      }
      console.log(chalk.gray(`  sudocode plugin configure ${pluginName} ${exampleOpts.join(" ")}`));
    } else {
      console.log(chalk.gray(`  sudocode plugin test ${pluginName}`));
    }
  }
}
