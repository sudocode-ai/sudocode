/**
 * Claude Code Configuration Builder
 *
 * Utility for building ProcessConfig specific to Claude Code CLI.
 * Provides type-safe configuration for Claude Code's flags and options.
 *
 * @module execution/process/builders/claude
 */

import type { ProcessConfig } from 'agent-execution-engine';
import type { ClaudeCodeConfig } from '@sudocode-ai/types/agents';
import { AgentConfigUtils } from '../../adapters/shared/index.js';

// Re-export the config type for convenience
export type { ClaudeCodeConfig } from '@sudocode-ai/types/agents';

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
 *   model: 'sonnet',
 *   allowedTools: ['Bash(git:*)', 'Edit', 'Read'],
 *   dangerouslySkipPermissions: true,
 * });
 *
 * const process = await manager.acquireProcess(config);
 * ```
 */
export function buildClaudeConfig(config: ClaudeCodeConfig): ProcessConfig {
  const args = buildClaudeArgs(config);

  return AgentConfigUtils.buildBaseProcessConfig(
    config.claudePath || 'claude',
    args,
    config
  );
}

/**
 * Build Claude Code CLI arguments from configuration
 *
 * @param config - Claude Code configuration
 * @returns Array of command-line arguments
 */
export function buildClaudeArgs(config: ClaudeCodeConfig): string[] {
  const args: string[] = [];

  // === Core Execution Mode ===
  // Add --print flag for non-interactive mode
  if (config.print) {
    args.push('--print');
  }

  // === Output Configuration ===
  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--output-format', value: config.outputFormat, condition: !!config.outputFormat },
      { flag: '--verbose', condition: !!config.verbose || (!!config.print && config.outputFormat === 'stream-json') },
      { flag: '--json-schema', value: config.jsonSchema, condition: !!config.jsonSchema },
      { flag: '--include-partial-messages', condition: !!config.includePartialMessages },
    ])
  );

  // === Permissions ===
  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--dangerously-skip-permissions', condition: !!config.dangerouslySkipPermissions },
      { flag: '--allow-dangerously-skip-permissions', condition: !!config.allowDangerouslySkipPermissions },
      { flag: '--permission-mode', value: config.permissionMode, condition: !!config.permissionMode },
    ])
  );

  // === Model Configuration ===
  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--model', value: config.model, condition: !!config.model },
      { flag: '--fallback-model', value: config.fallbackModel, condition: !!config.fallbackModel },
    ])
  );

  // === Tool Permissions ===
  // --allowedTools / --allowed-tools accepts multiple values
  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push('--allowed-tools', ...config.allowedTools);
  }

  // --tools accepts multiple values
  if (config.tools && config.tools.length > 0) {
    args.push('--tools', ...config.tools);
  }

  // --disallowedTools / --disallowed-tools accepts multiple values
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--disallowed-tools', ...config.disallowedTools);
  }

  // === System Prompt ===
  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--system-prompt', value: config.systemPrompt, condition: !!config.systemPrompt },
      { flag: '--append-system-prompt', value: config.appendSystemPrompt, condition: !!config.appendSystemPrompt },
    ])
  );

  // === Directory & Context ===
  // --add-dir accepts multiple directories
  if (config.addDir && config.addDir.length > 0) {
    for (const dir of config.addDir) {
      args.push('--add-dir', dir);
    }
  }

  // === MCP Configuration ===
  // --mcp-config accepts multiple configs (paths to JSON files)
  if (config.mcpConfig && config.mcpConfig.length > 0) {
    for (const mcpCfg of config.mcpConfig) {
      args.push('--mcp-config', mcpCfg);
    }
  }

  // Support inline mcpServers config (converts to inline JSON for --mcp-config)
  // This is used by ExecutionConfig and orchestrator workflows
  const mcpServersConfig = (config as any).mcpServers as Record<string, { command: string; args?: string[]; env?: Record<string, string> }> | undefined;
  if (mcpServersConfig && Object.keys(mcpServersConfig).length > 0) {
    // Convert mcpServers format to Claude CLI mcpServers format
    const mcpConfigJson = {
      mcpServers: mcpServersConfig,
    };
    console.log("[buildClaudeArgs] Adding inline mcpServers:", {
      serverNames: Object.keys(mcpServersConfig),
    });
    args.push('--mcp-config', JSON.stringify(mcpConfigJson));
  }

  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--strict-mcp-config', condition: !!config.strictMcpConfig },
    ])
  );

  // === Session Management ===
  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--continue', condition: !!config.continue },
      { flag: '--resume', value: config.resume, condition: !!config.resume },
      { flag: '--fork-session', condition: !!config.forkSession },
      { flag: '--session-id', value: config.sessionId, condition: !!config.sessionId },
    ])
  );

  // === Advanced Settings ===
  args.push(
    ...AgentConfigUtils.buildConditionalArgs([
      { flag: '--settings', value: config.settings, condition: !!config.settings },
      { flag: '--setting-sources', value: config.settingSources, condition: !!config.settingSources },
    ])
  );

  // Debug mode - can be boolean or string filter
  if (config.debug) {
    if (typeof config.debug === 'string') {
      args.push('--debug', config.debug);
    } else {
      args.push('--debug');
    }
  }

  // === Prompt (must be last) ===
  if (config.prompt) {
    args.push(config.prompt);
  }

  // Debug logging for CLI args
  const mcpConfigIndices = args.reduce((acc: number[], arg, i) => {
    if (arg === '--mcp-config') acc.push(i);
    return acc;
  }, []);
  console.log("[buildClaudeArgs] Built CLI arguments:", {
    totalArgs: args.length,
    permissionArgs: {
      dangerouslySkipPermissions: args.includes('--dangerously-skip-permissions'),
      permissionMode: args.includes('--permission-mode') ? args[args.indexOf('--permission-mode') + 1] : 'not set',
    },
    mcpArgs: {
      hasMcpConfig: args.includes('--mcp-config'),
      mcpConfigCount: mcpConfigIndices.length,
    },
    model: args.includes('--model') ? args[args.indexOf('--model') + 1] : 'not set',
  });

  return args;
}

/**
 * Validate Claude Code configuration
 *
 * @param config - Configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateClaudeConfig(config: ClaudeCodeConfig): string[] {
  const errors = [
    ...AgentConfigUtils.validateBaseConfig(config),
    ...validateClaudeSpecific(config),
  ];

  return errors;
}

/**
 * Validate Claude-specific configuration
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors
 */
function validateClaudeSpecific(config: ClaudeCodeConfig): string[] {
  const errors: string[] = [];

  // Validate output format requirements
  if (config.outputFormat === 'stream-json' && !config.print) {
    errors.push('stream-json output format requires print mode to be enabled');
  }

  // Validate include-partial-messages requirements
  if (config.includePartialMessages) {
    if (!config.print) {
      errors.push('includePartialMessages requires print mode to be enabled');
    }
    if (config.outputFormat !== 'stream-json') {
      errors.push('includePartialMessages requires outputFormat to be stream-json');
    }
  }

  // Validate permission mode
  errors.push(
    ...AgentConfigUtils.validateEnum(
      config.permissionMode,
      ['acceptEdits', 'bypassPermissions', 'default', 'dontAsk', 'plan'] as const,
      'permissionMode'
    )
  );

  // Validate paths
  errors.push(...AgentConfigUtils.validatePaths(config.addDir, 'addDir'));
  errors.push(...AgentConfigUtils.validatePaths(config.mcpConfig, 'mcpConfig'));

  // Validate conflicting session options
  if (config.continue && config.resume) {
    errors.push('Cannot use both continue and resume options');
  }

  if (config.sessionId && (config.continue || config.resume)) {
    errors.push('sessionId cannot be used with continue or resume');
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
 * Get default Claude Code configuration
 *
 * @returns Default configuration values
 */
export function getDefaultClaudeConfig(): Partial<ClaudeCodeConfig> {
  return {
    claudePath: 'claude',
    print: true,
    outputFormat: 'stream-json',
    verbose: true, // Required for stream-json with print
    dangerouslySkipPermissions: false,
    disallowedTools: ['AskUserQuestion'], // Block interactive prompts in executions
  };
}
