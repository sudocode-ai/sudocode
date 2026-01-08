/**
 * Installation and setup utilities for GitHub Codespaces
 *
 * This module provides functions for:
 * - Installing Claude Code
 * - Installing sudocode packages globally
 * - Initializing sudocode projects
 * - Starting sudocode server in background
 */

import { execInCodespace } from './codespace-ssh.js';

/**
 * Install Claude Code in the Codespace
 *
 * Uses the official installation script with a 5-minute timeout.
 * Streams output to provide visibility into installation progress.
 *
 * @param name - Codespace name
 * @throws Error if installation fails
 *
 * @example
 * ```typescript
 * await installClaudeCode('friendly-space-abc123');
 * console.log('Claude Code is ready to use');
 * ```
 */
export async function installClaudeCode(name: string): Promise<void> {
  console.log('Installing Claude Code...');

  await execInCodespace(
    name,
    'curl -fsSL https://claude.ai/install.sh | bash',
    {
      timeout: 300000,      // 5 minutes for installation
      streamOutput: true    // Show progress
    }
  );

  console.log('✓ Claude Code installed');
}

/**
 * Install sudocode packages globally in the Codespace
 *
 * Installs @sudocode-ai/cli and @sudocode-ai/local-server using npm.
 * Uses a 5-minute timeout and streams output for visibility.
 *
 * @param name - Codespace name
 * @throws Error if installation fails
 *
 * @example
 * ```typescript
 * await installSudocodeGlobally('friendly-space-abc123');
 * // Now sudocode CLI is available globally
 * ```
 */
export async function installSudocodeGlobally(name: string): Promise<void> {
  console.log('Installing sudocode packages...');

  await execInCodespace(
    name,
    'npm install -g @sudocode-ai/cli @sudocode-ai/local-server',
    {
      timeout: 300000,      // 5 minutes for npm install
      streamOutput: true    // Show progress
    }
  );

  console.log('✓ Sudocode packages installed');
}

/**
 * Initialize a sudocode project in the Codespace
 *
 * Checks if .sudocode directory exists before running `sudocode init`.
 * Skips initialization if the project is already set up.
 *
 * @param name - Codespace name
 * @throws Error if initialization fails
 *
 * @example
 * ```typescript
 * // First call creates .sudocode
 * await initializeSudocodeProject('friendly-space-abc123');
 *
 * // Second call skips initialization
 * await initializeSudocodeProject('friendly-space-abc123');
 * ```
 */
export async function initializeSudocodeProject(name: string): Promise<void> {
  console.log('Initializing sudocode project...');

  // Check if .sudocode already exists
  const exists = await execInCodespace(
    name,
    'test -d .sudocode && echo "1" || echo "0"',
    { streamOutput: false }
  );

  if (exists.trim() === '0') {
    await execInCodespace(
      name,
      'sudocode init',
      { timeout: 10000 } // 10 seconds should be plenty
    );
    console.log('✓ Project initialized');
  } else {
    console.log('✓ Project already initialized');
  }
}

/**
 * Install sudocode from local repository (dev mode)
 *
 * Builds the monorepo and makes the CLI available globally.
 * Used for development and testing of local changes.
 *
 * @param name - Codespace name
 * @throws Error if build fails
 *
 * @example
 * ```typescript
 * await installSudocodeFromLocal('friendly-space-abc123');
 * console.log('Local sudocode built and configured');
 * ```
 */
export async function installSudocodeFromLocal(name: string): Promise<void> {
  console.log('Installing sudocode from local repository...');

  // Navigate to workspace directory (Codespace clones repo to /workspaces/<repo-name>)
  // Install dependencies, build all packages, and add CLI to PATH
  const commands = [
    'cd /workspaces/*',
    'npm install',
    'npm run build',
    // Create global symlinks for CLI and server
    'npm link --prefix cli',
    'npm link --prefix server'
  ].join(' && ');

  await execInCodespace(
    name,
    commands,
    {
      timeout: 600000,      // 10 minutes for install + build
      streamOutput: true    // Show progress
    }
  );

  console.log('✓ Local sudocode built and configured');
}

/**
 * Start sudocode server in background
 *
 * Starts the server using nohup for persistence, redirecting output to a log file.
 * Returns immediately - caller should poll the port separately to verify startup.
 *
 * Command used: `sudocode server --port <port> --keep-alive <hours>h`
 * Log file location: /tmp/sudocode-<port>.log
 *
 * @param name - Codespace name
 * @param port - Port number to listen on
 * @param keepAliveHours - Keep-alive duration in hours
 * @param isDev - Whether to use local build (default: false)
 * @throws Error if server start command fails
 *
 * @example
 * ```typescript
 * // Start server in background
 * await startSudocodeServer('friendly-space-abc123', 3000, 72);
 *
 * // Wait for server to be ready (use waitForPortListening)
 * await waitForPortListening('friendly-space-abc123', 3000);
 * ```
 */
export async function startSudocodeServer(
  name: string,
  port: number,
  keepAliveHours: number,
  isDev: boolean = false
): Promise<void> {
  console.log(`Starting sudocode server on port ${port}${isDev ? ' (dev mode)' : ''}...`);

  // In dev mode, use the local build; otherwise use global install
  const serverCommand = isDev
    ? 'cd /workspaces/* && node server/dist/cli.js'
    : 'sudocode server';

  // Start in background with nohup
  // Output is redirected to /tmp/sudocode-<port>.log
  // & makes it run in background, nohup prevents hangup on SSH disconnect
  await execInCodespace(
    name,
    `nohup ${serverCommand} --port ${port} --keep-alive ${keepAliveHours}h ` +
    `> /tmp/sudocode-${port}.log 2>&1 &`,
    {
      streamOutput: false,  // No output expected from background start
      timeout: 5000         // Just starting the process, not waiting for it
    }
  );

  // Note: Does NOT wait for server to be ready - caller should use waitForPortListening
}
