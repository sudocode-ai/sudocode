/**
 * OpenAI Codex Agent Adapter
 *
 * Implements the IAgentAdapter interface for OpenAI Codex CLI.
 * Provides agent-specific configuration building and metadata.
 *
 * Based on agent-execution-engine implementation.
 */

import type {
  IAgentAdapter,
  AgentMetadata,
} from "agent-execution-engine/agents";
import type { ProcessConfig } from "agent-execution-engine/process";
import type { CodexConfig } from "@sudocode-ai/types/agents";
import { AgentConfigUtils } from "./shared/index.js";

/**
 * OpenAI Codex agent metadata
 */
const CODEX_METADATA: AgentMetadata = {
  name: "codex",
  displayName: "OpenAI Codex",
  version: ">=1.0.0",
  supportedModes: ["structured", "interactive"],
  supportsStreaming: true,
  supportsStructuredOutput: true,
};

/**
 * OpenAI Codex Agent Adapter
 *
 * Provides Codex-specific configuration building and capabilities.
 *
 * @example
 * ```typescript
 * const adapter = new CodexAdapter();
 * const config = adapter.buildProcessConfig({
 *   workDir: '/path/to/project',
 *   exec: true,
 *   json: true,
 *   fullAuto: true,
 * });
 *
 * const processManager = createProcessManager(config);
 * ```
 */
export class CodexAdapter implements IAgentAdapter<CodexConfig> {
  readonly metadata = CODEX_METADATA;

  /**
   * Build ProcessConfig from Codex-specific configuration
   *
   * @param config - Codex configuration
   * @returns Generic ProcessConfig
   */
  buildProcessConfig(config: CodexConfig): ProcessConfig {
    const args = this.buildCodexArgs(config);
    return AgentConfigUtils.buildBaseProcessConfig(
      config.codexPath || "codex",
      args,
      config
    );
  }

  /**
   * Build Codex-specific command-line arguments
   *
   * @param config - Codex configuration
   * @returns Array of command-line arguments
   */
  private buildCodexArgs(config: CodexConfig): string[] {
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

    // Add conditional flags using shared utility
    args.push(
      ...AgentConfigUtils.buildConditionalArgs([
        { flag: '--json', condition: !!config.json },
        { flag: '--experimental-json', condition: !!config.experimentalJson },
        { flag: '--output-last-message', value: config.outputLastMessage, condition: !!config.outputLastMessage },
        { flag: '--model', value: config.model, condition: !!config.model },
        { flag: '--sandbox', value: config.sandbox, condition: !!config.sandbox },
        { flag: '--ask-for-approval', value: config.askForApproval, condition: !!config.askForApproval },
        { flag: '--full-auto', condition: !!config.fullAuto },
        { flag: '--skip-git-repo-check', condition: !!config.skipGitRepoCheck },
        { flag: '--color', value: config.color, condition: !!config.color },
        { flag: '--search', condition: !!config.search },
        { flag: '--profile', value: config.profile, condition: !!config.profile },
        { flag: '--dangerously-bypass-approvals-and-sandbox', condition: !!config.yolo },
      ])
    );

    // Add --image flag(s) for image attachments
    if (config.image && config.image.length > 0) {
      args.push('--image', config.image.join(','));
    }

    // Add --add-dir flag(s) for additional directories
    if (config.addDir && config.addDir.length > 0) {
      config.addDir.forEach((dir) => {
        args.push('--add-dir', dir);
      });
    }

    // Add prompt as the last argument (if provided)
    if (config.prompt) {
      args.push(config.prompt);
    }

    return args;
  }

  /**
   * Validate Codex configuration
   *
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  validateConfig(config: CodexConfig): string[] {
    return [
      ...AgentConfigUtils.validateBaseConfig(config),
      ...this.validateCodexSpecific(config),
    ];
  }

  /**
   * Validate Codex-specific configuration
   *
   * @param config - Configuration to validate
   * @returns Array of validation errors
   */
  private validateCodexSpecific(config: CodexConfig): string[] {
    const errors: string[] = [];

    // Validate mutually exclusive JSON flags
    if (config.json && config.experimentalJson) {
      errors.push("Cannot use both json and experimentalJson flags");
    }

    // Validate fullAuto conflicts
    if (config.fullAuto && (config.sandbox || config.askForApproval)) {
      errors.push(
        "fullAuto cannot be used with sandbox or askForApproval flags"
      );
    }

    // Validate yolo conflicts
    if (
      config.yolo &&
      (config.sandbox || config.askForApproval || config.fullAuto)
    ) {
      errors.push(
        "yolo flag cannot be used with sandbox, askForApproval, or fullAuto flags"
      );
    }

    // Validate enum values using shared utility
    errors.push(
      ...AgentConfigUtils.validateEnum(
        config.sandbox,
        ["read-only", "workspace-write", "danger-full-access"] as const,
        "sandbox"
      )
    );

    errors.push(
      ...AgentConfigUtils.validateEnum(
        config.askForApproval,
        ["untrusted", "on-failure", "on-request", "never"] as const,
        "askForApproval"
      )
    );

    errors.push(
      ...AgentConfigUtils.validateEnum(
        config.color,
        ["always", "never", "auto"] as const,
        "color"
      )
    );

    // Validate paths
    errors.push(...AgentConfigUtils.validatePaths(config.addDir, "addDir"));
    errors.push(...AgentConfigUtils.validatePaths(config.image, "image"));

    // Validate timeouts
    errors.push(
      ...AgentConfigUtils.validateTimeouts(config.timeout, config.idleTimeout)
    );

    // Validate retry config
    errors.push(...AgentConfigUtils.validateRetryConfig(config.retry));

    return errors;
  }

  /**
   * Get default Codex configuration
   *
   * @returns Default configuration values
   */
  getDefaultConfig(): Partial<CodexConfig> {
    return {
      codexPath: "codex",
      exec: true, // Use non-interactive mode by default for automation
      json: true, // Enable structured output
      experimentalJson: false,
      fullAuto: true, // Auto-approve workspace changes
      skipGitRepoCheck: false,
      color: "auto",
      search: true, // Enable web browsing
      yolo: false,
    };
  }
}
