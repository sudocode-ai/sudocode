/**
 * Claude Code Agent Adapter
 *
 * Implements the IAgentAdapter interface for Claude Code CLI.
 * Provides agent-specific configuration building and metadata using
 * the expanded ClaudeCodeConfig from @sudocode-ai/types.
 *
 * @module execution/adapters/claude-adapter
 */

import type {
  IAgentAdapter,
  AgentMetadata,
} from "agent-execution-engine/agents";
import type { ProcessConfig } from "agent-execution-engine/process";
import type { ClaudeCodeConfig } from "@sudocode-ai/types/agents";
import { AgentConfigUtils } from "./shared/index.js";
import {
  buildClaudeArgs,
  validateClaudeConfig,
} from "../process/builders/claude.js";

/**
 * Claude Code Adapter
 *
 * Provides configuration building and validation for Claude Code CLI.
 * Uses the expanded ClaudeCodeConfig which supports model selection,
 * tool permissions, system prompts, MCP configuration, and more.
 *
 * @example
 * ```typescript
 * const adapter = new ClaudeCodeAdapter();
 *
 * const processConfig = adapter.buildProcessConfig({
 *   workDir: '/path/to/project',
 *   print: true,
 *   outputFormat: 'stream-json',
 *   model: 'sonnet',
 *   allowedTools: ['Bash(git:*)', 'Edit', 'Read'],
 * });
 * ```
 */
export class ClaudeCodeAdapter implements IAgentAdapter<ClaudeCodeConfig> {
  /**
   * Agent metadata
   */
  readonly metadata: AgentMetadata = {
    name: "claude-code",
    displayName: "Claude",
    version: "1.0.0",
    supportedModes: ["structured", "interactive", "hybrid"],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  };

  /**
   * Build ProcessConfig from Claude Code configuration
   *
   * @param config - Claude Code configuration
   * @returns Generic ProcessConfig for process spawning
   */
  buildProcessConfig(config: ClaudeCodeConfig): ProcessConfig {
    const args = buildClaudeArgs(config);

    return AgentConfigUtils.buildBaseProcessConfig(
      config.claudePath || "claude",
      args,
      config
    );
  }

  /**
   * Validate Claude Code configuration
   *
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  validateConfig(config: ClaudeCodeConfig): string[] {
    return validateClaudeConfig(config);
  }

  /**
   * Get default configuration values
   *
   * @returns Default Claude Code configuration
   */
  getDefaultConfig(): Partial<ClaudeCodeConfig> {
    return {
      claudePath: "claude",
      print: true,
      outputFormat: "stream-json",
      verbose: true, // Required for stream-json with print
      dangerouslySkipPermissions: true,
      disallowedTools: ["AskUserQuestion"], // Block interactive prompts in executions
    };
  }
}

/**
 * Singleton instance of Claude Code adapter
 */
export const claudeCodeAdapter = new ClaudeCodeAdapter();
