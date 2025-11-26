/**
 * Cursor Configuration Builder
 *
 * Utility for building ProcessConfig specific to Cursor CLI (cursor-agent).
 * Provides type-safe configuration for Cursor's flags and options.
 *
 * Based on agent-execution-engine cursor executor implementation.
 */

import type { ProcessConfig } from "agent-execution-engine/process";
import type { CursorConfig } from "@sudocode-ai/types/agents";

/**
 * Build a generic ProcessConfig from Cursor specific configuration
 *
 * @param config - Cursor specific configuration
 * @returns Generic ProcessConfig that can be used with any ProcessManager
 *
 * @example
 * ```typescript
 * const config = buildCursorConfig({
 *   workDir: '/path/to/project',
 *   force: true,
 *   model: 'sonnet-4.5',
 * });
 *
 * const process = await manager.acquireProcess(config);
 * ```
 */
export function buildCursorConfig(config: CursorConfig): ProcessConfig {
  const args: string[] = [];

  // Always use -p (print/non-interactive mode) and stream-json output
  args.push("-p");
  args.push("--output-format=stream-json");

  // Add --force flag for auto-approval
  if (config.force) {
    args.push("--force");
  }

  // Add --model flag if specified
  if (config.model) {
    args.push("--model", config.model);
  }

  return {
    executablePath: config.cursorPath || "cursor-agent",
    args,
    workDir: config.workDir,
    env: config.env,
    timeout: config.timeout,
    idleTimeout: config.idleTimeout,
    retry: config.retry,
  };
}
