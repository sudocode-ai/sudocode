/**
 * OpenAI Codex Configuration Builder
 *
 * Utility for building ProcessConfig specific to OpenAI Codex CLI.
 * Provides type-safe configuration for Codex's flags and options.
 *
 * Based on agent-execution-engine implementation.
 */

import type { ProcessConfig } from 'agent-execution-engine/process';
import type { CodexConfig } from '@sudocode-ai/types/agents';

/**
 * Build a generic ProcessConfig from Codex specific configuration
 *
 * @param config - Codex specific configuration
 * @returns Generic ProcessConfig that can be used with any ProcessManager
 *
 * @example
 * ```typescript
 * const config = buildCodexConfig({
 *   workDir: '/path/to/project',
 *   exec: true,
 *   json: true,
 *   fullAuto: true,
 * });
 *
 * const process = await manager.acquireProcess(config);
 * ```
 */
export function buildCodexConfig(config: CodexConfig): ProcessConfig {
  const args: string[] = [];

  // Add 'exec' subcommand for non-interactive mode
  if (config.exec !== false) {
    args.push('exec');

    // Add '-' to explicitly read prompt from stdin
    // This prevents the "Reading prompt from stdin..." blocking message
    if (!config.prompt) {
      args.push('-');
    }
  }

  // Add --json flag for structured output
  if (config.json) {
    args.push('--json');
  }

  // Add --experimental-json flag (alternative to --json)
  if (config.experimentalJson) {
    args.push('--experimental-json');
  }

  // Add --output-last-message flag
  if (config.outputLastMessage) {
    args.push('--output-last-message', config.outputLastMessage);
  }

  // Add --model flag
  if (config.model) {
    args.push('--model', config.model);
  }

  // Add --sandbox flag
  if (config.sandbox) {
    args.push('--sandbox', config.sandbox);
  }

  // Add --ask-for-approval flag
  if (config.askForApproval) {
    args.push('--ask-for-approval', config.askForApproval);
  }

  // Add --full-auto flag (shortcut for workspace-write + on-failure)
  if (config.fullAuto) {
    args.push('--full-auto');
  }

  // Add --skip-git-repo-check flag
  if (config.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }

  // Add --color flag
  if (config.color) {
    args.push('--color', config.color);
  }

  // Add --search flag for web browsing
  if (config.search) {
    args.push('--search');
  }

  // Add --image flag(s) for image attachments
  if (config.image && config.image.length > 0) {
    args.push('--image', config.image.join(','));
  }

  // Add --profile flag
  if (config.profile) {
    args.push('--profile', config.profile);
  }

  // Add --add-dir flag(s) for additional directories
  if (config.addDir && config.addDir.length > 0) {
    config.addDir.forEach((dir) => {
      args.push('--add-dir', dir);
    });
  }

  // Add --yolo flag (disable all safety checks)
  if (config.yolo) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }

  // Add prompt as the last argument (if provided)
  if (config.prompt) {
    args.push(config.prompt);
  }

  return {
    executablePath: config.codexPath || 'codex',
    args,
    workDir: config.workDir,
    env: config.env,
    timeout: config.timeout,
    idleTimeout: config.idleTimeout,
    retry: config.retry,
  };
}
