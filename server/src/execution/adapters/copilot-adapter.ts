/**
 * GitHub Copilot Agent Adapter
 *
 * Adapter implementation for GitHub Copilot CLI integration.
 * Uses CopilotExecutor from agent-execution-engine for actual execution.
 *
 * @module execution/adapters/copilot
 */

import type { CopilotConfig } from '@sudocode-ai/types/agents';
import type {
  IAgentAdapter,
  AgentMetadata,
} from 'agent-execution-engine/agents';
import type { ProcessConfig } from 'agent-execution-engine/process';
import { AgentConfigUtils } from './shared/index.js';

/**
 * GitHub Copilot Agent Adapter
 *
 * Implements the IAgentAdapter interface for GitHub Copilot CLI.
 * Copilot uses a plain text streaming protocol with session ID discovery
 * via log file polling. The CopilotExecutor from agent-execution-engine
 * handles output normalization to NormalizedEntry format.
 *
 * **Key Features:**
 * - Plain text output → NormalizedEntry conversion via PlainTextLogProcessor
 * - Session ID discovery through log directory polling
 * - Native MCP support
 * - Fine-grained tool permissions
 * - Multiple model support (GPT, Claude, etc.)
 *
 * @example
 * ```typescript
 * const adapter = new CopilotAdapter();
 * const config: CopilotConfig = {
 *   workDir: '/path/to/project',
 *   model: 'gpt-4o',
 *   allowAllTools: true,
 * };
 *
 * const processConfig = adapter.buildProcessConfig(config);
 * const errors = adapter.validateConfig(config);
 * if (errors.length === 0) {
 *   // Execute with CopilotExecutor
 * }
 * ```
 */
export class CopilotAdapter implements IAgentAdapter<CopilotConfig> {
  /**
   * Agent metadata
   */
  readonly metadata: AgentMetadata = {
    name: 'copilot',
    displayName: 'GitHub Copilot',
    version: '1.0.0',
    supportedModes: ['structured', 'interactive'],
    supportsStreaming: true,
    supportsStructuredOutput: true, // Via NormalizedEntry conversion
  };

  /**
   * Build ProcessConfig from CopilotConfig
   *
   * Constructs command and arguments for spawning the Copilot CLI process.
   *
   * @param config - Copilot-specific configuration
   * @returns ProcessConfig for process spawning
   */
  buildProcessConfig(config: CopilotConfig): ProcessConfig {
    const args = this.buildCopilotArgs(config);
    return AgentConfigUtils.buildBaseProcessConfig(
      config.copilotPath || config.executablePath || 'copilot',
      args,
      config
    );
  }

  /**
   * Build Copilot-specific command-line arguments
   *
   * @param config - Copilot configuration
   * @returns Array of command-line arguments
   */
  private buildCopilotArgs(config: CopilotConfig): string[] {
    const args: string[] = [];

    // Required args for logging (needed for session ID discovery)
    args.push('--no-color');
    args.push('--log-level', 'debug');
    // Note: --log-dir will be added at execution time by the executor

    // Add conditional flags using shared utility
    args.push(
      ...AgentConfigUtils.buildConditionalArgs([
        { flag: '--model', value: config.model, condition: !!config.model },
        { flag: '--allow-all-tools', condition: !!config.allowAllTools },
        { flag: '--allow-tool', value: config.allowTool, condition: !!config.allowTool },
        { flag: '--deny-tool', value: config.denyTool, condition: !!config.denyTool },
      ])
    );

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

    return args;
  }

  /**
   * Validate CopilotConfig
   *
   * Checks for required fields, conflicting options, and invalid values.
   *
   * @param config - Configuration to validate
   * @returns Array of validation error messages (empty if valid)
   */
  validateConfig(config: CopilotConfig): string[] {
    return [
      ...AgentConfigUtils.validateBaseConfig(config),
      ...this.validateCopilotSpecific(config),
    ];
  }

  /**
   * Validate Copilot-specific configuration
   *
   * @param config - Configuration to validate
   * @returns Array of validation errors
   */
  private validateCopilotSpecific(config: CopilotConfig): string[] {
    const errors: string[] = [];

    // Check for conflicting tool permissions
    if (config.allowAllTools && config.allowTool) {
      errors.push('allowTool is ignored when allowAllTools is true');
    }

    if (config.allowAllTools && config.denyTool) {
      errors.push('denyTool takes precedence over allowAllTools');
    }

    // Validate addDir paths
    errors.push(...AgentConfigUtils.validatePaths(config.addDir, 'addDir'));

    // Validate disableMcpServer
    if (config.disableMcpServer) {
      for (const server of config.disableMcpServer) {
        if (!server || server.trim() === '') {
          errors.push('disableMcpServer contains empty server name');
        }
      }
    }

    // Validate timeouts
    errors.push(
      ...AgentConfigUtils.validateTimeouts(config.timeout, config.idleTimeout)
    );

    // Validate retry config
    errors.push(...AgentConfigUtils.validateRetryConfig(config.retry));

    return errors;
  }

  /**
   * Get default CopilotConfig
   *
   * Returns sensible defaults for Copilot execution.
   * Users should override workDir and other fields as needed.
   *
   * @returns Default configuration
   */
  getDefaultConfig(): Partial<CopilotConfig> {
    return {
      copilotPath: 'copilot',
      allowAllTools: true, // Auto-approve for automation
      model: undefined, // Use account default
    };
  }
}

/**
 * Singleton instance of CopilotAdapter
 */
export const copilotAdapter = new CopilotAdapter();
