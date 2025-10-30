/**
 * Worktree Configuration
 *
 * Loads and validates worktree configuration from .sudocode/config.json
 *
 * @module execution/worktree/config
 */

import fs from 'fs';
import path from 'path';
import type { WorktreeConfig } from './types.js';

/**
 * Raw configuration structure from .sudocode/config.json
 */
interface RawConfig {
  worktree?: Partial<WorktreeConfig>;
  [key: string]: unknown;
}

/**
 * Validation result
 */
interface ValidationResult {
  config: WorktreeConfig;
  warnings: string[];
}

/**
 * Default worktree configuration
 */
export const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
  worktreeStoragePath: '.sudocode/worktrees',
  autoCreateBranches: true,
  autoDeleteBranches: false,
  enableSparseCheckout: false,
  sparseCheckoutPatterns: undefined,
  branchPrefix: 'sudocode',
  cleanupOrphanedWorktreesOnStartup: true,
};

/**
 * Validate and normalize worktree configuration
 *
 * @param rawConfig - Raw configuration object from config.json
 * @returns Validated configuration with warnings
 */
export function validateWorktreeConfig(
  rawConfig: Partial<WorktreeConfig>
): ValidationResult {
  const warnings: string[] = [];
  const config: WorktreeConfig = { ...DEFAULT_WORKTREE_CONFIG };

  // Validate worktreeStoragePath
  if (rawConfig.worktreeStoragePath !== undefined) {
    if (typeof rawConfig.worktreeStoragePath === 'string') {
      config.worktreeStoragePath = rawConfig.worktreeStoragePath;
    } else {
      warnings.push(
        `Invalid worktreeStoragePath: must be a string. Using default: ${DEFAULT_WORKTREE_CONFIG.worktreeStoragePath}`
      );
    }
  }

  // Validate autoCreateBranches
  if (rawConfig.autoCreateBranches !== undefined) {
    if (typeof rawConfig.autoCreateBranches === 'boolean') {
      config.autoCreateBranches = rawConfig.autoCreateBranches;
    } else {
      warnings.push(
        `Invalid autoCreateBranches: must be a boolean. Using default: ${DEFAULT_WORKTREE_CONFIG.autoCreateBranches}`
      );
    }
  }

  // Validate autoDeleteBranches
  if (rawConfig.autoDeleteBranches !== undefined) {
    if (typeof rawConfig.autoDeleteBranches === 'boolean') {
      config.autoDeleteBranches = rawConfig.autoDeleteBranches;
    } else {
      warnings.push(
        `Invalid autoDeleteBranches: must be a boolean. Using default: ${DEFAULT_WORKTREE_CONFIG.autoDeleteBranches}`
      );
    }
  }

  // Validate enableSparseCheckout
  if (rawConfig.enableSparseCheckout !== undefined) {
    if (typeof rawConfig.enableSparseCheckout === 'boolean') {
      config.enableSparseCheckout = rawConfig.enableSparseCheckout;
    } else {
      warnings.push(
        `Invalid enableSparseCheckout: must be a boolean. Using default: ${DEFAULT_WORKTREE_CONFIG.enableSparseCheckout}`
      );
    }
  }

  // Validate sparseCheckoutPatterns
  if (rawConfig.sparseCheckoutPatterns !== undefined) {
    if (
      Array.isArray(rawConfig.sparseCheckoutPatterns) &&
      rawConfig.sparseCheckoutPatterns.every((p: unknown) => typeof p === 'string')
    ) {
      config.sparseCheckoutPatterns = rawConfig.sparseCheckoutPatterns;
    } else {
      warnings.push(
        'Invalid sparseCheckoutPatterns: must be an array of strings. Ignoring value.'
      );
      config.sparseCheckoutPatterns = undefined;
    }
  }

  // Validate branchPrefix
  if (rawConfig.branchPrefix !== undefined) {
    if (typeof rawConfig.branchPrefix === 'string') {
      // Validate git branch name characters (basic validation)
      if (isValidGitBranchPrefix(rawConfig.branchPrefix)) {
        config.branchPrefix = rawConfig.branchPrefix;
      } else {
        warnings.push(
          `Invalid branchPrefix: contains invalid git branch name characters. Using default: ${DEFAULT_WORKTREE_CONFIG.branchPrefix}`
        );
      }
    } else {
      warnings.push(
        `Invalid branchPrefix: must be a string. Using default: ${DEFAULT_WORKTREE_CONFIG.branchPrefix}`
      );
    }
  }

  // Validate cleanupOrphanedWorktreesOnStartup
  if (rawConfig.cleanupOrphanedWorktreesOnStartup !== undefined) {
    if (typeof rawConfig.cleanupOrphanedWorktreesOnStartup === 'boolean') {
      config.cleanupOrphanedWorktreesOnStartup =
        rawConfig.cleanupOrphanedWorktreesOnStartup;
    } else {
      warnings.push(
        `Invalid cleanupOrphanedWorktreesOnStartup: must be a boolean. Using default: ${DEFAULT_WORKTREE_CONFIG.cleanupOrphanedWorktreesOnStartup}`
      );
    }
  }

  return { config, warnings };
}

/**
 * Validate git branch prefix characters
 * Basic validation - checks for common invalid characters
 *
 * @param prefix - Branch prefix to validate
 * @returns True if valid
 */
function isValidGitBranchPrefix(prefix: string): boolean {
  // Git branch names cannot contain: .., @{, \, ^, ~, :, ?, *, [, space, or control characters
  // Also cannot start with / or end with .lock
  const invalidPatterns = [
    /\.\./,
    /@\{/,
    /\\/,
    /\^/,
    /~/,
    /:/,
    /\?/,
    /\*/,
    /\[/,
    /\s/,
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/,
  ];

  if (prefix.startsWith('/') || prefix.endsWith('.lock')) {
    return false;
  }

  return !invalidPatterns.some((pattern) => pattern.test(prefix));
}

/**
 * Load worktree configuration from .sudocode/config.json
 *
 * @param projectRoot - Path to project root (default: current working directory)
 * @returns Validated configuration with warnings
 */
export function loadWorktreeConfig(
  projectRoot: string = process.cwd()
): ValidationResult {
  const configPath = path.join(projectRoot, '.sudocode', 'config.json');

  // If config file doesn't exist, return defaults
  if (!fs.existsSync(configPath)) {
    return {
      config: DEFAULT_WORKTREE_CONFIG,
      warnings: [
        `Config file not found at ${configPath}. Using default configuration.`,
      ],
    };
  }

  try {
    const rawFileContent = fs.readFileSync(configPath, 'utf-8');
    const rawConfig: RawConfig = JSON.parse(rawFileContent);

    // Extract worktree section
    const worktreeConfig = rawConfig.worktree || {};

    // Validate and return
    return validateWorktreeConfig(worktreeConfig);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      config: DEFAULT_WORKTREE_CONFIG,
      warnings: [
        `Failed to load config from ${configPath}: ${errorMessage}. Using default configuration.`,
      ],
    };
  }
}

/**
 * Singleton instance of worktree configuration
 */
let cachedConfig: WorktreeConfig | null = null;
let cachedProjectRoot: string | null = null;

/**
 * Get worktree configuration (singleton pattern)
 * Caches the configuration per project root
 *
 * @param projectRoot - Path to project root (default: current working directory)
 * @param forceReload - Force reload from disk
 * @returns Worktree configuration
 */
export function getWorktreeConfig(
  projectRoot: string = process.cwd(),
  forceReload = false
): WorktreeConfig {
  // Return cached config if same project root and not forcing reload
  if (!forceReload && cachedConfig && cachedProjectRoot === projectRoot) {
    return cachedConfig;
  }

  // Load and validate configuration
  const { config, warnings } = loadWorktreeConfig(projectRoot);

  // Log warnings
  if (warnings.length > 0) {
    console.warn('[Worktree Config] Configuration warnings:');
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
  }

  // Cache the configuration
  cachedConfig = config;
  cachedProjectRoot = projectRoot;

  return config;
}

/**
 * Clear the cached configuration (useful for testing)
 */
export function clearWorktreeConfigCache(): void {
  cachedConfig = null;
  cachedProjectRoot = null;
}

/**
 * Update worktree configuration in .sudocode/config.json
 * Preserves other configuration sections
 *
 * @param updates - Partial configuration to update
 * @param projectRoot - Path to project root (default: current working directory)
 * @returns Validation result with updated config
 * @throws Error if unable to write config file
 */
export function updateWorktreeConfig(
  updates: Partial<WorktreeConfig>,
  projectRoot: string = process.cwd()
): ValidationResult {
  const configPath = path.join(projectRoot, '.sudocode', 'config.json');

  // Load existing config (or create new one)
  let existingConfig: RawConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const rawFileContent = fs.readFileSync(configPath, 'utf-8');
      existingConfig = JSON.parse(rawFileContent);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to read existing config from ${configPath}: ${errorMessage}`
      );
    }
  } else {
    // Create .sudocode directory if it doesn't exist
    const sudocodeDir = path.dirname(configPath);
    if (!fs.existsSync(sudocodeDir)) {
      fs.mkdirSync(sudocodeDir, { recursive: true });
    }
  }

  // Merge updates with existing worktree config
  const mergedWorktreeConfig = {
    ...(existingConfig.worktree || {}),
    ...updates,
  };

  // Validate merged config
  const validationResult = validateWorktreeConfig(mergedWorktreeConfig);

  // Update config object
  existingConfig.worktree = validationResult.config;

  // Write to file
  try {
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write config to ${configPath}: ${errorMessage}`);
  }

  // Invalidate cache
  if (cachedProjectRoot === projectRoot) {
    cachedConfig = null;
    cachedProjectRoot = null;
  }

  return validationResult;
}

/**
 * Set a single worktree configuration property
 *
 * @param key - Configuration key to set
 * @param value - Value to set
 * @param projectRoot - Path to project root (default: current working directory)
 * @returns Validation result with updated config
 */
export function setWorktreeConfigProperty<K extends keyof WorktreeConfig>(
  key: K,
  value: WorktreeConfig[K],
  projectRoot: string = process.cwd()
): ValidationResult {
  return updateWorktreeConfig({ [key]: value }, projectRoot);
}

/**
 * Reset worktree configuration to defaults
 *
 * @param projectRoot - Path to project root (default: current working directory)
 * @returns Validation result with default config
 */
export function resetWorktreeConfig(
  projectRoot: string = process.cwd()
): ValidationResult {
  return updateWorktreeConfig(DEFAULT_WORKTREE_CONFIG, projectRoot);
}
