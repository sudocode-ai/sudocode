/**
 * Agent Configuration Presets
 *
 * Predefined configuration profiles for common use cases.
 * Makes it easier to configure agents for specific scenarios.
 *
 * @module execution/adapters/shared
 */

import type {
  CodexConfig,
  CopilotConfig,
  CursorConfig,
  ClaudeCodeConfig,
} from '@sudocode-ai/types/agents';

/**
 * Configuration profile types
 */
export type ConfigProfile = 'safe' | 'automation' | 'development' | 'production';

/**
 * Safe preset - Maximum safety, minimal permissions
 * Use for untrusted code or when you want maximum control
 */
export const SAFE_PRESET = {
  autoApprove: false,
  skipPermissions: false,
  fullAuto: false,
} as const;

/**
 * Automation preset - Auto-approve everything for CI/CD
 * Use for automated workflows where human approval isn't feasible
 */
export const AUTOMATION_PRESET = {
  autoApprove: true,
  skipPermissions: true,
  fullAuto: true,
} as const;

/**
 * Development preset - Balanced for local development
 * Auto-approve with workspace-level permissions
 */
export const DEVELOPMENT_PRESET = {
  autoApprove: true,
  skipPermissions: false,
  fullAuto: true,
} as const;

/**
 * Production preset - Conservative for production environments
 * Similar to safe but with some automation
 */
export const PRODUCTION_PRESET = {
  autoApprove: false,
  skipPermissions: false,
  fullAuto: false,
} as const;

/**
 * Apply a configuration profile to Cursor config
 *
 * @param config - Base Cursor configuration
 * @param profile - Profile to apply
 * @returns Configuration with profile applied
 */
export function applyCursorPreset(
  config: CursorConfig,
  profile: ConfigProfile
): CursorConfig {
  const presets = {
    safe: { force: false },
    automation: { force: true },
    development: { force: true },
    production: { force: false },
  };

  return { ...config, ...presets[profile] };
}

/**
 * Apply a configuration profile to Copilot config
 *
 * @param config - Base Copilot configuration
 * @param profile - Profile to apply
 * @returns Configuration with profile applied
 */
export function applyCopilotPreset(
  config: CopilotConfig,
  profile: ConfigProfile
): CopilotConfig {
  const presets = {
    safe: { allowAllTools: false },
    automation: { allowAllTools: true },
    development: { allowAllTools: true },
    production: { allowAllTools: false },
  };

  return { ...config, ...presets[profile] };
}

/**
 * Apply a configuration profile to Codex config
 *
 * @param config - Base Codex configuration
 * @param profile - Profile to apply
 * @returns Configuration with profile applied
 */
export function applyCodexPreset(
  config: CodexConfig,
  profile: ConfigProfile
): CodexConfig {
  const presets = {
    safe: {
      sandbox: 'read-only' as const,
      askForApproval: 'untrusted' as const,
      fullAuto: false,
      yolo: false,
    },
    automation: {
      sandbox: 'workspace-write' as const,
      askForApproval: 'never' as const,
      fullAuto: true,
      yolo: false,
    },
    development: {
      sandbox: 'workspace-write' as const,
      askForApproval: 'on-failure' as const,
      fullAuto: true,
      yolo: false,
    },
    production: {
      sandbox: 'workspace-write' as const,
      askForApproval: 'untrusted' as const,
      fullAuto: false,
      yolo: false,
    },
  };

  return { ...config, ...presets[profile] };
}

/**
 * Apply a configuration profile to Claude Code config
 *
 * @param config - Base Claude Code configuration
 * @param profile - Profile to apply
 * @returns Configuration with profile applied
 */
export function applyClaudeCodePreset(
  config: ClaudeCodeConfig,
  profile: ConfigProfile
): ClaudeCodeConfig {
  const presets: Record<ConfigProfile, Partial<ClaudeCodeConfig>> = {
    safe: {
      dangerouslySkipPermissions: false,
      allowDangerouslySkipPermissions: false,
      permissionMode: 'default',
      // No tool restrictions for safe - let Claude ask for permissions
    },
    automation: {
      dangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
      // For automation, enable all tools by default
      tools: ['default'],
    },
    development: {
      dangerouslySkipPermissions: true,
      permissionMode: 'acceptEdits',
      // Allow common development tools
      allowedTools: ['Bash', 'Edit', 'Read', 'Write', 'Glob', 'Grep'],
    },
    production: {
      dangerouslySkipPermissions: false,
      allowDangerouslySkipPermissions: true, // Allow but don't enable by default
      permissionMode: 'default',
      // Restrict to read-only tools in production
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash', 'Write'],
    },
  };

  return { ...config, ...presets[profile] };
}

/**
 * Get recommended timeout values based on profile
 *
 * @param profile - Configuration profile
 * @returns Timeout configuration
 */
export function getRecommendedTimeouts(profile: ConfigProfile): {
  timeout: number;
  idleTimeout: number;
} {
  const timeouts = {
    safe: {
      timeout: 5 * 60 * 1000, // 5 minutes
      idleTimeout: 2 * 60 * 1000, // 2 minutes
    },
    automation: {
      timeout: 30 * 60 * 1000, // 30 minutes
      idleTimeout: 10 * 60 * 1000, // 10 minutes
    },
    development: {
      timeout: 15 * 60 * 1000, // 15 minutes
      idleTimeout: 5 * 60 * 1000, // 5 minutes
    },
    production: {
      timeout: 10 * 60 * 1000, // 10 minutes
      idleTimeout: 3 * 60 * 1000, // 3 minutes
    },
  };

  return timeouts[profile];
}

/**
 * Get recommended retry configuration based on profile
 *
 * @param profile - Configuration profile
 * @returns Retry configuration
 */
export function getRecommendedRetry(profile: ConfigProfile): {
  maxAttempts: number;
  backoffMs: number;
} {
  const retryConfigs = {
    safe: {
      maxAttempts: 1, // No retries for safety
      backoffMs: 0,
    },
    automation: {
      maxAttempts: 3, // More retries for automation
      backoffMs: 1000,
    },
    development: {
      maxAttempts: 2,
      backoffMs: 500,
    },
    production: {
      maxAttempts: 2,
      backoffMs: 1000,
    },
  };

  return retryConfigs[profile];
}
