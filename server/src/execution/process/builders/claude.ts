/**
 * Claude Code Configuration Builder
 *
 * Utility for building ProcessConfig specific to Claude Code CLI.
 * Provides type-safe configuration for Claude Code's flags and options.
 *
 * @module execution/process/builders/claude
 */

import type { ProcessConfig } from '../types.js';

/**
 * Configuration options specific to Claude Code CLI
 */
export interface ClaudeCodeConfig {
  /**
   * Path to Claude Code CLI executable
   * @default 'claude'
   */
  claudePath?: string;

  /**
   * Working directory for the process
   */
  workDir: string;

  /**
   * Run in non-interactive print mode
   * @default false
   */
  print?: boolean;

  /**
   * Output format (stream-json recommended for parsing)
   * @default 'text'
   */
  outputFormat?: 'stream-json' | 'json' | 'text';

  /**
   * Enable verbose output (required for stream-json with print mode)
   * @default false
   */
  verbose?: boolean;

  /**
   * Skip permission prompts
   * @default false
   */
  dangerouslySkipPermissions?: boolean;

  /**
   * Permission mode setting
   */
  permissionMode?: string;

  /**
   * Environment variables to pass to the process
   */
  env?: Record<string, string>;

  /**
   * Maximum execution time in milliseconds
   */
  timeout?: number;

  /**
   * Maximum idle time before cleanup (pool only)
   */
  idleTimeout?: number;

  /**
   * Retry configuration for failed spawns
   */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

/**
 * Build a generic ProcessConfig from Claude Code specific configuration
 *
 * @param config - Claude Code specific configuration
 * @returns Generic ProcessConfig that can be used with any ProcessManager
 *
 * @example
 * ```typescript
 * const config = buildClaudeConfig({
 *   workDir: '/path/to/project',
 *   print: true,
 *   outputFormat: 'stream-json',
 *   dangerouslySkipPermissions: true,
 * });
 *
 * const process = await manager.acquireProcess(config);
 * ```
 */
export function buildClaudeConfig(config: ClaudeCodeConfig): ProcessConfig {
  const args: string[] = [];

  // Add --print flag for non-interactive mode
  if (config.print) {
    args.push('--print');
  }

  // Add --output-format flag
  if (config.outputFormat) {
    args.push('--output-format', config.outputFormat);
  }

  // Add --verbose flag (required for stream-json with print mode)
  if (config.verbose || (config.print && config.outputFormat === 'stream-json')) {
    args.push('--verbose');
  }

  // Add --dangerously-skip-permissions flag
  if (config.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  // Add --permission-mode flag if specified
  if (config.permissionMode) {
    args.push('--permission-mode', config.permissionMode);
  }

  return {
    executablePath: config.claudePath || 'claude',
    args,
    workDir: config.workDir,
    env: config.env,
    timeout: config.timeout,
    idleTimeout: config.idleTimeout,
    retry: config.retry,
  };
}
