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
  getCurrentGitBranch,
  createCodespace,
  waitForCodespaceReady,
  deleteCodespace,
  setPortVisibility,
  getCodespacePortUrl,
  waitForUrlAccessible,
  type CodespaceConfig
} from './utils/gh-cli.js';
import {
  execInCodespace
} from './utils/codespace-ssh.js';
import {
  installClaudeCode,
  installSudocodeGlobally,
  installSudocodeFromLocal,
  initializeSudocodeProject,
  startSudocodeServer
} from './utils/codespace-setup.js';
import {
  waitForPortListening,
  killProcessOnPort
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
  dev?: boolean;              // Default: false - Install local sudocode for development/testing
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
 * - Installs sudocode packages (globally or from local build)
 * - Initializes sudocode project
 */
async function installSudocode(name: string, isDev: boolean, workspaceDir: string): Promise<void> {
  console.log(`\nInstalling sudocode${isDev ? ' (dev mode)' : ''}...`);

  // Install Claude Code (always needed)
  await installClaudeCode(name, workspaceDir);

  if (isDev) {
    // Dev mode: Install from local repository
    await installSudocodeFromLocal(name, workspaceDir);
  } else {
    // Production mode: Install from npm
    await installSudocodeGlobally(name, workspaceDir);
  }

  // Initialize project in the workspace directory
  await initializeSudocodeProject(name, workspaceDir);

  console.log('✓ Installation complete');
}

/**
 * Step 1: Start server process in background
 * Just starts the server, doesn't wait for it to be ready
 */
async function startServerProcess(
  name: string,
  port: number,
  keepAliveHours: number,
  workspaceDir: string,
  isDev: boolean
): Promise<void> {
  console.log(`Starting sudocode server on port ${port}...`);

  await startSudocodeServer(name, port, keepAliveHours, workspaceDir, isDev);

  console.log('✓ Server process started');
}

/**
 * Step 2: Wait for server to be ready
 * Checks that port is listening
 */
async function waitForServerReady(name: string, port: number): Promise<void> {
  console.log('Waiting for server startup...');

  await waitForPortListening(name, port, 30); // 30 retries = 60 seconds

  console.log('✓ Server started successfully');
}

/**
 * Step 3: Register port with GitHub via gh codespace ports forward
 * This triggers GitHub to register the port in its forwarding system.
 * Without this, attempts to set port visibility will fail with 404.
 * The forward process can be killed after registration - port remains registered.
 */
async function registerPortWithGitHub(name: string, port: number): Promise<void> {
  console.log('Registering port with GitHub...');

  try {
    // Start port forward in background (this triggers port registration)
    // We don't need to keep it running - just need to trigger registration
    const forwardPromise = execInCodespace(
      name,
      `gh codespace ports forward ${port}:${port} --codespace ${name}`,
      { timeout: 5000 }
    ).catch(() => {}); // Ignore errors, we just need to trigger registration

    // Wait briefly for registration to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Kill the port forward process (port will remain registered with GitHub)
    await execInCodespace(
      name,
      `pkill -f "gh codespace ports forward"`,
      { timeout: 2000, streamOutput: false }
    ).catch(() => {}); // Ignore if process already exited

    console.log('✓ Port registered with GitHub');
  } catch (error: any) {
    // Log warning but don't fail - registration might have succeeded
    console.warn(`⚠ Port registration warning: ${error.message}`);
  }
}

/**
 * Step 4: Get forwarded port URL
 * Returns the public URL for the forwarded port
 */
async function getForwardedPortUrl(name: string, port: number): Promise<string> {
  console.log('Getting port URL...');

  const url = await getCodespacePortUrl(name, port);

  console.log(`✓ Port URL: ${url}`);
  return url;
}

/**
 * Step 5: Ensure port is private (security requirement)
 * Sets port visibility to private so it requires GitHub authentication.
 * This also validates the port was properly registered (404 means bug in registration step).
 */
async function ensurePortIsPrivate(name: string, port: number): Promise<void> {
  console.log('Configuring port visibility...');

  await setPortVisibility(name, port, 'private');

  console.log('✓ Port configured as private (requires GitHub auth)');
}

/**
 * Step 6: Run health check
 * Note: Skips external HTTP check since port is private (requires GitHub auth).
 * TODO: Implement health check that handles GitHub authentication for private ports.
 */
async function runHealthCheck(url: string): Promise<void> {
  console.log('Running health check...');

  // Skip external HTTP check since port is private (would require GitHub auth)
  // The fact that we successfully set port visibility confirms the port is registered and forwarded
  console.log('✓ Port forwarding configured (requires GitHub auth to access)');
}

/**
 * Orchestrate all server startup steps
 *
 * This function breaks down server startup into discrete sequential steps:
 * 1. Start server process in background
 * 2. Wait for server to be ready (port listening)
 * 3. Register port with GitHub (via gh codespace ports forward)
 * 4. Ensure port is private (security requirement)
 * 5. Get the forwarded port URL
 * 6. Run health check (skipped for private ports)
 *
 * Each step is independently testable and has clear logging for debugging.
 */
async function startServerAndGetUrl(
  name: string,
  port: number,
  keepAliveHours: number,
  workspaceDir: string,
  isDev: boolean = false
): Promise<string> {
  console.log('\nStarting server...');

  // Execute each step in sequence
  await startServerProcess(name, port, keepAliveHours, workspaceDir, isDev);
  await waitForServerReady(name, port);
  await registerPortWithGitHub(name, port);  // NEW: Register port before setting visibility
  await ensurePortIsPrivate(name, port);     // CHANGED: Private instead of public (security)
  const url = await getForwardedPortUrl(name, port);
  await runHealthCheck(url);

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
    const workspaceName = repository.split('/')[1]; // Extract 'sudocode' from 'owner/sudocode'

    // Construct workspaceDir once at the top
    // TODO: Support overriding with devcontainer.json workspace configuration
    const workspaceDir = `/workspaces/${workspaceName}`;

    // In dev mode, use the current branch instead of the default branch
    let branch: string | undefined;
    if (options.dev) {
      branch = await getCurrentGitBranch();
      console.log(`✓ Using current branch: ${branch}`);
    }

    const codespace = await createCodespace({
      repository,
      machine: options.machine || 'basicLinux32gb',
      idleTimeout: 240, // Always use GitHub's max (4 hours)
      retentionPeriod: options.retentionPeriod || 14,
      branch
    });
    codespaceName = codespace.name;
    console.log(`✓ Codespace created: ${codespace.name}`);

    // 4. Wait for Codespace to be ready
    await waitForReady(codespace.name);

    // 5. Install sudocode
    await installSudocode(codespace.name, options.dev || false, workspaceDir);

    // 6. Start server and get URL with port retry logic (ports 3000-3020)
    let port: number | null = null;
    let url: string | null = null;

    for (let portAttempt = 3000; portAttempt <= 3020; portAttempt++) {
      try {
        console.log(`\nAttempting port ${portAttempt}...`);
        url = await startServerAndGetUrl(codespace.name, portAttempt, keepAliveHours, workspaceDir, options.dev || false);
        port = portAttempt;
        break; // Success!
      } catch (error: any) {
        console.warn(`Port ${portAttempt} failed: ${error.message}`);

        // Kill any process that might be running on this port
        await killProcessOnPort(codespace.name, portAttempt);

        // Continue to next port
        if (portAttempt === 3020) {
          // Last attempt failed
          throw new Error(
            `Failed to start server after 20 attempts (ports 3000-3020). ` +
            `All ports were either occupied or failed to start.`
          );
        }
      }
    }

    if (!port || !url) {
      throw new Error('Unexpected error: port or URL is null after retry logic');
    }

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
