/**
 * GitHub Copilot Config Builder
 *
 * Builds ProcessConfig from CopilotConfig for CLI-based execution.
 * Handles all Copilot CLI flags and options.
 *
 * @module execution/adapters/copilot
 */

import type { CopilotConfig } from '@sudocode-ai/types/agents';
import type { ProcessConfig } from 'agent-execution-engine/process';

/**
 * Build ProcessConfig from CopilotConfig
 *
 * Constructs the command and arguments for the Copilot CLI based on configuration.
 *
 * @param config - Copilot configuration
 * @returns ProcessConfig for spawning Copilot process
 *
 * @example
 * ```typescript
 * const processConfig = buildCopilotProcessConfig({
 *   workDir: '/path/to/project',
 *   model: 'gpt-4o',
 *   allowAllTools: true,
 * });
 * // Command: copilot --no-color --log-level debug --log-dir /tmp/copilot_logs/... --model gpt-4o --allow-all-tools
 * ```
 */
export function buildCopilotProcessConfig(config: CopilotConfig): ProcessConfig {
  const executable = config.copilotPath || config.executablePath || 'copilot';
  const args: string[] = [];

  // Required args for logging (needed for session ID discovery)
  args.push('--no-color');
  args.push('--log-level', 'debug');
  // Note: --log-dir will be added at execution time by the executor

  // Model selection
  if (config.model) {
    args.push('--model', config.model);
  }

  // Tool permissions
  if (config.allowAllTools) {
    args.push('--allow-all-tools');
  }

  if (config.allowTool) {
    args.push('--allow-tool', config.allowTool);
  }

  if (config.denyTool) {
    args.push('--deny-tool', config.denyTool);
  }

  // Additional directories
  if (config.addDir) {
    for (const dir of config.addDir) {
      args.push('--add-dir', dir);
    }
  }

  // MCP server configuration
  if (config.disableMcpServer) {
    for (const server of config.disableMcpServer) {
      args.push('--disable-mcp-server', server);
    }
  }

  return {
    executablePath: executable,
    args,
    workDir: config.workDir,
    env: config.env,
    timeout: config.timeout,
    idleTimeout: config.idleTimeout,
    retry: config.retry,
  };
}

/**
 * Build default CopilotConfig
 *
 * Provides sensible defaults for Copilot execution.
 *
 * @param workDir - Working directory (required)
 * @returns Default CopilotConfig
 */
export function buildDefaultCopilotConfig(workDir: string): CopilotConfig {
  return {
    workDir,
    copilotPath: 'copilot',
    allowAllTools: true, // Auto-approve for automation workflows
    model: undefined, // Use account default
  };
}

/**
 * Validate CopilotConfig
 *
 * Checks for logical conflicts and invalid values.
 *
 * @param config - Configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateCopilotConfig(config: CopilotConfig): string[] {
  const errors: string[] = [];

  // workDir is required
  if (!config.workDir) {
    errors.push('workDir is required');
  }

  // Check for conflicting tool permissions
  if (config.allowAllTools && config.allowTool) {
    errors.push('allowTool is ignored when allowAllTools is true');
  }

  if (config.allowAllTools && config.denyTool) {
    errors.push('denyTool takes precedence over allowAllTools');
  }

  // Validate addDir paths (basic check)
  if (config.addDir) {
    for (const dir of config.addDir) {
      if (!dir || dir.trim() === '') {
        errors.push('addDir contains empty path');
      }
    }
  }

  // Validate disableMcpServer
  if (config.disableMcpServer) {
    for (const server of config.disableMcpServer) {
      if (!server || server.trim() === '') {
        errors.push('disableMcpServer contains empty server name');
      }
    }
  }

  return errors;
}
