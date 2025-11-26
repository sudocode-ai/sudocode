/**
 * Shared Agent Configuration Utilities
 *
 * Common utilities for building and validating agent configurations.
 * Reduces duplication across different agent adapters.
 *
 * @module execution/adapters/shared
 */

import type { ProcessConfig } from 'agent-execution-engine/process';
import type { BaseAgentConfig } from '@sudocode-ai/types/agents';

/**
 * Utility class for common agent configuration operations
 */
export class AgentConfigUtils {
  /**
   * Validate base configuration fields required by all agents
   *
   * @param config - Base agent configuration
   * @returns Array of validation error messages (empty if valid)
   */
  static validateBaseConfig(config: BaseAgentConfig): string[] {
    const errors: string[] = [];

    if (!config.workDir) {
      errors.push('workDir is required');
    }

    if (config.timeout !== undefined && config.timeout < 0) {
      errors.push('timeout must be a positive number');
    }

    return errors;
  }

  /**
   * Merge configuration with defaults
   *
   * @param config - User-provided configuration
   * @param defaults - Default configuration values
   * @returns Merged configuration with defaults applied
   */
  static withDefaults<T extends BaseAgentConfig>(
    config: T,
    defaults: Partial<T>
  ): T {
    return { ...defaults, ...config };
  }

  /**
   * Build ProcessConfig from common fields
   *
   * @param executable - Path to executable or command name
   * @param args - Command-line arguments
   * @param config - Agent configuration
   * @returns ProcessConfig for process spawning
   */
  static buildBaseProcessConfig(
    executable: string,
    args: string[],
    config: BaseAgentConfig
  ): ProcessConfig {
    return {
      executablePath: executable,
      args,
      workDir: config.workDir,
      env: config.env,
      timeout: config.timeout,
      // TypeScript doesn't know about these optional fields,
      // but they're in the extended configs
      idleTimeout: (config as any).idleTimeout,
      retry: (config as any).retry,
    };
  }

  /**
   * Validate timeout configuration
   *
   * @param timeout - Timeout value in milliseconds
   * @param idleTimeout - Idle timeout value in milliseconds
   * @returns Array of validation errors
   */
  static validateTimeouts(
    timeout?: number,
    idleTimeout?: number
  ): string[] {
    const errors: string[] = [];

    if (timeout !== undefined && timeout < 0) {
      errors.push('timeout must be a positive number');
    }

    if (idleTimeout !== undefined && idleTimeout < 0) {
      errors.push('idleTimeout must be a positive number');
    }

    if (
      timeout !== undefined &&
      idleTimeout !== undefined &&
      idleTimeout > timeout
    ) {
      errors.push('idleTimeout cannot be greater than timeout');
    }

    return errors;
  }

  /**
   * Validate retry configuration
   *
   * @param retry - Retry configuration object
   * @returns Array of validation errors
   */
  static validateRetryConfig(retry?: {
    maxAttempts: number;
    backoffMs: number;
  }): string[] {
    const errors: string[] = [];

    if (!retry) {
      return errors;
    }

    if (retry.maxAttempts < 0) {
      errors.push('retry.maxAttempts must be non-negative');
    }

    if (retry.backoffMs < 0) {
      errors.push('retry.backoffMs must be non-negative');
    }

    return errors;
  }

  /**
   * Validate array of paths (for addDir, image, etc.)
   *
   * @param paths - Array of file/directory paths
   * @param fieldName - Name of the field for error messages
   * @returns Array of validation errors
   */
  static validatePaths(
    paths: string[] | undefined,
    fieldName: string
  ): string[] {
    const errors: string[] = [];

    if (!paths || paths.length === 0) {
      return errors;
    }

    for (const path of paths) {
      if (!path || path.trim() === '') {
        errors.push(`${fieldName} contains empty path`);
      }
    }

    return errors;
  }

  /**
   * Validate enum value
   *
   * @param value - Value to validate
   * @param validValues - Array of valid enum values
   * @param fieldName - Name of the field for error messages
   * @returns Array of validation errors
   */
  static validateEnum<T extends string>(
    value: T | undefined,
    validValues: readonly T[],
    fieldName: string
  ): string[] {
    const errors: string[] = [];

    if (value !== undefined && !validValues.includes(value)) {
      errors.push(
        `${fieldName} must be one of: ${validValues.join(', ')}`
      );
    }

    return errors;
  }

  /**
   * Build arguments for conditional flags
   *
   * @param flags - Array of flag configurations
   * @returns Array of command-line arguments
   *
   * @example
   * ```typescript
   * const args = AgentConfigUtils.buildConditionalArgs([
   *   { flag: '--force', condition: config.force },
   *   { flag: '--model', value: config.model, condition: !!config.model },
   *   { flag: '--verbose', condition: true }, // always add
   * ]);
   * ```
   */
  static buildConditionalArgs(
    flags: Array<{
      flag: string;
      value?: string;
      condition: boolean;
    }>
  ): string[] {
    const args: string[] = [];

    for (const { flag, value, condition } of flags) {
      if (condition) {
        args.push(flag);
        if (value !== undefined) {
          args.push(value);
        }
      }
    }

    return args;
  }
}
