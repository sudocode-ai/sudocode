/**
 * Remote command handlers
 */

import chalk from "chalk";
import Table from "cli-table3";
import * as readline from "readline";
import { SpawnConfigManager } from "../remote/config.js";
import { SpawnOrchestrator } from "../remote/orchestrator.js";
import type { DeploymentInfo } from "../remote/orchestrator.js";
import {
  formatErrorMessage,
  ConfigurationError
} from "../remote/errors.js";

/**
 * Context passed to command handlers
 */
interface CommandContext {
  db: any;
  outputDir: string;
  jsonOutput: boolean;
}

/**
 * Options for remote spawn command
 */
export interface RemoteSpawnOptions {
  branch?: string;
  repo?: string;
  port?: number;
  machine?: string;
  idleTimeout?: number;
  keepAlive?: number;
  retention?: number;
  dev?: boolean;
}

/**
 * Options for remote config command
 */
export interface RemoteConfigOptions {
  idleTimeout?: number;
  keepAlive?: number;
  retention?: number;
  machine?: string;
  port?: number;
  reset?: boolean;
}

/**
 * Handle: sudocode remote <provider> spawn [options]
 */
export async function handleRemoteSpawn(
  ctx: CommandContext,
  provider: string,
  options: RemoteSpawnOptions
): Promise<void> {
  const orchestrator = new SpawnOrchestrator(ctx.outputDir);

  try {
    const deployment = await orchestrator.spawn({
      provider: provider as 'codespaces' | 'coder',
      branch: options.branch,
      repo: options.repo,
      port: options.port,
      machine: options.machine,
      idleTimeout: options.idleTimeout,
      keepAliveHours: options.keepAlive,
      retentionPeriod: options.retention,
      dev: options.dev,
    });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(deployment, null, 2));
    } else {
      // Display deployment information
      console.log(chalk.bold('\nDeployment Information:'));
      console.log(`  ID: ${deployment.id}`);
      console.log(`  Status: ${formatStatus(deployment.status)}`);
      
      console.log(chalk.bold('\nURLs:'));
      console.log(chalk.cyan(`  Workspace: ${deployment.urls.workspace}`));
      console.log(chalk.cyan(`  Sudocode:  ${deployment.urls.sudocode}`));
      console.log(chalk.gray(`  SSH:       ${deployment.urls.ssh}`));
      
      console.log(chalk.bold('\nConfiguration:'));
      console.log(`  Keep-alive: ${deployment.keepAliveHours} hours`);
      console.log(`  Idle timeout: ${deployment.idleTimeout} minutes`);
      console.log();
    }
  } catch (error) {
    if (ctx.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    }
    // Error message already printed by orchestrator with consistent formatting
    process.exit(1);
  }
}

/**
 * Handle: sudocode remote <provider> config [options]
 */
export async function handleRemoteConfig(
  ctx: CommandContext,
  provider: string,
  options: RemoteConfigOptions
): Promise<void> {
  const manager = new SpawnConfigManager(ctx.outputDir);

  try {
    // Validate provider
    if (provider !== 'codespaces' && provider !== 'coder') {
      throw new ConfigurationError(
        `Unknown provider '${provider}'.\nSupported providers: codespaces, coder`,
        'provider'
      );
    }

    if (provider === 'coder') {
      throw new ConfigurationError(
        "Provider 'coder' is not yet supported.\nCurrently supported: codespaces",
        'provider'
      );
    }

    // At this point, TypeScript knows provider is 'codespaces'
    const validProvider = provider as 'codespaces';

    // Reset to defaults
    if (options.reset) {
      // Prevent combining --reset with other options
      const hasOtherOptions = !!(
        options.idleTimeout ||
        options.keepAlive ||
        options.retention ||
        options.machine ||
        options.port
      );
      
      if (hasOtherOptions) {
        const errorMsg = "Error: Cannot combine --reset with other options";
        if (ctx.jsonOutput) {
          console.error(JSON.stringify({ error: errorMsg }));
        } else {
          console.error(chalk.red(errorMsg));
        }
        process.exit(1);
      }
      
      manager.resetProviderConfig(validProvider);
      const config = manager.getProviderConfig(validProvider);
      
      if (ctx.jsonOutput) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log(chalk.green(`✓ Spawn configuration reset to defaults for ${provider}`));
        console.log(JSON.stringify(config, null, 2));
        console.log(chalk.gray(`\nUpdated: ${ctx.outputDir}/spawn-config.json`));
      }
      return;
    }

    // Check if any update options are provided
    const hasUpdates = !!(
      options.idleTimeout ||
      options.keepAlive ||
      options.retention ||
      options.machine ||
      options.port
    );

    // View current config
    if (!hasUpdates) {
      const config = manager.getProviderConfig(validProvider);
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    // Update config
    const updates: Record<string, any> = {};
    
    if (options.port !== undefined) {
      if (options.port < 1024 || options.port > 65535) {
        throw new ConfigurationError(
          `Port must be between 1024 and 65535`,
          'port'
        );
      }
      updates.port = options.port;
    }
    if (options.idleTimeout !== undefined) {
      if (options.idleTimeout < 1) {
        throw new ConfigurationError(
          `Idle timeout must be at least 1 minute`,
          'idleTimeout'
        );
      }
      updates.idleTimeout = options.idleTimeout;
    }
    if (options.keepAlive !== undefined) {
      if (options.keepAlive < 1) {
        throw new ConfigurationError(
          `Keep-alive must be at least 1 hour`,
          'keepAliveHours'
        );
      }
      updates.keepAliveHours = options.keepAlive;
    }
    if (options.retention !== undefined) {
      if (options.retention < 1) {
        throw new ConfigurationError(
          `Retention period must be at least 1 day`,
          'retentionPeriod'
        );
      }
      updates.retentionPeriod = options.retention;
    }
    if (options.machine !== undefined) {
      updates.machine = options.machine;
    }

    manager.updateProviderConfig(validProvider, updates);
    const config = manager.getProviderConfig(validProvider);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(chalk.green(`✓ Spawn configuration updated for ${provider}`));
      
      // Show what was updated
      const updateMessages: string[] = [];
      if (options.port !== undefined) {
        updateMessages.push(`  Port: ${options.port}`);
      }
      if (options.idleTimeout !== undefined) {
        updateMessages.push(`  Idle timeout: ${options.idleTimeout} minutes`);
      }
      if (options.keepAlive !== undefined) {
        updateMessages.push(`  Keep-alive: ${options.keepAlive} hours`);
      }
      if (options.retention !== undefined) {
        updateMessages.push(`  Retention: ${options.retention} days`);
      }
      if (options.machine !== undefined) {
        updateMessages.push(`  Machine: ${options.machine}`);
      }

      if (updateMessages.length > 0) {
        console.log(updateMessages.join("\n"));
      }
      
      console.log(chalk.gray(`\nUpdated: ${ctx.outputDir}/spawn-config.json`));
    }
  } catch (error) {
    if (ctx.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    } else {
      const message = formatErrorMessage(error);
      console.error(chalk.red(message));
    }
    process.exit(1);
  }
}

/**
 * Handle: sudocode remote <provider> list
 */
export async function handleRemoteList(
  ctx: CommandContext,
  provider: string
): Promise<void> {
  const orchestrator = new SpawnOrchestrator(ctx.outputDir);

  try {
    const deployments = await orchestrator.list(provider as 'codespaces' | 'coder');

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(deployments, null, 2));
      return;
    }

    // Empty state
    if (deployments.length === 0) {
      console.log(chalk.yellow(`No active deployments found for ${provider}.\n`));
      console.log(chalk.gray(`Spawn with: sudocode remote ${provider} spawn`));
      return;
    }

    // Display as formatted table
    console.log(chalk.bold(`Active Deployments (${provider}):\n`));

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Repository'),
        chalk.cyan('Branch'),
        chalk.cyan('Status')
      ],
      colWidths: [25, 20, 15, 15]
    });

    for (const deployment of deployments) {
      const repo = `${deployment.git.owner}/${deployment.git.repo}`;
      const status = formatStatus(deployment.status);

      table.push([
        deployment.id,
        repo,
        deployment.git.branch,
        status
      ]);
    }

    console.log(table.toString());
    console.log();
    console.log(chalk.gray(`To view details: sudocode remote ${provider} status <id>`));
    console.log(chalk.gray(`To stop a deployment: sudocode remote ${provider} stop <id>`));
  } catch (error) {
    if (ctx.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    }
    // Error message already printed by orchestrator with consistent formatting
    process.exit(1);
  }
}

/**
 * Handle: sudocode remote <provider> status <id>
 */
export async function handleRemoteStatus(
  ctx: CommandContext,
  provider: string,
  id: string
): Promise<void> {
  if (!id) {
    console.error(chalk.red('Error: Deployment ID is required'));
    console.error(chalk.gray(`Usage: sudocode remote ${provider} status <id>`));
    process.exit(1);
  }

  const orchestrator = new SpawnOrchestrator(ctx.outputDir);

  try {
    const deployment = await orchestrator.status(provider as 'codespaces' | 'coder', id);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }

    // Display detailed information
    console.log(chalk.bold(`Deployment: ${deployment.id}`));
    console.log(`Provider: ${provider}\n`);
    
    console.log(`Status: ${formatStatus(deployment.status)}`);
    console.log(`Repository: ${deployment.git.owner}/${deployment.git.repo}`);
    console.log(`Branch: ${deployment.git.branch}`);
    console.log(`Created: ${deployment.createdAt}`);

    console.log(chalk.bold('\nURLs:'));
    console.log(chalk.cyan(`  Workspace: ${deployment.urls.workspace}`));
    console.log(chalk.cyan(`  Sudocode:  ${deployment.urls.sudocode}`));
    console.log(chalk.gray(`  SSH:       ${deployment.urls.ssh}`));

    console.log(chalk.bold('\nConfiguration:'));
    console.log(`  Port: ${deployment.urls.sudocode.match(/:(\d+)/)?.[1] || '3000'}`);
    
    // Provider-specific machine type info
    if (provider === 'codespaces') {
      // Extract from deployment if available
      console.log(`  Machine: basicLinux32gb`);
    }
    
    console.log(`  Keep-alive: ${deployment.keepAliveHours} hours`);
    console.log(`  Idle timeout: ${deployment.idleTimeout} minutes`);
    
    if (provider === 'codespaces') {
      console.log(`  Retention: 14 days`);
    }

    console.log();
  } catch (error) {
    if (ctx.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    } else {
      // Check if it's a "not found" error
      const errorMsg = formatErrorMessage(error);
      console.error(chalk.red(errorMsg));
      
      if (errorMsg.includes('not found')) {
        console.error(chalk.gray(`\nList deployments with: sudocode remote ${provider} list`));
      }
    }
    process.exit(1);
  }
}

/**
 * Handle: sudocode remote <provider> stop <id>
 */
export async function handleRemoteStop(
  ctx: CommandContext,
  provider: string,
  id: string,
  options: { force?: boolean }
): Promise<void> {
  if (!id) {
    console.error(chalk.red('Error: Deployment ID is required'));
    console.error(chalk.gray(`Usage: sudocode remote ${provider} stop <id>`));
    process.exit(1);
  }

  const orchestrator = new SpawnOrchestrator(ctx.outputDir);

  try {
    // Skip confirmation if --force flag is provided or in JSON mode
    if (!options.force && !ctx.jsonOutput) {
      const confirmed = await promptConfirmation(
        `Stop deployment ${id}?\n` +
        '  This will delete the codespace and all uncommitted changes.\n' +
        '  \n' +
        '  Continue?'
      );

      if (!confirmed) {
        console.log(chalk.gray('Cancelled.'));
        return;
      }
      console.log(); // Add blank line after confirmation
    }

    console.log('Stopping deployment...\n');
    await orchestrator.stop(provider as 'codespaces' | 'coder', id);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify({ success: true, id }));
    } else {
      console.log(chalk.green(`✓ Deployment stopped: ${id}`));
    }
  } catch (error) {
    if (ctx.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    } else {
      const errorMsg = formatErrorMessage(error);
      console.error(chalk.red(errorMsg));
      
      if (errorMsg.includes('not found')) {
        console.error(chalk.gray(`\nList deployments with: sudocode remote ${provider} list`));
      }
    }
    process.exit(1);
  }
}

/**
 * Helper function to format deployment status with colors
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'running':
      return chalk.green(status);
    case 'stopped':
      return chalk.gray(status);
    case 'starting':
    case 'provisioning':
      return chalk.yellow(status);
    case 'stopping':
      return chalk.yellow(status);
    case 'failed':
      return chalk.red(status);
    default:
      return status;
  }
}

/**
 * Helper function to prompt for yes/no confirmation
 * Returns true if user confirms, false otherwise
 * Handles Ctrl+C gracefully (returns false)
 */
function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    // Handle Ctrl+C gracefully
    const cleanupAndReject = () => {
      rl.close();
      resolve(false);
    };

    rl.on('SIGINT', cleanupAndReject);
    rl.on('close', () => {
      // If closed without answer, treat as "no"
      resolve(false);
    });

    rl.question(chalk.yellow(`⚠  ${message}`) + chalk.gray(' (y/N): '), (answer) => {
      rl.removeListener('SIGINT', cleanupAndReject);
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
