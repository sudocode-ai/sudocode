/**
 * SSH command execution utilities for GitHub Codespaces
 *
 * NOTE: This module uses child_process.exec() because:
 * 1. We need to execute complex shell commands via SSH
 * 2. We need real-time output streaming
 * 3. The gh CLI requires shell-style command composition
 * 4. All inputs are controlled (Codespace names from GitHub, commands from our code)
 */

import { exec } from 'child_process';

/**
 * Options for executing commands in Codespace
 */
export interface ExecOptions {
  timeout?: number;       // milliseconds (default: 120000 = 2 minutes)
  cwd?: string;           // working directory (default: repo root)
  streamOutput?: boolean; // print output in real-time (default: true)
}

/**
 * Sleep utility for polling operations
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escape shell argument for safe inclusion in command string
 * This properly escapes double quotes and backslashes
 */
function escapeShellArg(arg: string): string {
  return arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Execute a command in the Codespace via SSH and return output
 *
 * @param name - Codespace name (from GitHub API, trusted)
 * @param command - Command to execute (should be from trusted source)
 * @param options - Execution options
 * @returns Command output (stdout)
 *
 * @example
 * ```typescript
 * // Simple command
 * const output = await execInCodespace(name, 'pwd');
 *
 * // With working directory
 * await execInCodespace(name, 'npm install', { cwd: '/workspaces/myrepo' });
 *
 * // Silent execution (no streaming)
 * const result = await execInCodespace(name, 'cat package.json', { streamOutput: false });
 * ```
 */
export async function execInCodespace(
  name: string,
  command: string,
  options: ExecOptions = {}
): Promise<string> {
  const {
    timeout = 120000,
    cwd = '/workspaces/*',
    streamOutput = true
  } = options;

  // Wrap command to cd to correct directory
  const wrappedCommand = cwd
    ? `cd ${cwd} && ${command}`
    : command;

  // Properly escape the command for SSH execution
  const escapedCommand = escapeShellArg(wrappedCommand);
  const sshCommand = `gh codespace ssh --codespace ${name} -- "${escapedCommand}"`;

  return new Promise((resolve, reject) => {
    const child = exec(sshCommand, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(
          `Failed to execute in Codespace ${name}: ${command}\n${error.message}\n${stderr}`
        ));
      } else {
        resolve(stdout);
      }
    });

    // Stream output in real-time if requested
    if (streamOutput && child.stdout && child.stderr) {
      child.stdout.on('data', (data) => process.stdout.write(data));
      child.stderr.on('data', (data) => process.stderr.write(data));
    }
  });
}

/**
 * Check if a port is listening in the Codespace
 *
 * @param name - Codespace name
 * @param port - Port number to check
 * @returns true if port is listening, false otherwise
 *
 * @example
 * ```typescript
 * const isListening = await checkPortListening(name, 3000);
 * if (isListening) {
 *   console.log('Server is running');
 * }
 * ```
 */
export async function checkPortListening(
  name: string,
  port: number
): Promise<boolean> {
  try {
    const result = await execInCodespace(
      name,
      `lsof -ti:${port} > /dev/null 2>&1 && echo "1" || echo "0"`,
      { streamOutput: false }
    );
    return result.trim() === '1';
  } catch {
    return false;
  }
}

/**
 * Poll until a port is listening in the Codespace
 *
 * @param name - Codespace name
 * @param port - Port number to wait for
 * @param maxRetries - Maximum number of retries (default: 15 = 30 seconds)
 * @throws Error if port doesn't open within timeout
 *
 * @example
 * ```typescript
 * // Wait for server to start (default 30 seconds)
 * await waitForPortListening(name, 3000);
 *
 * // Custom timeout (20 retries = 40 seconds)
 * await waitForPortListening(name, 3000, 20);
 * ```
 */
export async function waitForPortListening(
  name: string,
  port: number,
  maxRetries: number = 15
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    if (await checkPortListening(name, port)) {
      return;
    }

    // Log progress every 5 retries
    if (i > 0 && i % 5 === 0) {
      console.log(`Waiting for port ${port} to be ready... (${i * 2}s elapsed)`);
    }

    await sleep(2000);
  }

  throw new Error(
    `Port ${port} not listening in Codespace ${name} after ${maxRetries * 2}s`
  );
}

/**
 * Kill any process using a specified port in the Codespace
 *
 * Silent success - does not throw if no process is using the port.
 *
 * @param name - Codespace name
 * @param port - Port number to free
 *
 * @example
 * ```typescript
 * // Kill any process on port 3000
 * await killProcessOnPort(name, 3000);
 *
 * // Safe to call even if nothing is running
 * await killProcessOnPort(name, 8080); // No error if port is free
 * ```
 */
export async function killProcessOnPort(
  name: string,
  port: number
): Promise<void> {
  try {
    await execInCodespace(
      name,
      `lsof -ti:${port} | xargs kill -9 || true`,
      { streamOutput: false }
    );
  } catch {
    // Ignore errors - port might already be free
  }
}
