import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  DeployConfigManager,
  DeployConfigValidationError,
} from "../../../src/deploy/config";
import type { DeployConfig } from "@sudocode-ai/types";

describe("DeployConfigManager", () => {
  let tempDir: string;
  let manager: DeployConfigManager;

  beforeEach(() => {
    // Create temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-config-test-"));
    manager = new DeployConfigManager(tempDir);
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getDefaults", () => {
    it("should return default configuration", () => {
      const defaults = DeployConfigManager.getDefaults();

      expect(defaults).toEqual({
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      });
    });

    it("should return a new object each time", () => {
      const defaults1 = DeployConfigManager.getDefaults();
      const defaults2 = DeployConfigManager.getDefaults();

      expect(defaults1).toEqual(defaults2);
      expect(defaults1).not.toBe(defaults2);
    });
  });

  describe("loadConfig", () => {
    it("should create config file with defaults if it doesn't exist", () => {
      const config = manager.loadConfig();

      expect(config).toEqual(DeployConfigManager.getDefaults());

      const configPath = path.join(tempDir, "deploy-config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(DeployConfigManager.getDefaults());
    });

    it("should load existing config file", () => {
      const customConfig: DeployConfig = {
        provider: "codespaces",
        port: 8080,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "premiumLinux",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const config = manager.loadConfig();

      expect(config).toEqual(customConfig);
    });

    it("should load config with optional defaultBranch", () => {
      const customConfig: DeployConfig = {
        provider: "codespaces",
        defaultBranch: "develop",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const config = manager.loadConfig();

      expect(config).toEqual(customConfig);
      expect(config.defaultBranch).toBe("develop");
    });

    it("should throw error for invalid provider", () => {
      const invalidConfig = {
        provider: "invalid-provider",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        'Invalid provider: invalid-provider. Only "codespaces" is currently supported.'
      );
    });

    it("should throw error for invalid port (too low)", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 1023,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should throw error for invalid port (too high)", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 70000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should throw error for invalid idleTimeout (below minimum)", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 0,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Idle timeout must be at least 1 minute"
      );
    });

    it("should throw error for invalid keepAliveHours (below minimum)", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 0,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Keep-alive must be at least 1 hour"
      );
    });

    it("should throw error for invalid retentionPeriod (below minimum)", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 0,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Retention period must be at least 1 day"
      );
    });

    it("should throw error for empty machine type", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Invalid machine: Machine type must be a non-empty string."
      );
    });

    it("should throw error for invalid defaultBranch type", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
        defaultBranch: 123,
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Invalid defaultBranch: Must be a string."
      );
    });

    it("should throw error with multiple validation failures", () => {
      const invalidConfig = {
        provider: "invalid",
        port: 100,
        idleTimeout: 0,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const configPath = path.join(tempDir, "deploy-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(DeployConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(/Configuration validation failed/);
      expect(() => manager.loadConfig()).toThrow(/Invalid provider/);
      expect(() => manager.loadConfig()).toThrow(/Port must be between 1024 and 65535/);
      expect(() => manager.loadConfig()).toThrow(/Idle timeout must be at least 1 minute/);
    });
  });

  describe("saveConfig", () => {
    it("should save valid config to file", () => {
      const config: DeployConfig = {
        provider: "codespaces",
        port: 8080,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "premiumLinux",
      };

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "deploy-config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(config);
    });

    it("should save config with optional defaultBranch", () => {
      const config: DeployConfig = {
        provider: "codespaces",
        defaultBranch: "main",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "deploy-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent.defaultBranch).toBe("main");
    });

    it("should format JSON with 2-space indentation", () => {
      const config = DeployConfigManager.getDefaults();

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "deploy-config.json");
      const rawContent = fs.readFileSync(configPath, "utf8");

      expect(rawContent).toContain("  ");
      expect(rawContent).toMatch(/\{\n {2}"/);
    });

    it("should throw error for invalid config", () => {
      const invalidConfig = {
        provider: "codespaces",
        port: 100,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      } as DeployConfig;

      expect(() => manager.saveConfig(invalidConfig)).toThrow(
        DeployConfigValidationError
      );
    });

    it("should overwrite existing config", () => {
      const config1: DeployConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      };

      const config2: DeployConfig = {
        provider: "codespaces",
        port: 8080,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "premiumLinux",
      };

      manager.saveConfig(config1);
      manager.saveConfig(config2);

      const configPath = path.join(tempDir, "deploy-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(config2);
    });
  });

  describe("updateConfig", () => {
    it("should update specific config values", () => {
      // First create a config with defaults
      manager.loadConfig();

      const updates: Partial<DeployConfig> = {
        port: 8080,
        machine: "premiumLinux",
      };

      const result = manager.updateConfig(updates);

      expect(result.port).toBe(8080);
      expect(result.machine).toBe("premiumLinux");
      expect(result.provider).toBe("codespaces");
      expect(result.idleTimeout).toBe(4320);
      expect(result.keepAliveHours).toBe(72);
      expect(result.retentionPeriod).toBe(14);
    });

    it("should persist updated config to file", () => {
      manager.loadConfig();

      manager.updateConfig({ port: 9000 });

      const configPath = path.join(tempDir, "deploy-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent.port).toBe(9000);
    });

    it("should return the updated config", () => {
      manager.loadConfig();

      const result = manager.updateConfig({ port: 7000 });

      expect(result).toEqual({
        provider: "codespaces",
        port: 7000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      });
    });

    it("should throw error if update results in invalid config", () => {
      manager.loadConfig();

      expect(() => manager.updateConfig({ port: 100 })).toThrow(
        DeployConfigValidationError
      );
    });

    it("should update multiple values at once", () => {
      manager.loadConfig();

      const updates: Partial<DeployConfig> = {
        port: 5000,
        idleTimeout: 2000,
        keepAliveHours: 36,
        machine: "customMachine",
      };

      const result = manager.updateConfig(updates);

      expect(result.port).toBe(5000);
      expect(result.idleTimeout).toBe(2000);
      expect(result.keepAliveHours).toBe(36);
      expect(result.machine).toBe("customMachine");
    });

    it("should update defaultBranch", () => {
      manager.loadConfig();

      const result = manager.updateConfig({ defaultBranch: "develop" });

      expect(result.defaultBranch).toBe("develop");
    });

    it("should handle empty updates", () => {
      manager.loadConfig();
      const original = manager.loadConfig();

      const result = manager.updateConfig({});

      expect(result).toEqual(original);
    });
  });

  describe("resetConfig", () => {
    it("should reset config to defaults", () => {
      // First create a custom config
      const customConfig: DeployConfig = {
        provider: "codespaces",
        port: 8080,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "premiumLinux",
      };

      manager.saveConfig(customConfig);

      // Now reset
      const result = manager.resetConfig();

      expect(result).toEqual(DeployConfigManager.getDefaults());
    });

    it("should persist reset config to file", () => {
      manager.saveConfig({
        provider: "codespaces",
        port: 9999,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "customMachine",
      });

      manager.resetConfig();

      const configPath = path.join(tempDir, "deploy-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(DeployConfigManager.getDefaults());
    });

    it("should return the default config", () => {
      manager.saveConfig({
        provider: "codespaces",
        port: 8080,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "premiumLinux",
      });

      const result = manager.resetConfig();

      expect(result).toEqual({
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      });
    });

    it("should work when no config file exists", () => {
      const result = manager.resetConfig();

      expect(result).toEqual(DeployConfigManager.getDefaults());
    });

    it("should remove optional fields like defaultBranch", () => {
      manager.saveConfig({
        provider: "codespaces",
        defaultBranch: "develop",
        port: 8080,
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        machine: "premiumLinux",
      });

      const result = manager.resetConfig();

      expect(result.defaultBranch).toBeUndefined();
      expect(result).toEqual(DeployConfigManager.getDefaults());
    });
  });

  describe("validation edge cases", () => {
    it("should accept port 1024 (minimum valid port)", () => {
      const config: DeployConfig = {
        ...DeployConfigManager.getDefaults(),
        port: 1024,
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject port 1023 (below minimum)", () => {
      const config: DeployConfig = {
        ...DeployConfigManager.getDefaults(),
        port: 1023,
      };

      expect(() => manager.saveConfig(config)).toThrow(DeployConfigValidationError);
      expect(() => manager.saveConfig(config)).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should accept port 65535 (maximum valid port)", () => {
      const config: DeployConfig = {
        ...DeployConfigManager.getDefaults(),
        port: 65535,
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject port 65536 (above maximum)", () => {
      const config: DeployConfig = {
        ...DeployConfigManager.getDefaults(),
        port: 65536,
      };

      expect(() => manager.saveConfig(config)).toThrow(DeployConfigValidationError);
      expect(() => manager.saveConfig(config)).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should accept minimum values for timeout fields", () => {
      const config: DeployConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 1,
        keepAliveHours: 1,
        retentionPeriod: 1,
        machine: "basicLinux32gb",
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject zero values for timeout fields", () => {
      const config1: DeployConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 0,
        keepAliveHours: 1,
        retentionPeriod: 1,
        machine: "basicLinux32gb",
      };

      expect(() => manager.saveConfig(config1)).toThrow(DeployConfigValidationError);
      expect(() => manager.saveConfig(config1)).toThrow(
        "Idle timeout must be at least 1 minute"
      );

      const config2: DeployConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 1,
        keepAliveHours: 0,
        retentionPeriod: 1,
        machine: "basicLinux32gb",
      };

      expect(() => manager.saveConfig(config2)).toThrow(DeployConfigValidationError);
      expect(() => manager.saveConfig(config2)).toThrow(
        "Keep-alive must be at least 1 hour"
      );

      const config3: DeployConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 1,
        keepAliveHours: 1,
        retentionPeriod: 0,
        machine: "basicLinux32gb",
      };

      expect(() => manager.saveConfig(config3)).toThrow(DeployConfigValidationError);
      expect(() => manager.saveConfig(config3)).toThrow(
        "Retention period must be at least 1 day"
      );
    });

    it("should accept very large timeout values", () => {
      const config: DeployConfig = {
        provider: "codespaces",
        port: 3000,
        idleTimeout: 999999,
        keepAliveHours: 999999,
        retentionPeriod: 999999,
        machine: "basicLinux32gb",
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should accept machine type with special characters", () => {
      const config: DeployConfig = {
        ...DeployConfigManager.getDefaults(),
        machine: "premium-linux_32gb-v2",
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should accept defaultBranch with special characters", () => {
      const config: DeployConfig = {
        ...DeployConfigManager.getDefaults(),
        defaultBranch: "feature/my-feature_v2",
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });
  });
});
