/**
 * Cursor Agent Adapter
 *
 * Implements the IAgentAdapter interface for Cursor CLI (cursor-agent).
 * Provides agent-specific configuration building and metadata.
 *
 * Based on agent-execution-engine implementation.
 */

import type {
  IAgentAdapter,
  AgentMetadata,
} from "agent-execution-engine/agents";
import type { ProcessConfig } from "agent-execution-engine/process";
import type { CursorConfig } from "@sudocode-ai/types/agents";
import { AgentConfigUtils } from "./shared/index.js";

/**
 * Cursor agent metadata
 */
const CURSOR_METADATA: AgentMetadata = {
  name: "cursor",
  displayName: "Cursor",
  version: ">=1.0.0",
  supportedModes: ["structured"], // Uses JSONL stream protocol
  supportsStreaming: true,
  supportsStructuredOutput: true, // stream-json format
};

/**
 * Cursor Agent Adapter
 *
 * Provides Cursor-specific configuration building and capabilities.
 *
 * @example
 * ```typescript
 * const adapter = new CursorAdapter();
 * const config = adapter.buildProcessConfig({
 *   workDir: '/path/to/project',
 *   force: true,
 *   model: 'sonnet-4.5',
 * });
 *
 * const processManager = createProcessManager(config);
 * ```
 */
export class CursorAdapter implements IAgentAdapter<CursorConfig> {
  readonly metadata = CURSOR_METADATA;

  /**
   * Build ProcessConfig from Cursor-specific configuration
   *
   * @param config - Cursor configuration
   * @returns Generic ProcessConfig
   */
  buildProcessConfig(config: CursorConfig): ProcessConfig {
    const args = this.buildCursorArgs(config);
    return AgentConfigUtils.buildBaseProcessConfig(
      config.cursorPath || "cursor-agent",
      args,
      config
    );
  }

  /**
   * Build Cursor-specific command-line arguments
   *
   * @param config - Cursor configuration
   * @returns Array of command-line arguments
   */
  private buildCursorArgs(config: CursorConfig): string[] {
    const args: string[] = [];

    // Always use -p (print/non-interactive mode) and stream-json output
    args.push("-p");
    args.push("--output-format=stream-json");

    // Add conditional flags
    args.push(
      ...AgentConfigUtils.buildConditionalArgs([
        { flag: "--force", condition: !!config.force },
        { flag: "--model", value: config.model, condition: !!config.model },
      ])
    );

    return args;
  }

  /**
   * Validate Cursor configuration
   *
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  validateConfig(config: CursorConfig): string[] {
    const errors = [
      ...AgentConfigUtils.validateBaseConfig(config),
      ...this.validateCursorSpecific(config),
    ];

    return errors;
  }

  /**
   * Validate Cursor-specific configuration
   *
   * @param config - Configuration to validate
   * @returns Array of validation errors
   */
  private validateCursorSpecific(config: CursorConfig): string[] {
    const errors: string[] = [];

    // Validate model if specified
    const validModels = [
      "auto",
      "sonnet-4.5",
      "sonnet-4.5-thinking",
      "gpt-5",
      "opus-4.1",
      "grok",
    ] as const;

    if (config.model && !validModels.includes(config.model as any)) {
      // Allow custom model strings, just warn
      console.warn(
        `Unknown model specified: ${config.model}. Known models: ${validModels.join(", ")}`
      );
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
   * Get default Cursor configuration
   *
   * @returns Default configuration values
   */
  getDefaultConfig(): Partial<CursorConfig> {
    return {
      cursorPath: "cursor-agent",
      force: true, // Auto-approve for automation
      model: "auto", // Let Cursor choose best model
    };
  }
}
