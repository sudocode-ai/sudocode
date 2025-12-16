/**
 * Helper utilities for sandbox integration tests
 *
 * Provides utilities for testing sandbox-runtime integration:
 * - execSandboxed: Execute commands with sandbox-runtime wrapper
 * - getDefaultAllowedDomains: Get the default list of allowed domains
 *
 * @module tests/integration/sandbox-helpers
 */

import { spawn } from 'child_process';

/**
 * Configuration for sandbox execution
 */
export interface SandboxConfig {
  /** Directories allowed for read access */
  allowRead?: string[];
  /** Directories allowed for write access */
  allowWrite?: string[];
  /** Domains allowed for network access */
  allowedDomains?: string[];
  /** Unix sockets allowed for access (e.g., Docker socket) */
  allowUnixSockets?: string[];
  /** Path to violation log file (macOS only) */
  violationLog?: string;
}

/**
 * Result of a sandbox execution
 */
export interface ExecResult {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code */
  exitCode: number;
}

/**
 * Execute a command wrapped with sandbox-runtime (srt)
 *
 * This function executes a command with the sandbox-runtime wrapper,
 * configuring permissions via environment variables.
 *
 * @param command - The command to execute
 * @param config - Sandbox configuration
 * @returns Promise resolving to execution result
 *
 * @example
 * ```typescript
 * const result = await execSandboxed('cat test.txt', {
 *   allowRead: ['/tmp/test'],
 *   allowWrite: ['/tmp/test']
 * });
 *
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('file contents');
 * ```
 */
export async function execSandboxed(
  command: string,
  config: SandboxConfig = {}
): Promise<ExecResult> {
  const env: Record<string, string> = { ...process.env };

  // Set read permissions
  if (config.allowRead && config.allowRead.length > 0) {
    env.SRT_ALLOWED_READ = config.allowRead.join(',');
  }

  // Set write permissions
  if (config.allowWrite && config.allowWrite.length > 0) {
    env.SRT_ALLOWED_WRITE = config.allowWrite.join(',');
  }

  // Set allowed domains for network access
  if (config.allowedDomains && config.allowedDomains.length > 0) {
    env.SRT_ALLOWED_DOMAINS = config.allowedDomains.join(',');
  }

  // Set allowed Unix sockets
  if (config.allowUnixSockets && config.allowUnixSockets.length > 0) {
    env.SRT_ALLOWED_UNIX_SOCKETS = config.allowUnixSockets.join(',');
  }

  // Set violation log path (macOS only)
  if (config.violationLog) {
    env.SRT_VIOLATION_LOG = config.violationLog;
  }

  return new Promise((resolve) => {
    const proc = spawn('srt', [command], { env, shell: true });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode || 0 });
    });

    proc.on('error', (error) => {
      // If srt is not found, resolve with error information
      resolve({
        stdout: '',
        stderr: `Failed to execute srt: ${error.message}`,
        exitCode: 127,
      });
    });
  });
}

/**
 * Get the default list of allowed domains
 *
 * Returns the default domains that should be allowed for network access
 * in sandboxed environments. These are common package registries and APIs
 * that agents typically need to access.
 *
 * @returns Array of allowed domain names
 *
 * @example
 * ```typescript
 * const defaults = getDefaultAllowedDomains();
 * const customDomains = ['api.example.com'];
 * const allDomains = [...defaults, ...customDomains];
 * ```
 */
export function getDefaultAllowedDomains(): string[] {
  return [
    // Anthropic API
    'api.anthropic.com',

    // GitHub
    'github.com',
    'api.github.com',
    'raw.githubusercontent.com',

    // Package Registries
    'registry.npmjs.org',
    'pypi.org',
    'files.pythonhosted.org',
    'rubygems.org',
    'crates.io',

    // Language Documentation
    'docs.python.org',
    'docs.npmjs.com',
    'doc.rust-lang.org',
    'golang.org',

    // Common CDNs and Resources
    'cdn.jsdelivr.net',
    'unpkg.com',
    'cdnjs.cloudflare.com',

    // Other common services
    'stackoverflow.com',
    'developer.mozilla.org',
  ];
}

/**
 * Check if sandbox-runtime (srt) is available
 *
 * @returns Promise resolving to true if srt is available
 */
export async function isSrtAvailable(): Promise<boolean> {
  try {
    const result = await execSandboxed('echo "test"', {});
    return result.exitCode === 0 && result.stdout.includes('test');
  } catch {
    return false;
  }
}

/**
 * Skip test if sandbox-runtime is not available
 *
 * Helper function to skip tests when srt is not installed.
 * Use in beforeEach or at the start of tests.
 *
 * @example
 * ```typescript
 * test('sandbox test', async () => {
 *   if (await shouldSkipSandboxTest()) {
 *     console.log('Skipping: srt not available');
 *     return;
 *   }
 *   // ... test code
 * });
 * ```
 */
export async function shouldSkipSandboxTest(): Promise<boolean> {
  const available = await isSrtAvailable();
  if (!available) {
    console.log('⚠️  Skipping sandbox test: srt (sandbox-runtime) not available');
    console.log('Install with: npm install -g @anthropic-ai/sandbox-runtime');
  }
  return !available;
}
