/**
 * Integration configuration validator
 * Validates integration configs from .sudocode/config.json
 *
 * Base config fields are validated synchronously.
 * Provider-specific validation is delegated to plugins asynchronously.
 */

import type {
  IntegrationsConfig,
  IntegrationProviderConfig,
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
 * Validate the base IntegrationProviderConfig fields common to all providers
 */
function validateBaseConfig(
  config: IntegrationProviderConfig,
  name: string,
  errors: string[],
  warnings: string[]
): void {
  // Validate sync direction
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

  // Validate conflict resolution
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

  // Warn if enabled but no options configured
  if (config.enabled && (!config.options || Object.keys(config.options).length === 0)) {
    warnings.push(`${name}: enabled but no options configured`);
  }
}

/**
 * Validate an integrations configuration object (synchronous, base validation only)
 *
 * This validates the base config fields that are common to all providers.
 * Provider-specific validation requires loading plugins asynchronously
 * via validateProviderConfig() from plugin-loader.
 *
 * @param config - The integrations configuration to validate
 * @returns Validation result with valid flag, errors, and warnings
 *
 * @example
 * ```typescript
 * const result = validateIntegrationsConfig({
 *   beads: {
 *     enabled: true,
 *     auto_sync: true,
 *     default_sync_direction: 'bidirectional',
 *     conflict_resolution: 'newest-wins',
 *     options: {
 *       path: '../other-project/.beads',
 *     },
 *   },
 * });
 *
 * if (!result.valid) {
 *   console.error('Config errors:', result.errors);
 * }
 * ```
 */
export function validateIntegrationsConfig(
  config: IntegrationsConfig
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [providerName, providerConfig] of Object.entries(config)) {
    if (!providerConfig) {
      continue;
    }

    // Validate base config fields
    validateBaseConfig(providerConfig, providerName, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate an integrations configuration with plugin-level validation
 *
 * This loads plugins and delegates validation to them for provider-specific
 * configuration. If a plugin is not installed, it adds a warning.
 *
 * @param config - The integrations configuration to validate
 * @returns Validation result with valid flag, errors, and warnings
 *
 * @example
 * ```typescript
 * const result = await validateIntegrationsConfigWithPlugins({
 *   beads: {
 *     enabled: true,
 *     auto_sync: true,
 *     default_sync_direction: 'bidirectional',
 *     conflict_resolution: 'newest-wins',
 *     options: {
 *       path: '../other-project/.beads',
 *     },
 *   },
 * });
 * ```
 */
export async function validateIntegrationsConfigWithPlugins(
  config: IntegrationsConfig
): Promise<ValidationResult> {
  // Start with base validation
  const result = validateIntegrationsConfig(config);

  // Dynamically import plugin loader to avoid circular dependencies
  const { validateProviderConfig } = await import("./plugin-loader.js");

  // Validate each enabled provider with its plugin
  for (const [providerName, providerConfig] of Object.entries(config)) {
    if (!providerConfig?.enabled) {
      continue;
    }

    // Delegate to plugin validation
    const pluginResult = await validateProviderConfig(providerName, providerConfig);

    // Merge plugin validation results
    result.errors.push(...pluginResult.errors);
    result.warnings.push(...pluginResult.warnings);
  }

  // Update valid flag based on all errors
  result.valid = result.errors.length === 0;

  return result;
}
