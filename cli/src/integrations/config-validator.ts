/**
 * Integration configuration validator
 * Validates integration configs from .sudocode/config.json
 */

import type {
  IntegrationsConfig,
  IntegrationConfig,
  JiraConfig,
  BeadsConfig,
  SpecKitConfig,
  OpenSpecConfig,
} from "@sudocode-ai/types";

/**
 * Result of validating an integrations config
 */
export interface ValidationResult {
  /** Whether the configuration is valid (no errors) */
  valid: boolean;
  /** List of validation errors (configuration problems that must be fixed) */
  errors: string[];
  /** List of validation warnings (potential issues, but config is still usable) */
  warnings: string[];
}

/**
 * Valid sync direction values
 */
const VALID_SYNC_DIRECTIONS = ["inbound", "outbound", "bidirectional"] as const;

/**
 * Valid conflict resolution strategies
 */
const VALID_CONFLICT_RESOLUTIONS = [
  "newest-wins",
  "sudocode-wins",
  "external-wins",
  "manual",
] as const;

/**
 * Validate the base IntegrationConfig fields common to all providers
 */
function validateBaseConfig(
  config: IntegrationConfig,
  name: string,
  errors: string[]
): void {
  if (
    config.default_sync_direction &&
    !VALID_SYNC_DIRECTIONS.includes(
      config.default_sync_direction as (typeof VALID_SYNC_DIRECTIONS)[number]
    )
  ) {
    errors.push(
      `${name}.default_sync_direction must be one of: ${VALID_SYNC_DIRECTIONS.join(", ")}`
    );
  }

  if (
    config.conflict_resolution &&
    !VALID_CONFLICT_RESOLUTIONS.includes(
      config.conflict_resolution as (typeof VALID_CONFLICT_RESOLUTIONS)[number]
    )
  ) {
    errors.push(
      `${name}.conflict_resolution must be one of: ${VALID_CONFLICT_RESOLUTIONS.join(", ")}`
    );
  }
}

/**
 * Validate Jira integration configuration
 */
function validateJiraConfig(
  config: JiraConfig,
  errors: string[],
  warnings: string[]
): void {
  if (!config.instance_url) {
    errors.push("jira.instance_url is required");
  } else if (!config.instance_url.startsWith("https://")) {
    warnings.push("jira.instance_url should use HTTPS");
  }

  if (!config.auth_type) {
    errors.push("jira.auth_type is required (basic or oauth2)");
  } else if (config.auth_type !== "basic" && config.auth_type !== "oauth2") {
    errors.push("jira.auth_type must be 'basic' or 'oauth2'");
  }

  if (config.auth_type === "basic" && !config.credentials_env) {
    warnings.push("jira.credentials_env recommended for basic auth");
  }

  validateBaseConfig(config, "jira", errors);
}

/**
 * Validate Beads integration configuration
 */
function validateBeadsConfig(
  config: BeadsConfig,
  errors: string[],
  _warnings: string[]
): void {
  if (!config.path) {
    errors.push("beads.path is required");
  }

  validateBaseConfig(config, "beads", errors);
}

/**
 * Validate SpecKit integration configuration
 */
function validateSpecKitConfig(
  config: SpecKitConfig,
  errors: string[],
  warnings: string[]
): void {
  if (!config.path) {
    errors.push("spec-kit.path is required");
  }

  // At least one import option should be true for useful configuration
  if (!config.import_specs && !config.import_plans && !config.import_tasks) {
    warnings.push("spec-kit: no import options enabled");
  }

  validateBaseConfig(config, "spec-kit", errors);
}

/**
 * Validate OpenSpec integration configuration
 */
function validateOpenSpecConfig(
  config: OpenSpecConfig,
  errors: string[],
  warnings: string[]
): void {
  if (!config.path) {
    errors.push("openspec.path is required");
  }

  // At least one import option should be true for useful configuration
  if (!config.import_specs && !config.import_changes) {
    warnings.push("openspec: no import options enabled");
  }

  validateBaseConfig(config, "openspec", errors);
}

/**
 * Validate an integrations configuration object
 *
 * @param config - The integrations configuration to validate
 * @returns Validation result with valid flag, errors, and warnings
 *
 * @example
 * ```typescript
 * const result = validateIntegrationsConfig({
 *   jira: {
 *     enabled: true,
 *     auto_sync: true,
 *     default_sync_direction: 'bidirectional',
 *     conflict_resolution: 'newest-wins',
 *     instance_url: 'https://example.atlassian.net',
 *     auth_type: 'basic',
 *   },
 * });
 *
 * if (!result.valid) {
 *   console.error('Config errors:', result.errors);
 * }
 * if (result.warnings.length > 0) {
 *   console.warn('Config warnings:', result.warnings);
 * }
 * ```
 */
export function validateIntegrationsConfig(
  config: IntegrationsConfig
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.jira) {
    validateJiraConfig(config.jira, errors, warnings);
  }
  if (config.beads) {
    validateBeadsConfig(config.beads, errors, warnings);
  }
  if (config["spec-kit"]) {
    validateSpecKitConfig(config["spec-kit"], errors, warnings);
  }
  if (config.openspec) {
    validateOpenSpecConfig(config.openspec, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
