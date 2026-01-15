import * as fs from "fs";
import * as path from "path";
import type { SpawnConfig, CodespacesProviderConfig, CoderProviderConfig } from "@sudocode-ai/types";

/**
 * Valid GitHub Codespaces machine types
 * Based on GitHub's available machine types as of 2025
 */
export const VALID_CODESPACES_MACHINE_TYPES = [
  "basicLinux32gb",
  "standardLinux32gb",
  "premiumLinux",
  "largePremiumLinux",
  "twoCore",
  "fourCore",
  "eightCore",
] as const;

/**
 * Validation error for spawn configuration
 */
export class SpawnConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnConfigValidationError";
  }
}

/**
 * Validate partial codespaces provider configuration
 * Exported for use in testing and external validation
 * 
 * @param config - Partial codespaces configuration to validate
 * @throws {SpawnConfigValidationError} if validation fails
 */
export function validateSpawnConfig(config: Partial<CodespacesProviderConfig>): void {
  const errors: string[] = [];

  // Validate port (1024-65535 for non-privileged ports)
  if (config.port !== undefined) {
    if (config.port < 1024 || config.port > 65535) {
      errors.push("Port must be between 1024 and 65535 (valid range for non-privileged ports)");
    }
  }

  // Validate idleTimeout (minimum 1 minute)
  if (config.idleTimeout !== undefined) {
    if (config.idleTimeout < 1) {
      errors.push("Idle timeout must be at least 1 minute (minimum: 1)");
    }
  }

  // Validate keepAliveHours (minimum 1 hour)
  if (config.keepAliveHours !== undefined) {
    if (config.keepAliveHours < 1) {
      errors.push("Keep-alive hours must be at least 1 hour (minimum: 1)");
    }
  }

  // Validate retentionPeriod (minimum 1 day)
  if (config.retentionPeriod !== undefined) {
    if (config.retentionPeriod < 1) {
      errors.push("Retention period must be at least 1 day (minimum: 1)");
    }
  }

  // Validate machine type
  if (config.machine !== undefined) {
    if (!config.machine || typeof config.machine !== "string") {
      errors.push("Machine type must be a non-empty string");
    } else if (!VALID_CODESPACES_MACHINE_TYPES.includes(config.machine as any)) {
      errors.push(
        `Machine type must be one of: ${VALID_CODESPACES_MACHINE_TYPES.join(", ")} (got: "${config.machine}")`
      );
    }
  }

  // Validate defaultBranch if provided
  if (config.defaultBranch !== undefined && typeof config.defaultBranch !== "string") {
    errors.push("Default branch must be a string");
  }

  if (errors.length > 0) {
    throw new SpawnConfigValidationError(
      `Codespaces configuration validation failed:\n  - ${errors.join("\n  - ")}`
    );
  }
}

/**
 * Manager for spawn configuration
 * Handles loading, saving, updating, and validating spawn-config.json
 */
export class SpawnConfigManager {
  private configPath: string;

  constructor(outputDir: string) {
    this.configPath = path.join(outputDir, "spawn-config.json");
  }

  /**
   * Get default spawn configuration
   */
  static getDefaults(): SpawnConfig {
    return {
      version: "0.1.0",
      providers: {
        codespaces: {
          port: 3000,
          idleTimeout: 4320,
          keepAliveHours: 72,
          retentionPeriod: 14,
          machine: "basicLinux32gb",
        },
      },
    };
  }

  /**
   * Validate codespaces provider configuration
   * Uses the standalone validateSpawnConfig function
   */
  private validateCodespacesConfig(config: CodespacesProviderConfig): string[] {
    try {
      validateSpawnConfig(config);
      return [];
    } catch (error) {
      if (error instanceof SpawnConfigValidationError) {
        // Extract error messages from the formatted error
        const message = error.message;
        const lines = message.split("\n").slice(1); // Skip first line "Codespaces configuration validation failed:"
        return lines.map(line => line.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
      }
      throw error;
    }
  }

  /**
   * Validate spawn configuration
   * @throws {SpawnConfigValidationError} if validation fails
   */
  private validateConfig(config: SpawnConfig): void {
    const errors: string[] = [];

    // Validate version
    if (!config.version || typeof config.version !== "string") {
      errors.push("Config version must be a non-empty string");
    }

    // Validate providers object exists
    if (!config.providers || typeof config.providers !== "object") {
      errors.push("Config must have a providers object");
    } else {
      // Validate codespaces config if present
      if (config.providers.codespaces) {
        const codespacesErrors = this.validateCodespacesConfig(config.providers.codespaces);
        errors.push(...codespacesErrors);
      }

      // Validate coder config if present (currently just check it's an object)
      if (config.providers.coder !== undefined && typeof config.providers.coder !== "object") {
        errors.push("Coder provider config must be an object");
      }
    }

    if (errors.length > 0) {
      throw new SpawnConfigValidationError(
        `Configuration validation failed:\n${errors.join("\n")}`
      );
    }
  }

  /**
   * Load spawn configuration
   * Creates file with defaults if it doesn't exist
   */
  loadConfig(): SpawnConfig {
    if (!fs.existsSync(this.configPath)) {
      const defaults = SpawnConfigManager.getDefaults();
      // Ensure directory exists before saving
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.saveConfig(defaults);
      return defaults;
    }

    const content = fs.readFileSync(this.configPath, "utf8");
    const config = JSON.parse(content) as SpawnConfig;
    this.validateConfig(config);
    return config;
  }

  /**
   * Save spawn configuration
   * @throws {SpawnConfigValidationError} if validation fails
   */
  saveConfig(config: SpawnConfig): void {
    this.validateConfig(config);
    // Ensure directory exists before saving
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf8");
  }

  /**
   * Update specific configuration values
   * @throws {SpawnConfigValidationError} if validation fails after update
   */
  updateConfig(updates: Partial<SpawnConfig>): SpawnConfig {
    const config = this.loadConfig();
    
    // Deep merge providers if provided
    if (updates.providers) {
      // Deep merge individual provider configs
      if (updates.providers.codespaces && config.providers.codespaces) {
        config.providers.codespaces = {
          ...config.providers.codespaces,
          ...updates.providers.codespaces,
        };
      } else if (updates.providers.codespaces) {
        // New provider config
        config.providers.codespaces = updates.providers.codespaces;
      }
      
      if (updates.providers.coder && config.providers.coder) {
        config.providers.coder = {
          ...config.providers.coder,
          ...updates.providers.coder,
        };
      } else if (updates.providers.coder) {
        // New provider config
        config.providers.coder = updates.providers.coder;
      }
      
      // Remove providers from updates to avoid overwriting the merged result
      const { providers, ...restUpdates } = updates;
      const updatedConfig = { ...config, ...restUpdates };
      this.saveConfig(updatedConfig);
      return updatedConfig;
    }
    
    const updatedConfig = { ...config, ...updates };
    this.saveConfig(updatedConfig);
    return updatedConfig;
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): SpawnConfig {
    const defaults = SpawnConfigManager.getDefaults();
    this.saveConfig(defaults);
    return defaults;
  }

  /**
   * Get configuration for a specific provider
   * @param provider - The provider name ('codespaces' or 'coder')
   * @returns Provider-specific configuration or undefined if not configured
   */
  getProviderConfig(provider: 'codespaces'): CodespacesProviderConfig | undefined;
  getProviderConfig(provider: 'coder'): CoderProviderConfig | undefined;
  getProviderConfig(provider: 'codespaces' | 'coder'): CodespacesProviderConfig | CoderProviderConfig | undefined {
    const config = this.loadConfig();
    return config.providers[provider];
  }

  /**
   * Update provider-specific configuration
   * @param provider - The provider name ('codespaces' or 'coder')
   * @param updates - Partial provider configuration to update
   * @throws {SpawnConfigValidationError} if validation fails after update
   */
  updateProviderConfig(
    provider: 'codespaces',
    updates: Partial<CodespacesProviderConfig>
  ): CodespacesProviderConfig;
  updateProviderConfig(
    provider: 'coder',
    updates: Partial<CoderProviderConfig>
  ): CoderProviderConfig;
  updateProviderConfig(
    provider: 'codespaces' | 'coder',
    updates: Partial<CodespacesProviderConfig> | Partial<CoderProviderConfig>
  ): CodespacesProviderConfig | CoderProviderConfig {
    const config = this.loadConfig();

    if (provider === 'codespaces') {
      const currentConfig = config.providers.codespaces || SpawnConfigManager.getDefaults().providers.codespaces!;
      config.providers.codespaces = {
        ...currentConfig,
        ...updates,
      };
    } else if (provider === 'coder') {
      const currentConfig = config.providers.coder || {};
      config.providers.coder = {
        ...currentConfig,
        ...updates,
      };
    }

    this.saveConfig(config);
    return config.providers[provider]!;
  }

  /**
   * Reset provider configuration to defaults
   * @param provider - The provider name ('codespaces' or 'coder')
   */
  resetProviderConfig(provider: 'codespaces'): CodespacesProviderConfig;
  resetProviderConfig(provider: 'coder'): CoderProviderConfig;
  resetProviderConfig(provider: 'codespaces' | 'coder'): CodespacesProviderConfig | CoderProviderConfig {
    const config = this.loadConfig();
    const defaults = SpawnConfigManager.getDefaults();

    if (provider === 'codespaces') {
      config.providers.codespaces = defaults.providers.codespaces;
    } else if (provider === 'coder') {
      // Coder doesn't have defaults yet, so just set to empty object
      config.providers.coder = {};
    }

    this.saveConfig(config);
    return config.providers[provider]!;
  }
}
