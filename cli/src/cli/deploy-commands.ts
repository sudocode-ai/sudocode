/**
 * CLI handlers for deploy commands
 */

import { listDeploymentsCommand, stopDeployment, cleanupDeployments } from '../deploy/commands.js';
import { deployRemote, type DeployOptions } from '../deploy/codespaces.js';

/**
 * Handle deploy remote command
 */
export async function handleDeployRemote(options: DeployOptions): Promise<void> {
  try {
    await deployRemote(options);
  } catch (error: any) {
    console.error(`\n❌ Deployment failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle deploy list command
 */
export async function handleDeployList(): Promise<void> {
  await listDeploymentsCommand();
}

/**
 * Handle deploy stop command
 */
export async function handleDeployStop(name: string): Promise<void> {
  await stopDeployment(name);
}

/**
 * Handle deploy cleanup command
 */
export async function handleDeployCleanup(): Promise<void> {
  await cleanupDeployments();
}
