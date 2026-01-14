import * as fs from "fs";
import * as path from "path";
import type { DeployConfig } from "@sudocode-ai/types";

/**
 * Validation error for deploy configuration
 */
export class DeployConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployConfigValidationError";
  }
}

/**
 * Manager for deployment configuration
 * Handles loading, saving, updating, and validating deploy-config.json
 */
export class DeployConfigManager {
  private configPath: string;

  constructor(outputDir: string) {
    this.configPath = path.join(outputDir, "deploy-config.json");
  }

  /**
   * Get default deployment configuration
   */
  static getDefaults(): DeployConfig {
    return {
      provider: "codespaces",
      port: 3000,
      idleTimeout: 4320,
      keepAliveHours: 72,
      retentionPeriod: 14,
      machine: "basicLinux32gb",
    };
  }

  /**
   * Validate deployment configuration
   * @throws {DeployConfigValidationError} if validation fails
   */
  private validateConfig(config: DeployConfig): void {
    const errors: string[] = [];

    // Validate provider
    if (config.provider !== "codespaces") {
      errors.push(
        `Invalid provider: ${config.provider}. Only "codespaces" is currently supported.`
      );
    }

    // Validate port (1024-65535 for non-privileged ports)
    if (config.port < 1024 || config.port > 65535) {
      errors.push(
        `Port must be between 1024 and 65535`
      );
    }

    // Validate idleTimeout (minimum 1 minute)
    if (config.idleTimeout < 1) {
      errors.push(
        `Idle timeout must be at least 1 minute`
      );
    }

    // Validate keepAliveHours (minimum 1 hour)
    if (config.keepAliveHours < 1) {
      errors.push(
        `Keep-alive must be at least 1 hour`
      );
    }

    // Validate retentionPeriod (minimum 1 day)
    if (config.retentionPeriod < 1) {
      errors.push(
        `Retention period must be at least 1 day`
      );
    }

    // Validate machine type
    if (!config.machine || typeof config.machine !== "string") {
      errors.push("Invalid machine: Machine type must be a non-empty string.");
    }

    // Validate defaultBranch if provided
    if (
      config.defaultBranch !== undefined &&
      typeof config.defaultBranch !== "string"
    ) {
      errors.push("Invalid defaultBranch: Must be a string.");
    }

    if (errors.length > 0) {
      throw new DeployConfigValidationError(
        `Configuration validation failed:\n${errors.join("\n")}`
      );
    }
  }

  /**
   * Load deployment configuration
   * Creates file with defaults if it doesn't exist
   */
  loadConfig(): DeployConfig {
    if (!fs.existsSync(this.configPath)) {
      const defaults = DeployConfigManager.getDefaults();
      this.saveConfig(defaults);
      return defaults;
    }

    const content = fs.readFileSync(this.configPath, "utf8");
    const config = JSON.parse(content) as DeployConfig;
    this.validateConfig(config);
    return config;
  }

  /**
   * Save deployment configuration
   * @throws {DeployConfigValidationError} if validation fails
   */
  saveConfig(config: DeployConfig): void {
    this.validateConfig(config);
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf8");
  }

  /**
   * Update specific configuration values
   * @throws {DeployConfigValidationError} if validation fails after update
   */
  updateConfig(updates: Partial<DeployConfig>): DeployConfig {
    const config = this.loadConfig();
    const updatedConfig = { ...config, ...updates };
    this.saveConfig(updatedConfig);
    return updatedConfig;
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): DeployConfig {
    const defaults = DeployConfigManager.getDefaults();
    this.saveConfig(defaults);
    return defaults;
  }
}
