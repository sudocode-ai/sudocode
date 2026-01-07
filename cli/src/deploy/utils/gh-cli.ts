/**
 * GitHub CLI utilities for Codespace lifecycle management
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Sleep utility for polling operations
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a command asynchronously
 */
export async function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  return execPromise(command);
}

/**
 * Configuration for creating a Codespace
 */
export interface CodespaceConfig {
  repository: string;      // owner/repo format
  machine: string;         // e.g., 'basicLinux32gb'
  idleTimeout: number;     // minutes (max 240)
  retentionPeriod: number; // days
}

/**
 * Information about a Codespace
 */
export interface CodespaceInfo {
  name: string;           // e.g., 'friendly-space-abc123'
  url: string;            // https://<name>.github.dev
  state: string;          // 'Available', 'Starting', etc.
  repository?: string;    // owner/repo format
  createdAt?: string;     // ISO timestamp
}

/**
 * Verify GitHub CLI is installed
 */
export async function checkGhCliInstalled(): Promise<void> {
  try {
    await execAsync('gh --version');
  } catch {
    throw new Error('GitHub CLI not found. Install from https://cli.github.com');
  }
}

/**
 * Verify GitHub authentication
 */
export async function checkGhAuthenticated(): Promise<void> {
  try {
    await execAsync('gh auth status');
  } catch {
    throw new Error('Not authenticated with GitHub. Run: gh auth login');
  }
}

/**
 * Get current repository in owner/repo format
 */
export async function getCurrentGitRepo(): Promise<string> {
  let stdout: string;

  try {
    const result = await execAsync('git remote get-url origin');
    stdout = result.stdout;
  } catch (error) {
    throw new Error('Not a git repository or no origin remote found');
  }

  const url = stdout.trim();

  // Parse both SSH and HTTPS formats
  // git@github.com:owner/repo.git
  // https://github.com/owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);

  if (!match) {
    throw new Error('Not a GitHub repository');
  }

  return match[1];
}

/**
 * Create a new Codespace with the specified configuration
 */
export async function createCodespace(config: CodespaceConfig): Promise<CodespaceInfo> {
  const cmd = [
    'gh codespace create',
    `--repo ${config.repository}`,
    `--machine ${config.machine}`,
    `--idle-timeout ${config.idleTimeout}m`,
    `--retention-period ${config.retentionPeriod}d`,
    '--json name,state'
  ].join(' ');

  try {
    const { stdout } = await execAsync(cmd);
    const result = JSON.parse(stdout);

    return {
      name: result.name,
      url: `https://${result.name}.github.dev`,
      state: result.state
    };
  } catch (error: any) {
    throw new Error(`Failed to create Codespace: ${error.message}`);
  }
}

/**
 * Poll Codespace status until it reaches "Available" state
 */
export async function waitForCodespaceReady(
  name: string,
  maxRetries: number = 30
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { stdout } = await execAsync('gh codespace list --json name,state');

      const codespaces = JSON.parse(stdout);
      const cs = codespaces.find((c: any) => c.name === name);

      if (!cs) {
        throw new Error(`Codespace ${name} not found`);
      }

      if (cs.state === 'Available') {
        return;
      }

      // Log progress
      if (i % 5 === 0) {
        console.log(`Waiting for Codespace ${name} to be ready... (state: ${cs.state})`);
      }
    } catch (error: any) {
      // If we can't list codespaces, rethrow immediately
      if (!error.message.includes('not found')) {
        throw new Error(`Failed to check Codespace status: ${error.message}`);
      }
    }

    await sleep(2000);
  }

  throw new Error(`Codespace ${name} did not become ready after ${maxRetries * 2}s`);
}

/**
 * Delete a Codespace
 */
export async function deleteCodespace(name: string): Promise<void> {
  try {
    await execAsync(`gh codespace delete --codespace ${name} --force`);
  } catch (error: any) {
    throw new Error(`Failed to delete Codespace ${name}: ${error.message}`);
  }
}

/**
 * List all Codespaces for the current user
 */
export async function listCodespaces(): Promise<CodespaceInfo[]> {
  try {
    const { stdout } = await execAsync(
      'gh codespace list --json name,repository,state,createdAt'
    );

    const codespaces = JSON.parse(stdout);

    return codespaces.map((cs: any) => ({
      name: cs.name,
      url: `https://${cs.name}.github.dev`,
      state: cs.state,
      repository: cs.repository,
      createdAt: cs.createdAt
    }));
  } catch (error: any) {
    throw new Error(`Failed to list Codespaces: ${error.message}`);
  }
}

/**
 * Set port visibility for a Codespace port
 * @param name Codespace name
 * @param port Port number
 * @param visibility Visibility setting ('public' or 'private')
 */
export async function setPortVisibility(
  name: string,
  port: number,
  visibility: 'public' | 'private'
): Promise<void> {
  try {
    await execAsync(
      `gh codespace ports visibility ${port}:${visibility} --codespace ${name}`
    );
  } catch (error: any) {
    throw new Error(
      `Failed to set port ${port} visibility to ${visibility} for Codespace ${name}: ${error.message}`
    );
  }
}

/**
 * Get the forwarded HTTPS URL for a Codespace port
 * Uses predictable URL format: https://<name>-<port>.app.github.dev
 * @param name Codespace name
 * @param port Port number
 * @returns HTTPS URL for the forwarded port
 */
export async function getCodespacePortUrl(
  name: string,
  port: number
): Promise<string> {
  // URL format is predictable based on i-886l findings
  return `https://${name}-${port}.app.github.dev`;
}

/**
 * Poll a URL until it returns a successful response
 * Ignores all errors during polling (connection refused, 404, 401, etc.)
 * @param url URL to check
 * @param maxRetries Maximum number of retry attempts (default: 10, i.e., 20 seconds at 2s intervals)
 */
export async function waitForUrlAccessible(
  url: string,
  maxRetries: number = 10
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      // Non-ok response, continue polling
    } catch {
      // Ignore all errors (connection refused, network errors, etc.)
    }

    await sleep(2000);
  }

  throw new Error(`URL ${url} not accessible after ${maxRetries * 2}s`);
}
