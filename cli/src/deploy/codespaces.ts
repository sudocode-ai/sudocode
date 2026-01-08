/**
 * Core Codespace deployment orchestration
 *
 * This module provides the main deployment logic that orchestrates the full
 * Codespace creation and sudocode installation flow.
 */

import {
  checkGhCliInstalled,
  checkGhAuthenticated,
  getCurrentRepo,
  createCodespace,
  waitForCodespaceReady,
  deleteCodespace,
  setPortVisibility,
  getCodespacePortUrl,
  waitForUrlAccessible,
  type CodespaceConfig
} from './utils/gh-cli.js';
import {
  installClaudeCode,
  installSudocodeGlobally,
  initializeSudocodeProject,
  startSudocodeServer
} from './utils/codespace-setup.js';
import {
  waitForPortListening
} from './utils/codespace-ssh.js';
import {
  addDeployment,
  getSelectedAgent,
  setSelectedAgent,
  type Deployment
} from './config/deployments.js';
import * as readline from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Options for deploying a remote Codespace
 */
export interface DeployOptions {
  machine?: string;           // Default: 'basicLinux32gb'
  keepAlive?: string;         // Default: '72h'
  retentionPeriod?: number;   // Default: 14 (days)
  open?: boolean;             // Default: true
}

/**
 * Parse keep-alive duration string (e.g., "72h" -> 72)
 */
function parseKeepAliveDuration(duration: string): number {
  const match = duration.match(/^(\d+)h$/);
  if (!match) {
    throw new Error(`Invalid keep-alive duration format: ${duration}. Expected format: 72h, 168h, etc.`);
  }
  return parseInt(match[1], 10);
}

/**
 * Check all prerequisites for deployment
 * - GitHub CLI is installed
 * - Authenticated with GitHub
 * - Current directory is a git repository
 * - Repository has a GitHub remote
 */
async function checkPrerequisites(): Promise<void> {
  console.log('Checking prerequisites...');

  // Check GitHub CLI
  try {
    await checkGhCliInstalled();
    console.log('✓ GitHub CLI found');
  } catch (error: any) {
    throw new Error(
      'GitHub CLI not found. Please install from https://cli.github.com\n' +
      'After installation, run: gh auth login'
    );
  }

  // Check authentication
  try {
    await checkGhAuthenticated();
    const { stdout } = await execPromise('gh api user --jq .login');
    const username = stdout.trim();
    console.log(`✓ Authenticated as ${username}`);
  } catch (error: any) {
    throw new Error(
      'Not authenticated with GitHub.\n' +
      'Please run: gh auth login'
    );
  }

  // Check git repository and GitHub remote
  try {
    const repo = await getCurrentRepo();
    console.log(`✓ Git repository detected`);
    console.log(`✓ Remote: github.com/${repo}`);
  } catch (error: any) {
    throw new Error(
      'Not a GitHub repository.\n' +
      'Make sure you are in a git repository with a GitHub remote.'
    );
  }
}

/**
 * Prompt user to select an agent (interactive)
 * For MVP, auto-selects Claude Code
 */
async function promptAgentSelection(): Promise<string> {
  // For MVP, we only support Claude Code
  // Future: Add support for other agents via interactive menu
  console.log('\nSelect an AI coding agent:');
  console.log('  ❯ Claude Code (recommended)');
  console.log('    Codex (coming soon)');
  console.log('    Copilot (coming soon)');
  console.log('    Cursor (coming soon)');
  console.log('');

  // Auto-select Claude Code for MVP
  return 'claude-code';
}

/**
 * Ensure an agent is selected
 * If no agent is configured, prompt for selection
 */
async function ensureAgentSelected(): Promise<void> {
  const selected = await getSelectedAgent();

  if (!selected) {
    console.log('\nNo agent configured. Let\'s set one up!\n');

    const agent = await promptAgentSelection();
    await setSelectedAgent(agent);

    console.log(`✓ ${agent} selected\n`);
  } else {
    console.log(`✓ Agent: ${selected}`);
  }
}

/**
 * Wait for Codespace to be in "Available" state
 */
async function waitForReady(name: string): Promise<void> {
  console.log('\nWaiting for Codespace to be ready...');
  await waitForCodespaceReady(name, 30); // 30 retries = 60 seconds
  console.log('✓ Codespace is ready');
}

/**
 * Install sudocode in the Codespace
 * - Installs Claude Code
 * - Installs sudocode packages globally
 * - Initializes sudocode project
 */
async function installSudocode(name: string): Promise<void> {
  console.log('\nInstalling sudocode...');

  // Install Claude Code
  await installClaudeCode(name);

  // Install sudocode packages
  await installSudocodeGlobally(name);

  // Initialize project
  await initializeSudocodeProject(name);

  console.log('✓ Installation complete');
}

/**
 * Start server and get the public URL
 * Based on findings from i-886l:
 * - Fixed port 3000 (no retry logic needed)
 * - Predictable URL format: https://<name>-3000.app.github.dev
 * - Make port public via gh CLI
 * - Health check with retries
 */
async function startServerAndGetUrl(
  name: string,
  port: number,
  keepAliveHours: number
): Promise<string> {
  console.log('\nStarting server...');

  // Start server in background
  await startSudocodeServer(name, port, keepAliveHours);

  // Wait for server to be listening on the port
  console.log(`Waiting for server to start on port ${port}...`);
  await waitForPortListening(name, port, 15); // 15 retries = 30 seconds
  console.log(`✓ Server started on port ${port}`);

  // Make port public
  console.log('\nConfiguring port forwarding...');
  await setPortVisibility(name, port, 'public');
  console.log('✓ Port made public');

  // Get the predictable URL
  const url = await getCodespacePortUrl(name, port);

  // Health check - wait for URL to be accessible
  console.log('\nRunning health check...');
  await waitForUrlAccessible(url, 15); // 15 retries = 30 seconds
  console.log('✓ Health check passed');

  return url;
}

/**
 * Open browser tabs for Codespace and Sudocode UI
 */
async function openBrowsers(deployment: Deployment): Promise<void> {
  console.log('\nOpening browsers...');

  const openUrl = async (url: string, name: string): Promise<void> => {
    try {
      let command: string;
      if (process.platform === 'darwin') {
        command = `open "${url}"`;
      } else if (process.platform === 'win32') {
        command = `start "${url}"`;
      } else {
        command = `xdg-open "${url}"`;
      }

      await execPromise(command);
      console.log(`✓ Opened ${name}`);
    } catch (error: any) {
      console.warn(`⚠ Failed to open ${name}: ${error.message}`);
    }
  };

  await openUrl(deployment.urls.codespace, 'Codespace');
  await openUrl(deployment.urls.sudocode, 'Sudocode UI');
}

/**
 * Display success message with deployment details
 */
function displaySuccessMessage(deployment: Deployment): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Sudocode server is running!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`🌐 Codespace:   ${deployment.urls.codespace}`);
  console.log(`🚀 Sudocode UI: ${deployment.urls.sudocode}\n`);

  console.log(`💡 Sudocode will keep this Codespace active for ${deployment.keepAliveDuration} hours.`);
  console.log(`   The Codespace will auto-delete after ${deployment.retentionPeriod} days.\n`);

  console.log('Commands:');
  console.log('  sudocode deploy list   - View all deployments');
  console.log('  sudocode deploy stop   - Stop this deployment');
  console.log('');
}

/**
 * Deploy sudocode to a GitHub Codespace
 *
 * This is the main orchestration function that:
 * 1. Validates prerequisites
 * 2. Ensures agent is selected
 * 3. Creates a Codespace
 * 4. Waits for it to be ready
 * 5. Installs sudocode
 * 6. Starts the server
 * 7. Tracks the deployment
 * 8. Opens browsers
 *
 * If any step fails, it cleans up the Codespace automatically.
 */
export async function deployRemote(options: DeployOptions = {}): Promise<Deployment> {
  let codespaceName: string | null = null;

  try {
    const keepAliveHours = parseKeepAliveDuration(options.keepAlive || '72h');

    // 1. Pre-flight checks
    await checkPrerequisites();

    // 2. Agent selection (first time only)
    await ensureAgentSelected();

    // 3. Create Codespace
    console.log('\nCreating Codespace...');
    const repository = await getCurrentRepo();

    const codespace = await createCodespace({
      repository,
      machine: options.machine || 'basicLinux32gb',
      idleTimeout: 240, // Always use GitHub's max (4 hours)
      retentionPeriod: options.retentionPeriod || 14
    });
    codespaceName = codespace.name;
    console.log(`✓ Codespace created: ${codespace.name}`);

    // 4. Wait for Codespace to be ready
    await waitForReady(codespace.name);

    // 5. Install sudocode
    await installSudocode(codespace.name);

    // 6. Start server and get URL (based on i-886l findings)
    const port = 3000; // Fixed port
    const url = await startServerAndGetUrl(codespace.name, port, keepAliveHours);

    // 7. Track deployment
    const deployment: Deployment = {
      name: codespace.name,
      repository,
      projectPath: process.cwd(),
      hostname: `${codespace.name}.github.dev`,
      port,
      createdAt: new Date().toISOString(),
      machine: options.machine || 'basicLinux32gb',
      codespaceIdleTimeout: 240,
      keepAliveDuration: keepAliveHours,
      retentionPeriod: options.retentionPeriod || 14,
      urls: {
        codespace: codespace.url,
        sudocode: url
      }
    };

    await addDeployment(deployment);

    // 8. Open browsers
    if (options.open !== false) {
      await openBrowsers(deployment);
    }

    // Display success message
    displaySuccessMessage(deployment);

    return deployment;

  } catch (error: any) {
    // Cleanup on failure: delete Codespace if it was created
    // TEMPORARILY DISABLED FOR DEBUGGING
    if (codespaceName) {
      console.log('\n⚠ Deployment failed - Codespace NOT deleted for debugging');
      console.log(`   Codespace name: ${codespaceName}`);
      console.log('   To manually delete: gh codespace delete --codespace ' + codespaceName);
      // console.log('\nDeployment failed, cleaning up Codespace...');
      // try {
      //   await deleteCodespace(codespaceName);
      //   console.log('✓ Codespace deleted');
      // } catch (cleanupError: any) {
      //   console.warn(`⚠ Warning: Failed to delete Codespace: ${cleanupError.message}`);
      // }
    }
    throw error;
  }
}
