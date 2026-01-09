/**
 * Dataplane Configuration
 *
 * Loads and validates dataplane configuration from .sudocode/config.json
 *
 * @module services/dataplane-config
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conflict strategy options
 */
export type ConflictStrategyOption = 'defer' | 'ours' | 'theirs' | 'abort';

/**
 * Cascade conflict strategy options
 */
export type CascadeStrategyOption = 'stop_on_conflict' | 'skip_conflicting' | 'defer_conflicts';

/**
 * Dataplane configuration
 */
export interface DataplaneConfig {
  /** Whether dataplane is enabled */
  enabled: boolean;

  /** Database path relative to .sudocode */
  dbPath: string;

  /** Conflict resolution strategies */
  conflictStrategy: {
    /** Default strategy for all conflicts */
    default: ConflictStrategyOption;
    /** Strategy for code file conflicts */
    code: ConflictStrategyOption;
    /** Strategy for cascade operations */
    cascade: CascadeStrategyOption;
  };

  /** Auto-reconcile on sync operations */
  autoReconcile: boolean;

  /** Trigger cascade rebase on merge */
  cascadeOnMerge: boolean;

  /** Merge queue settings */
  mergeQueue: {
    /** Whether merge queue is enabled */
    enabled: boolean;
    /** Auto-enqueue completed executions */
    autoEnqueue: boolean;
    /** Require queue for all merges */
    requireQueue: boolean;
  };

  /** Stream settings */
  streams: {
    /** Prefix for stream branches */
    branchPrefix: string;
    /** Auto-cleanup abandoned streams */
    autoCleanupAbandoned: boolean;
    /** Days to keep abandoned streams */
    abandonedRetentionDays: number;
  };

  /** Recovery settings */
  recovery: {
    /** Run recovery on startup */
    runOnStartup: boolean;
    /** Create checkpoints for operations */
    enableCheckpoints: boolean;
  };
}

/**
 * Raw configuration structure from .sudocode/config.json
 */
interface RawConfig {
  dataplane?: Partial<DataplaneConfig>;
  [key: string]: unknown;
}

/**
 * Validation result
 */
interface ValidationResult {
  config: DataplaneConfig;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default dataplane configuration
 */
export const DEFAULT_DATAPLANE_CONFIG: DataplaneConfig = {
  enabled: false, // Opt-in feature
  dbPath: 'dataplane.db',
  conflictStrategy: {
    default: 'defer',
    code: 'defer',
    cascade: 'skip_conflicting',
  },
  autoReconcile: true,
  cascadeOnMerge: false,
  mergeQueue: {
    enabled: false,
    autoEnqueue: false,
    requireQueue: false,
  },
  streams: {
    branchPrefix: 'sudocode',
    autoCleanupAbandoned: true,
    abandonedRetentionDays: 30,
  },
  recovery: {
    runOnStartup: true,
    enableCheckpoints: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate conflict strategy option
 */
function isValidConflictStrategy(value: unknown): value is ConflictStrategyOption {
  return ['defer', 'ours', 'theirs', 'abort'].includes(value as string);
}

/**
 * Validate cascade strategy option
 */
function isValidCascadeStrategy(value: unknown): value is CascadeStrategyOption {
  return ['stop_on_conflict', 'skip_conflicting', 'defer_conflicts'].includes(value as string);
}

/**
 * Validate and normalize dataplane configuration
 */
export function validateDataplaneConfig(
  rawConfig: Partial<DataplaneConfig>
): ValidationResult {
  const warnings: string[] = [];
  const config: DataplaneConfig = JSON.parse(JSON.stringify(DEFAULT_DATAPLANE_CONFIG));

  // Validate enabled
  if (rawConfig.enabled !== undefined) {
    if (typeof rawConfig.enabled === 'boolean') {
      config.enabled = rawConfig.enabled;
    } else {
      warnings.push('Invalid dataplane.enabled: must be a boolean. Using default: false');
    }
  }

  // Validate dbPath
  if (rawConfig.dbPath !== undefined) {
    if (typeof rawConfig.dbPath === 'string' && rawConfig.dbPath.length > 0) {
      config.dbPath = rawConfig.dbPath;
    } else {
      warnings.push(`Invalid dataplane.dbPath: must be a non-empty string. Using default: ${DEFAULT_DATAPLANE_CONFIG.dbPath}`);
    }
  }

  // Validate conflictStrategy
  if (rawConfig.conflictStrategy) {
    const cs = rawConfig.conflictStrategy;

    if (cs.default !== undefined) {
      if (isValidConflictStrategy(cs.default)) {
        config.conflictStrategy.default = cs.default;
      } else {
        warnings.push(`Invalid conflictStrategy.default: must be one of defer|ours|theirs|abort. Using default: ${DEFAULT_DATAPLANE_CONFIG.conflictStrategy.default}`);
      }
    }

    if (cs.code !== undefined) {
      if (isValidConflictStrategy(cs.code)) {
        config.conflictStrategy.code = cs.code;
      } else {
        warnings.push(`Invalid conflictStrategy.code: must be one of defer|ours|theirs|abort. Using default: ${DEFAULT_DATAPLANE_CONFIG.conflictStrategy.code}`);
      }
    }

    if (cs.cascade !== undefined) {
      if (isValidCascadeStrategy(cs.cascade)) {
        config.conflictStrategy.cascade = cs.cascade;
      } else {
        warnings.push(`Invalid conflictStrategy.cascade: must be one of stop_on_conflict|skip_conflicting|defer_conflicts. Using default: ${DEFAULT_DATAPLANE_CONFIG.conflictStrategy.cascade}`);
      }
    }
  }

  // Validate autoReconcile
  if (rawConfig.autoReconcile !== undefined) {
    if (typeof rawConfig.autoReconcile === 'boolean') {
      config.autoReconcile = rawConfig.autoReconcile;
    } else {
      warnings.push('Invalid dataplane.autoReconcile: must be a boolean. Using default: true');
    }
  }

  // Validate cascadeOnMerge
  if (rawConfig.cascadeOnMerge !== undefined) {
    if (typeof rawConfig.cascadeOnMerge === 'boolean') {
      config.cascadeOnMerge = rawConfig.cascadeOnMerge;
    } else {
      warnings.push('Invalid dataplane.cascadeOnMerge: must be a boolean. Using default: false');
    }
  }

  // Validate mergeQueue
  if (rawConfig.mergeQueue) {
    const mq = rawConfig.mergeQueue;

    if (mq.enabled !== undefined) {
      if (typeof mq.enabled === 'boolean') {
        config.mergeQueue.enabled = mq.enabled;
      } else {
        warnings.push('Invalid mergeQueue.enabled: must be a boolean. Using default: false');
      }
    }

    if (mq.autoEnqueue !== undefined) {
      if (typeof mq.autoEnqueue === 'boolean') {
        config.mergeQueue.autoEnqueue = mq.autoEnqueue;
      } else {
        warnings.push('Invalid mergeQueue.autoEnqueue: must be a boolean. Using default: false');
      }
    }

    if (mq.requireQueue !== undefined) {
      if (typeof mq.requireQueue === 'boolean') {
        config.mergeQueue.requireQueue = mq.requireQueue;
      } else {
        warnings.push('Invalid mergeQueue.requireQueue: must be a boolean. Using default: false');
      }
    }
  }

  // Validate streams
  if (rawConfig.streams) {
    const s = rawConfig.streams;

    if (s.branchPrefix !== undefined) {
      if (typeof s.branchPrefix === 'string' && s.branchPrefix.length > 0) {
        config.streams.branchPrefix = s.branchPrefix;
      } else {
        warnings.push(`Invalid streams.branchPrefix: must be a non-empty string. Using default: ${DEFAULT_DATAPLANE_CONFIG.streams.branchPrefix}`);
      }
    }

    if (s.autoCleanupAbandoned !== undefined) {
      if (typeof s.autoCleanupAbandoned === 'boolean') {
        config.streams.autoCleanupAbandoned = s.autoCleanupAbandoned;
      } else {
        warnings.push('Invalid streams.autoCleanupAbandoned: must be a boolean. Using default: true');
      }
    }

    if (s.abandonedRetentionDays !== undefined) {
      if (typeof s.abandonedRetentionDays === 'number' && s.abandonedRetentionDays > 0) {
        config.streams.abandonedRetentionDays = s.abandonedRetentionDays;
      } else {
        warnings.push('Invalid streams.abandonedRetentionDays: must be a positive number. Using default: 30');
      }
    }
  }

  // Validate recovery
  if (rawConfig.recovery) {
    const r = rawConfig.recovery;

    if (r.runOnStartup !== undefined) {
      if (typeof r.runOnStartup === 'boolean') {
        config.recovery.runOnStartup = r.runOnStartup;
      } else {
        warnings.push('Invalid recovery.runOnStartup: must be a boolean. Using default: true');
      }
    }

    if (r.enableCheckpoints !== undefined) {
      if (typeof r.enableCheckpoints === 'boolean') {
        config.recovery.enableCheckpoints = r.enableCheckpoints;
      } else {
        warnings.push('Invalid recovery.enableCheckpoints: must be a boolean. Using default: true');
      }
    }
  }

  return { config, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load dataplane configuration from .sudocode/config.json
 */
export function loadDataplaneConfig(
  projectRoot: string = process.cwd()
): ValidationResult {
  const configPath = path.join(projectRoot, '.sudocode', 'config.json');

  // If config file doesn't exist, return defaults
  if (!fs.existsSync(configPath)) {
    return {
      config: DEFAULT_DATAPLANE_CONFIG,
      warnings: [],
    };
  }

  try {
    const rawFileContent = fs.readFileSync(configPath, 'utf-8');
    const rawConfig: RawConfig = JSON.parse(rawFileContent);

    // Extract dataplane section
    const dataplaneConfig = rawConfig.dataplane || {};

    // Validate and return
    return validateDataplaneConfig(dataplaneConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      config: DEFAULT_DATAPLANE_CONFIG,
      warnings: [
        `Failed to load dataplane config from ${configPath}: ${errorMessage}. Using defaults.`,
      ],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Cached configuration */
let cachedConfig: DataplaneConfig | null = null;
let cachedProjectRoot: string | null = null;

/**
 * Get dataplane configuration (singleton pattern)
 */
export function getDataplaneConfig(
  projectRoot: string = process.cwd(),
  forceReload = false
): DataplaneConfig {
  // Return cached config if same project root and not forcing reload
  if (!forceReload && cachedConfig && cachedProjectRoot === projectRoot) {
    return cachedConfig;
  }

  // Load and validate configuration
  const { config, warnings } = loadDataplaneConfig(projectRoot);

  // Log warnings
  if (warnings.length > 0) {
    console.warn('[Dataplane Config] Configuration warnings:');
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
export function clearDataplaneConfigCache(): void {
  cachedConfig = null;
  cachedProjectRoot = null;
}

/**
 * Check if dataplane is enabled for the project
 */
export function isDataplaneEnabled(projectRoot: string = process.cwd()): boolean {
  return getDataplaneConfig(projectRoot).enabled;
}
