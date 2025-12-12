import * as fs from "fs";
import * as path from "path";
import type { Config } from "@sudocode-ai/types";
import { VERSION } from "./version.js";
import {
  validateIntegrationsConfig,
  type ValidationResult,
} from "./integrations/index.js";

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Whether to validate integrations config (default: true) */
  validateIntegrations?: boolean;
  /** Whether to throw on validation errors (default: false, warnings are logged) */
  throwOnValidationErrors?: boolean;
}

/**
 * Result of loading configuration with validation info
 */
export interface ConfigLoadResult {
  /** The loaded configuration */
  config: Config;
  /** Validation result for integrations (if present) */
  integrationsValidation?: ValidationResult;
}

/**
 * Read config file (version-controlled)
 */
function readConfig(outputDir: string): Config {
  const configPath = path.join(outputDir, "config.json");

  if (!fs.existsSync(configPath)) {
    // Create default config if not exists
    const defaultConfig: Config = {
      version: VERSION,
    };
    writeConfig(outputDir, defaultConfig);
    return defaultConfig;
  }

  const content = fs.readFileSync(configPath, "utf8");
  return JSON.parse(content) as Config;
}

/**
 * Write config file (version-controlled)
 */
function writeConfig(outputDir: string, config: Config): void {
  const configPath = path.join(outputDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Get current config
 */
export function getConfig(outputDir: string): Config {
  return readConfig(outputDir);
}

/**
 * Update config (version-controlled)
 */
export function updateConfig(
  outputDir: string,
  updates: Partial<Config>
): void {
  const config = readConfig(outputDir);
  Object.assign(config, updates);
  writeConfig(outputDir, config);
}

/**
 * Load config with validation
 *
 * @param outputDir - The .sudocode directory path
 * @param options - Loading options
 * @returns Config load result with validation info
 * @throws Error if throwOnValidationErrors is true and validation fails
 *
 * @example
 * ```typescript
 * const result = loadConfigWithValidation('/project/.sudocode', {
 *   validateIntegrations: true,
 *   throwOnValidationErrors: true,
 * });
 *
 * if (result.integrationsValidation?.warnings.length) {
 *   console.warn('Integration warnings:', result.integrationsValidation.warnings);
 * }
 * ```
 */
export function loadConfigWithValidation(
  outputDir: string,
  options: LoadConfigOptions = {}
): ConfigLoadResult {
  const { validateIntegrations = true, throwOnValidationErrors = false } =
    options;

  const config = readConfig(outputDir);
  const result: ConfigLoadResult = { config };

  // Validate integrations if present and validation requested
  if (validateIntegrations && config.integrations) {
    const validation = validateIntegrationsConfig(config.integrations);
    result.integrationsValidation = validation;

    if (!validation.valid && throwOnValidationErrors) {
      throw new Error(
        `Integration config validation failed:\n${validation.errors.join("\n")}`
      );
    }
  }

  return result;
}
