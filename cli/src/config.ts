import * as fs from "fs";
import * as path from "path";
import type { Config, ProjectConfig, LocalConfig } from "@sudocode-ai/types";
import {
  validateIntegrationsConfig,
  type ValidationResult,
} from "./integrations/index.js";

/** Project config file name (git-tracked) */
export const PROJECT_CONFIG_FILE = "config.json";

/** Local config file name (gitignored) */
export const LOCAL_CONFIG_FILE = "config.local.json";

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
 * Fields that belong in ProjectConfig (git-tracked)
 */
const PROJECT_CONFIG_FIELDS: (keyof ProjectConfig)[] = [
  "sourceOfTruth",
  "integrations",
  "telemetry",
];

/**
 * Fields that belong in LocalConfig (gitignored)
 */
const LOCAL_CONFIG_FIELDS: (keyof LocalConfig)[] = [
  "worktree",
  "editor",
  "voice",
  "telemetry",
];

/**
 * Read project config file (git-tracked)
 */
function readProjectConfig(outputDir: string): ProjectConfig {
  const configPath = path.join(outputDir, PROJECT_CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return {};
  }
}

/**
 * Read local config file (gitignored)
 */
function readLocalConfig(outputDir: string): LocalConfig {
  const configPath = path.join(outputDir, LOCAL_CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
    return JSON.parse(content) as LocalConfig;
  } catch {
    return {};
  }
}

/**
 * Write project config file (git-tracked)
 */
function writeProjectConfig(outputDir: string, config: ProjectConfig): void {
  const configPath = path.join(outputDir, PROJECT_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Write local config file (gitignored)
 */
function writeLocalConfig(outputDir: string, config: LocalConfig): void {
  const configPath = path.join(outputDir, LOCAL_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Migrate old single config.json to split config files if needed.
 * This handles the transition from the old format where config.json
 * contained both project and local settings.
 */
export function migrateConfigIfNeeded(outputDir: string): boolean {
  const projectConfigPath = path.join(outputDir, PROJECT_CONFIG_FILE);
  const localConfigPath = path.join(outputDir, LOCAL_CONFIG_FILE);

  // Skip if local config already exists (already migrated)
  if (fs.existsSync(localConfigPath)) {
    return false;
  }

  // Skip if project config doesn't exist
  if (!fs.existsSync(projectConfigPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(projectConfigPath, "utf8");
    const oldConfig = JSON.parse(content);

    // Check if old config has any local fields that need migration
    const hasLocalFields = LOCAL_CONFIG_FIELDS.some(
      (field) => oldConfig[field] !== undefined
    );

    if (!hasLocalFields) {
      return false;
    }

    // Extract local-only fields
    const localConfig: LocalConfig = {};
    for (const field of LOCAL_CONFIG_FIELDS) {
      if (oldConfig[field] !== undefined) {
        (localConfig as Record<string, unknown>)[field] = oldConfig[field];
        delete oldConfig[field];
      }
    }

    // Remove deprecated version field from project config
    delete oldConfig.version;

    // Extract project fields (keep only project fields)
    const projectConfig: ProjectConfig = {};
    for (const field of PROJECT_CONFIG_FIELDS) {
      if (oldConfig[field] !== undefined) {
        (projectConfig as Record<string, unknown>)[field] = oldConfig[field];
      }
    }

    // Write split configs
    if (Object.keys(localConfig).length > 0) {
      writeLocalConfig(outputDir, localConfig);
    }
    writeProjectConfig(outputDir, projectConfig);

    return true;
  } catch {
    return false;
  }
}

/**
 * Get merged config (project + local)
 */
export function getConfig(outputDir: string): Config {
  // Run migration if needed (handles old single config.json format)
  migrateConfigIfNeeded(outputDir);

  const project = readProjectConfig(outputDir);
  const local = readLocalConfig(outputDir);

  // Deep-merge telemetry (spans both project and local config)
  const telemetry = (project.telemetry || local.telemetry)
    ? { ...project.telemetry, ...local.telemetry }
    : undefined;

  return { ...project, ...local, ...(telemetry !== undefined ? { telemetry } : {}) };
}

/**
 * Get only the project config (git-tracked settings)
 */
export function getProjectConfig(outputDir: string): ProjectConfig {
  migrateConfigIfNeeded(outputDir);
  return readProjectConfig(outputDir);
}

/**
 * Get only the local config (machine-specific settings)
 */
export function getLocalConfig(outputDir: string): LocalConfig {
  migrateConfigIfNeeded(outputDir);
  return readLocalConfig(outputDir);
}

/**
 * Update project config (git-tracked)
 */
export function updateProjectConfig(
  outputDir: string,
  updates: Partial<ProjectConfig>
): void {
  migrateConfigIfNeeded(outputDir);
  const config = readProjectConfig(outputDir);
  Object.assign(config, updates);
  writeProjectConfig(outputDir, config);
}

/**
 * Update local config (gitignored)
 */
export function updateLocalConfig(
  outputDir: string,
  updates: Partial<LocalConfig>
): void {
  migrateConfigIfNeeded(outputDir);
  const config = readLocalConfig(outputDir);
  Object.assign(config, updates);
  writeLocalConfig(outputDir, config);
}

/**
 * Update config - automatically routes to correct file based on field
 * @deprecated Use updateProjectConfig or updateLocalConfig directly
 */
export function updateConfig(
  outputDir: string,
  updates: Partial<Config>
): void {
  migrateConfigIfNeeded(outputDir);

  // Split updates into project and local
  const projectUpdates: Partial<ProjectConfig> = {};
  const localUpdates: Partial<LocalConfig> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (PROJECT_CONFIG_FIELDS.includes(key as keyof ProjectConfig)) {
      (projectUpdates as Record<string, unknown>)[key] = value;
    } else if (LOCAL_CONFIG_FIELDS.includes(key as keyof LocalConfig)) {
      (localUpdates as Record<string, unknown>)[key] = value;
    }
    // Ignore unknown fields (like deprecated 'version')
  }

  // Update appropriate config files
  if (Object.keys(projectUpdates).length > 0) {
    updateProjectConfig(outputDir, projectUpdates);
  }
  if (Object.keys(localUpdates).length > 0) {
    updateLocalConfig(outputDir, localUpdates);
  }
}

/**
 * Check if markdown is the source of truth
 */
export function isMarkdownFirst(config: Config): boolean {
  return config.sourceOfTruth === "markdown";
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

  const config = getConfig(outputDir);
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
