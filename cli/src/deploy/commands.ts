/**
 * Deploy command implementations for Codespace management
 */

import { listDeployments, removeDeployment, type Deployment } from './config/deployments.js';
import { listCodespaces, deleteCodespace } from './utils/gh-cli.js';

/**
 * Format a relative time string from an ISO date
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

/**
 * List all tracked deployments with their current status from GitHub
 */
export async function listDeploymentsCommand(): Promise<void> {
  const tracked = await listDeployments();

  if (tracked.length === 0) {
    console.log('No deployments found.');
    console.log('\nCreate a deployment with: sudocode deploy remote');
    return;
  }

  // Get current status from GitHub
  const statuses = await listCodespaces();

  // Merge tracked with GitHub status
  const rows = tracked.map(deployment => {
    const status = statuses.find(s => s.name === deployment.name);

    return {
      name: deployment.name,
      repository: deployment.repository,
      port: deployment.port,
      status: status?.state || 'Unknown',
      created: formatRelativeTime(deployment.createdAt)
    };
  });

  // Display table
  console.log('\nActive Deployments:\n');
  console.table(rows);

  console.log('\nTo connect: Click URL or run `gh codespace code --codespace <name>`');
  console.log('To stop:    sudocode deploy stop <name>');

  // Show URLs for active deployments
  const active = rows.filter(r => r.status === 'Available');
  if (active.length > 0) {
    console.log('\nURLs:');
    active.forEach(row => {
      const deployment = tracked.find(d => d.name === row.name)!;
      console.log(`\n${row.name}:`);
      console.log(`  Codespace:   ${deployment.urls.codespace}`);
      console.log(`  Sudocode UI: ${deployment.urls.sudocode}`);
    });
  }
}

/**
 * Stop and delete a Codespace deployment
 */
export async function stopDeployment(name: string): Promise<void> {
  console.log(`Stopping Codespace: ${name}...`);

  // Check if deployment is tracked
  const deployments = await listDeployments();
  const deployment = deployments.find(d => d.name === name);

  if (!deployment) {
    console.warn(`Warning: Deployment ${name} not found in tracking.`);
    console.log('Attempting to delete Codespace anyway...');
  }

  // Delete Codespace from GitHub
  try {
    await deleteCodespace(name);
    console.log('✓ Codespace stopped and deleted');
  } catch (error: any) {
    // If Codespace doesn't exist (404), that's okay - it was already deleted
    if (error.message.includes('404') || error.message.includes('Not Found')) {
      console.log('⚠ Codespace not found on GitHub (may have been deleted already)');
    } else {
      // For other errors, still remove from tracking but show warning
      console.warn(`⚠ Failed to delete Codespace: ${error.message}`);
    }
  }

  // Remove from tracking
  if (deployment) {
    await removeDeployment(name);
    console.log('✓ Deployment removed from tracking');
  } else {
    console.log('✓ Codespace was not being tracked');
  }
}

/**
 * Clean up deployment tracking by removing entries for deleted Codespaces
 */
export async function cleanupDeployments(): Promise<void> {
  console.log('Cleaning up deployment tracking...');

  const tracked = await listDeployments();
  const statuses = await listCodespaces();

  let cleaned = 0;

  for (const deployment of tracked) {
    const exists = statuses.some(s => s.name === deployment.name);
    if (!exists) {
      await removeDeployment(deployment.name);
      console.log(`✓ Removed deleted deployment: ${deployment.name}`);
      cleaned++;
    }
  }

  if (cleaned === 0) {
    console.log('✓ No cleanup needed');
  } else {
    console.log(`\n✓ Cleaned up ${cleaned} deployment${cleaned !== 1 ? 's' : ''}`);
  }
}
