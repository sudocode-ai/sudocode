/**
 * Deploy command handlers
 */

import chalk from "chalk";
import Table from "cli-table3";
import * as readline from "readline";
import { DeployConfigManager } from "../deploy/config.js";
import { DeployOrchestrator } from "../deploy/orchestrator.js";
import type { Deployment } from "sudopod";
import {
  formatErrorMessage,
  ConfigurationError
} from "../deploy/errors.js";

/**
 * Context passed to command handlers
 */
interface CommandContext {
  db: any;
  outputDir: string;
  jsonOutput: boolean;
}

/**
 * Options for deploy config command
 */
interface DeployConfigOptions {
  reset?: boolean;
  provider?: string;
  defaultBranch?: string;
  port?: string;
  idleTimeout?: string;
  keepAliveHours?: string;
  machine?: string;
  retentionPeriod?: string;
}

/**
 * Handle deploy config command
 * - No options: Display current config as formatted JSON
 * - With options: Update specified values and show confirmation
 * - --reset flag: Reset to default values
 */
export async function handleDeployConfig(
  context: CommandContext,
  options: DeployConfigOptions
): Promise<void> {
  const manager = new DeployConfigManager(context.outputDir);

  try {
    // Reset to defaults
    if (options.reset) {
      // Prevent combining --reset with other options
      const hasOtherOptions = !!(
        options.provider ||
        options.defaultBranch ||
        options.port ||
        options.idleTimeout ||
        options.keepAliveHours ||
        options.machine ||
        options.retentionPeriod
      );
      
      if (hasOtherOptions) {
        const errorMsg = "Error: Cannot combine --reset with other options";
        if (context.jsonOutput) {
          console.error(JSON.stringify({ error: errorMsg }));
        } else {
          console.error(chalk.red(errorMsg));
        }
        process.exit(1);
      }
      
      const config = manager.resetConfig();
      
      if (context.jsonOutput) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log(chalk.green("✓ Deploy configuration reset to defaults"));
        console.log(JSON.stringify(config, null, 2));
        console.log(chalk.gray(`\nUpdated: ${context.outputDir}/deploy-config.json`));
      }
      return;
    }

    // Check if any update options are provided
    const hasUpdates = !!(
      options.provider ||
      options.defaultBranch ||
      options.port ||
      options.idleTimeout ||
      options.keepAliveHours ||
      options.machine ||
      options.retentionPeriod
    );

    // View current config
    if (!hasUpdates) {
      const config = manager.loadConfig();
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    // Update config
    const updates: Record<string, any> = {};
    
    if (options.provider) {
      updates.provider = options.provider;
    }
    if (options.defaultBranch !== undefined) {
      updates.defaultBranch = options.defaultBranch;
    }
    if (options.port) {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new ConfigurationError(
          `Invalid port number: ${options.port}`,
          'port'
        );
      }
      updates.port = port;
    }
    if (options.idleTimeout) {
      const timeout = parseInt(options.idleTimeout, 10);
      if (isNaN(timeout) || timeout < 0) {
        throw new ConfigurationError(
          `Invalid idle timeout: ${options.idleTimeout}`,
          'idleTimeout'
        );
      }
      updates.idleTimeout = timeout;
    }
    if (options.keepAliveHours) {
      const hours = parseInt(options.keepAliveHours, 10);
      if (isNaN(hours) || hours < 0) {
        throw new ConfigurationError(
          `Invalid keep-alive hours: ${options.keepAliveHours}`,
          'keepAliveHours'
        );
      }
      updates.keepAliveHours = hours;
    }
    if (options.machine) {
      updates.machine = options.machine;
    }
    if (options.retentionPeriod) {
      const period = parseInt(options.retentionPeriod, 10);
      if (isNaN(period) || period < 0) {
        throw new ConfigurationError(
          `Invalid retention period: ${options.retentionPeriod}`,
          'retentionPeriod'
        );
      }
      updates.retentionPeriod = period;
    }

    const config = manager.updateConfig(updates);

    if (context.jsonOutput) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(chalk.green("✓ Deploy configuration updated"));
      
      // Show what was updated
      const updateMessages: string[] = [];
      if (options.provider) {
        updateMessages.push(`  Provider: ${options.provider}`);
      }
      if (options.defaultBranch !== undefined) {
        updateMessages.push(`  Default branch: ${options.defaultBranch}`);
      }
      if (options.port) {
        updateMessages.push(`  Port: ${options.port}`);
      }
      if (options.idleTimeout) {
        const minutes = parseInt(options.idleTimeout, 10);
        updateMessages.push(`  Idle timeout: ${minutes} minutes`);
      }
      if (options.keepAliveHours) {
        const hours = parseInt(options.keepAliveHours, 10);
        updateMessages.push(`  Keep-alive: ${hours} hours`);
      }
      if (options.machine) {
        updateMessages.push(`  Machine: ${options.machine}`);
      }
      if (options.retentionPeriod) {
        const days = parseInt(options.retentionPeriod, 10);
        updateMessages.push(`  Retention period: ${days} days`);
      }

      if (updateMessages.length > 0) {
        console.log(updateMessages.join("\n"));
      }
      
      console.log(chalk.gray(`Updated: ${context.outputDir}/deploy-config.json`));
    }
  } catch (error) {
    if (context.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    } else {
      // formatErrorMessage already includes consistent formatting
      const message = formatErrorMessage(error);
      console.error(chalk.red(message));
    }
    process.exit(1);
  }
}

/**
 * Options for deploy command
 */
interface DeployOptions {
  repo?: string;
  branch?: string;
  port?: number;
  machine?: string;
  idleTimeout?: number;
  keepAliveHours?: number;
  retentionPeriod?: number;
  dev?: boolean;
  noOpen?: boolean;
}

/**
 * Handle deploy command
 * Deploy sudocode to GitHub Codespaces
 */
export async function handleDeploy(
  context: CommandContext,
  options: DeployOptions
): Promise<void> {
  const orchestrator = new DeployOrchestrator(context.outputDir);

  try {
    const deployment = await orchestrator.deploy(options);

    if (context.jsonOutput) {
      console.log(JSON.stringify(deployment, null, 2));
    }
    // Success message and URLs already printed by orchestrator
  } catch (error) {
    if (context.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    }
    // Error message already printed by orchestrator with consistent formatting
    process.exit(1);
  }
}

/**
 * Handle deploy list command
 * List all active deployments
 */
export async function handleDeployList(
  context: CommandContext
): Promise<void> {
  const orchestrator = new DeployOrchestrator(context.outputDir);

  try {
    const deployments = await orchestrator.list();

    if (context.jsonOutput) {
      console.log(JSON.stringify(deployments, null, 2));
      return;
    }

    // Empty state
    if (deployments.length === 0) {
      console.log(chalk.yellow('No active deployments found.\n'));
      console.log(chalk.gray('Deploy with: sudocode deploy'));
      return;
    }

    // Display as formatted table
    console.log(chalk.bold('Active Deployments:\n'));

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
      const repo = deployment.git ? `${deployment.git.owner}/${deployment.git.repo}` : 'N/A';
      const branch = deployment.git?.branch || 'N/A';
      const status = formatStatus(deployment.status);

      table.push([
        deployment.name || deployment.id,
        repo,
        branch,
        status
      ]);
    }

    console.log(table.toString());
    console.log();
    console.log(chalk.gray('To view details: sudocode deploy status <id>'));
    console.log(chalk.gray('To stop a deployment: sudocode deploy stop <id>'));
  } catch (error) {
    if (context.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    }
    // Error message already printed by orchestrator with consistent formatting
    process.exit(1);
  }
}

/**
 * Handle deploy status command
 * Get detailed status of a specific deployment
 */
export async function handleDeployStatus(
  context: CommandContext,
  id: string
): Promise<void> {
  if (!id) {
    console.error(chalk.red('Error: Deployment ID is required'));
    console.error(chalk.gray('Usage: sudocode deploy status <id>'));
    process.exit(1);
  }

  const orchestrator = new DeployOrchestrator(context.outputDir);

  try {
    const deployment = await orchestrator.status(id);

    if (context.jsonOutput) {
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }

    // Display detailed information
    console.log(chalk.bold(`Deployment: ${deployment.name || deployment.id}\n`));
    
    console.log(`Status: ${formatStatus(deployment.status)}`);
    
    if (deployment.git) {
      console.log(`Repository: ${deployment.git.owner}/${deployment.git.repo}`);
      console.log(`Branch: ${deployment.git.branch}`);
    }
    
    if (deployment.createdAt) {
      console.log(`Created: ${deployment.createdAt}`);
    }

    if (deployment.urls) {
      console.log(chalk.bold('\nURLs:'));
      if (deployment.urls.web) {
        console.log(chalk.cyan(`  Workspace: ${deployment.urls.web}`));
      }
      if (deployment.urls.sudocode) {
        console.log(chalk.cyan(`  Sudocode:  ${deployment.urls.sudocode}`));
      }
      if (deployment.urls.ssh) {
        console.log(chalk.gray(`  SSH:       ${deployment.urls.ssh}`));
      }
    }

    // Show configuration if available
    const configInfo: string[] = [];
    
    if (deployment.keepAliveHours) {
      configInfo.push(`  Keep-alive: ${deployment.keepAliveHours} hours`);
    }
    if (deployment.idleTimeout) {
      configInfo.push(`  Idle timeout: ${deployment.idleTimeout} minutes`);
    }
    
    // Provider-specific metadata
    if (deployment.metadata?.codespaces) {
      configInfo.push(`  Machine: ${deployment.metadata.codespaces.machine}`);
      configInfo.push(`  Retention: ${deployment.metadata.codespaces.retentionPeriod} days`);
    }
    
    if (deployment.metadata?.coder) {
      configInfo.push(`  Template: ${deployment.metadata.coder.template}`);
      configInfo.push(`  Workspace ID: ${deployment.metadata.coder.workspaceId}`);
    }

    if (configInfo.length > 0) {
      console.log(chalk.bold('\nConfiguration:'));
      console.log(configInfo.join('\n'));
    }

    console.log();
  } catch (error) {
    if (context.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    }
    // Error message already printed by orchestrator with consistent formatting
    process.exit(1);
  }
}

/**
 * Options for deploy stop command
 */
interface DeployStopOptions {
  force?: boolean;
}

/**
 * Handle deploy stop command
 * Stop and delete a deployment
 */
export async function handleDeployStop(
  context: CommandContext,
  id: string,
  options: DeployStopOptions
): Promise<void> {
  if (!id) {
    console.error(chalk.red('Error: Deployment ID is required'));
    console.error(chalk.gray('Usage: sudocode deploy stop <id>'));
    process.exit(1);
  }

  const orchestrator = new DeployOrchestrator(context.outputDir);

  try {
    // Skip confirmation if --force flag is provided or in JSON mode
    if (!options.force && !context.jsonOutput) {
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

    await orchestrator.stop(id);

    if (context.jsonOutput) {
      console.log(JSON.stringify({ success: true, id }));
    } else {
      // Success message already printed by orchestrator
    }
  } catch (error) {
    if (context.jsonOutput) {
      console.error(JSON.stringify({ 
        error: formatErrorMessage(error)
      }));
    }
    // Error message already printed by orchestrator with consistent formatting
    process.exit(1);
  }
}

/**
 * Helper function to format deployment status with colors
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'running':
    case 'Available':
      return chalk.green(status);
    case 'stopped':
    case 'Shutdown':
      return chalk.gray(status);
    case 'starting':
    case 'provisioning':
    case 'Created':
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
