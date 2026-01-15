import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  SpawnConfigManager,
  SpawnConfigValidationError,
  validateSpawnConfig,
  VALID_CODESPACES_MACHINE_TYPES,
} from "../../../src/remote/config";
import type { SpawnConfig, CodespacesProviderConfig } from "@sudocode-ai/types";

describe("SpawnConfigManager", () => {
  let tempDir: string;
  let manager: SpawnConfigManager;

  beforeEach(() => {
    // Create temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-config-test-"));
    manager = new SpawnConfigManager(tempDir);
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getDefaults", () => {
    it("should return default configuration", () => {
      const defaults = SpawnConfigManager.getDefaults();

      expect(defaults).toEqual({
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
      });
    });

    it("should return a new object each time", () => {
      const defaults1 = SpawnConfigManager.getDefaults();
      const defaults2 = SpawnConfigManager.getDefaults();

      expect(defaults1).toEqual(defaults2);
      expect(defaults1).not.toBe(defaults2);
    });
  });

  describe("loadConfig", () => {
    it("should create config file with defaults if it doesn't exist", () => {
      const config = manager.loadConfig();

      expect(config).toEqual(SpawnConfigManager.getDefaults());

      const configPath = path.join(tempDir, "spawn-config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(SpawnConfigManager.getDefaults());
    });

    it("should load existing config file", () => {
      const customConfig: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 8080,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "standardLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const config = manager.loadConfig();

      expect(config).toEqual(customConfig);
    });

    it("should load config with optional defaultBranch", () => {
      const customConfig: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            defaultBranch: "develop",
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const config = manager.loadConfig();

      expect(config).toEqual(customConfig);
      expect(config.providers.codespaces?.defaultBranch).toBe("develop");
    });

    it("should load config with multiple providers", () => {
      const customConfig: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
          coder: {},
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const config = manager.loadConfig();

      expect(config).toEqual(customConfig);
      expect(config.providers.codespaces).toBeDefined();
      expect(config.providers.coder).toBeDefined();
    });

    it("should throw error for missing version", () => {
      const invalidConfig = {
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

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Config version must be a non-empty string"
      );
    });

    it("should throw error for missing providers", () => {
      const invalidConfig = {
        version: "0.1.0",
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Config must have a providers object"
      );
    });

    it("should throw error for invalid port (too low)", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 1023,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should throw error for invalid port (too high)", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 70000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should throw error for invalid idleTimeout (below minimum)", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 0,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Idle timeout must be at least 1 minute"
      );
    });

    it("should throw error for invalid keepAliveHours (below minimum)", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 0,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Keep-alive hours must be at least 1 hour"
      );
    });

    it("should throw error for invalid retentionPeriod (below minimum)", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 0,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Retention period must be at least 1 day"
      );
    });

    it("should throw error for empty machine type", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Machine type must be a non-empty string"
      );
    });

    it("should throw error for invalid defaultBranch type", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
            defaultBranch: 123,
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Default branch must be a string"
      );
    });

    it("should throw error with multiple validation failures", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 100,
            idleTimeout: 0,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(/Configuration validation failed/);
      expect(() => manager.loadConfig()).toThrow(/Port must be between 1024 and 65535/);
      expect(() => manager.loadConfig()).toThrow(/Idle timeout must be at least 1 minute/);
    });

    it("should throw error for invalid coder provider type", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
          coder: "invalid",
        },
      };

      const configPath = path.join(tempDir, "spawn-config.json");
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => manager.loadConfig()).toThrow(SpawnConfigValidationError);
      expect(() => manager.loadConfig()).toThrow(
        "Coder provider config must be an object"
      );
    });
  });

  describe("saveConfig", () => {
    it("should save valid config to file", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 8080,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "premiumLinux",
          },
        },
      };

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "spawn-config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(config);
    });

    it("should save config with optional defaultBranch", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            defaultBranch: "main",
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      };

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "spawn-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent.providers.codespaces.defaultBranch).toBe("main");
    });

    it("should format JSON with 2-space indentation", () => {
      const config = SpawnConfigManager.getDefaults();

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "spawn-config.json");
      const rawContent = fs.readFileSync(configPath, "utf8");

      expect(rawContent).toContain("  ");
      expect(rawContent).toMatch(/\{\n {2}"/);
    });

    it("should throw error for invalid config", () => {
      const invalidConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 100,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
        },
      } as SpawnConfig;

      expect(() => manager.saveConfig(invalidConfig)).toThrow(
        SpawnConfigValidationError
      );
    });

    it("should overwrite existing config", () => {
      const config1: SpawnConfig = {
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

      const config2: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 8080,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "premiumLinux",
          },
        },
      };

      manager.saveConfig(config1);
      manager.saveConfig(config2);

      const configPath = path.join(tempDir, "spawn-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(config2);
    });

    it("should save config with multiple providers", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
          coder: {},
        },
      };

      manager.saveConfig(config);

      const configPath = path.join(tempDir, "spawn-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent.providers.coder).toBeDefined();
    });
  });

  describe("updateConfig", () => {
    it("should update specific config values", () => {
      // First create a config with defaults
      manager.loadConfig();

      const updates: Partial<SpawnConfig> = {
        providers: {
          codespaces: {
            port: 8080,
            machine: "premiumLinux",
          } as any,
        },
      };

      const result = manager.updateConfig(updates);

      expect(result.providers.codespaces?.port).toBe(8080);
      expect(result.providers.codespaces?.machine).toBe("premiumLinux");
      expect(result.providers.codespaces?.idleTimeout).toBe(4320);
      expect(result.providers.codespaces?.keepAliveHours).toBe(72);
      expect(result.providers.codespaces?.retentionPeriod).toBe(14);
    });

    it("should persist updated config to file", () => {
      manager.loadConfig();

      manager.updateConfig({
        providers: {
          codespaces: {
            port: 9000,
          } as any,
        },
      });

      const configPath = path.join(tempDir, "spawn-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent.providers.codespaces.port).toBe(9000);
    });

    it("should return the updated config", () => {
      manager.loadConfig();

      const result = manager.updateConfig({
        providers: {
          codespaces: {
            port: 7000,
          } as any,
        },
      });

      expect(result.providers.codespaces?.port).toBe(7000);
    });

    it("should throw error if update results in invalid config", () => {
      manager.loadConfig();

      expect(() =>
        manager.updateConfig({
          providers: {
            codespaces: {
              port: 100,
            } as any,
          },
        })
      ).toThrow(SpawnConfigValidationError);
    });

    it("should update multiple values at once", () => {
      manager.loadConfig();

      const updates: Partial<SpawnConfig> = {
        providers: {
          codespaces: {
            port: 5000,
            idleTimeout: 2000,
            keepAliveHours: 36,
            machine: "standardLinux32gb",
          } as any,
        },
      };

      const result = manager.updateConfig(updates);

      expect(result.providers.codespaces?.port).toBe(5000);
      expect(result.providers.codespaces?.idleTimeout).toBe(2000);
      expect(result.providers.codespaces?.keepAliveHours).toBe(36);
      expect(result.providers.codespaces?.machine).toBe("standardLinux32gb");
    });

    it("should update defaultBranch", () => {
      manager.loadConfig();

      const result = manager.updateConfig({
        providers: {
          codespaces: {
            defaultBranch: "develop",
          } as any,
        },
      });

      expect(result.providers.codespaces?.defaultBranch).toBe("develop");
    });

    it("should handle empty updates", () => {
      manager.loadConfig();
      const original = manager.loadConfig();

      const result = manager.updateConfig({});

      expect(result).toEqual(original);
    });

    it("should update version", () => {
      manager.loadConfig();

      const result = manager.updateConfig({ version: "0.2.0" });

      expect(result.version).toBe("0.2.0");
    });

    it("should add new provider", () => {
      manager.loadConfig();

      const result = manager.updateConfig({
        providers: {
          coder: {},
        },
      });

      expect(result.providers.coder).toBeDefined();
      expect(result.providers.codespaces).toBeDefined();
    });
  });

  describe("resetConfig", () => {
    it("should reset config to defaults", () => {
      // First create a custom config
      const customConfig: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 8080,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "standardLinux32gb",
          },
        },
      };

      manager.saveConfig(customConfig);

      // Now reset
      const result = manager.resetConfig();

      expect(result).toEqual(SpawnConfigManager.getDefaults());
    });

    it("should persist reset config to file", () => {
      manager.saveConfig({
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 9999,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "standardLinux32gb",
          },
        },
      });

      manager.resetConfig();

      const configPath = path.join(tempDir, "spawn-config.json");
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(fileContent).toEqual(SpawnConfigManager.getDefaults());
    });

    it("should return the default config", () => {
      manager.saveConfig({
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 8080,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "standardLinux32gb",
          },
        },
      });

      const result = manager.resetConfig();

      expect(result).toEqual(SpawnConfigManager.getDefaults());
    });

    it("should work when no config file exists", () => {
      const result = manager.resetConfig();

      expect(result).toEqual(SpawnConfigManager.getDefaults());
    });

    it("should remove optional fields like defaultBranch", () => {
      manager.saveConfig({
        version: "0.1.0",
        providers: {
          codespaces: {
            defaultBranch: "develop",
            port: 8080,
            idleTimeout: 1000,
            keepAliveHours: 48,
            retentionPeriod: 7,
            machine: "standardLinux32gb",
          },
        },
      });

      const result = manager.resetConfig();

      expect(result.providers.codespaces?.defaultBranch).toBeUndefined();
      expect(result).toEqual(SpawnConfigManager.getDefaults());
    });

    it("should remove additional providers", () => {
      manager.saveConfig({
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
          coder: {},
        },
      });

      const result = manager.resetConfig();

      expect(result.providers.coder).toBeUndefined();
      expect(result).toEqual(SpawnConfigManager.getDefaults());
    });
  });

  describe("getProviderConfig", () => {
    it("should return codespaces config", () => {
      manager.loadConfig();

      const config = manager.getProviderConfig("codespaces");

      expect(config).toEqual({
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      });
    });

    it("should return undefined for unconfigured provider", () => {
      manager.loadConfig();

      const config = manager.getProviderConfig("coder");

      expect(config).toBeUndefined();
    });

    it("should return coder config when configured", () => {
      manager.saveConfig({
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
            retentionPeriod: 14,
            machine: "basicLinux32gb",
          },
          coder: {},
        },
      });

      const config = manager.getProviderConfig("coder");

      expect(config).toEqual({});
    });

    it("should return updated config after update", () => {
      manager.loadConfig();

      manager.updateConfig({
        providers: {
          codespaces: {
            port: 5000,
          } as any,
        },
      });

      const config = manager.getProviderConfig("codespaces");

      expect(config?.port).toBe(5000);
    });
  });

  describe("validation edge cases", () => {
    it("should accept port 1024 (minimum valid port)", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            ...SpawnConfigManager.getDefaults().providers.codespaces!,
            port: 1024,
          },
        },
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject port 1023 (below minimum)", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            ...SpawnConfigManager.getDefaults().providers.codespaces!,
            port: 1023,
          },
        },
      };

      expect(() => manager.saveConfig(config)).toThrow(SpawnConfigValidationError);
      expect(() => manager.saveConfig(config)).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should accept port 65535 (maximum valid port)", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            ...SpawnConfigManager.getDefaults().providers.codespaces!,
            port: 65535,
          },
        },
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject port 65536 (above maximum)", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            ...SpawnConfigManager.getDefaults().providers.codespaces!,
            port: 65536,
          },
        },
      };

      expect(() => manager.saveConfig(config)).toThrow(SpawnConfigValidationError);
      expect(() => manager.saveConfig(config)).toThrow(
        "Port must be between 1024 and 65535"
      );
    });

    it("should accept minimum values for timeout fields", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 1,
            keepAliveHours: 1,
            retentionPeriod: 1,
            machine: "basicLinux32gb",
          },
        },
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject zero values for timeout fields", () => {
      const config1: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 0,
            keepAliveHours: 1,
            retentionPeriod: 1,
            machine: "basicLinux32gb",
          },
        },
      };

      expect(() => manager.saveConfig(config1)).toThrow(SpawnConfigValidationError);
      expect(() => manager.saveConfig(config1)).toThrow(
        "Idle timeout must be at least 1 minute"
      );

      const config2: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 1,
            keepAliveHours: 0,
            retentionPeriod: 1,
            machine: "basicLinux32gb",
          },
        },
      };

      expect(() => manager.saveConfig(config2)).toThrow(SpawnConfigValidationError);
      expect(() => manager.saveConfig(config2)).toThrow(
        "Keep-alive hours must be at least 1 hour"
      );

      const config3: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 1,
            keepAliveHours: 1,
            retentionPeriod: 0,
            machine: "basicLinux32gb",
          },
        },
      };

      expect(() => manager.saveConfig(config3)).toThrow(SpawnConfigValidationError);
      expect(() => manager.saveConfig(config3)).toThrow(
        "Retention period must be at least 1 day"
      );
    });

    it("should accept very large timeout values", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            port: 3000,
            idleTimeout: 999999,
            keepAliveHours: 999999,
            retentionPeriod: 999999,
            machine: "basicLinux32gb",
          },
        },
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should reject invalid machine types", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            ...SpawnConfigManager.getDefaults().providers.codespaces!,
            machine: "premium-linux_32gb-v2",
          },
        },
      };

      expect(() => manager.saveConfig(config)).toThrow(SpawnConfigValidationError);
      expect(() => manager.saveConfig(config)).toThrow(/Machine type must be one of:/);
    });

    it("should accept defaultBranch with special characters", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          codespaces: {
            ...SpawnConfigManager.getDefaults().providers.codespaces!,
            defaultBranch: "feature/my-feature_v2",
          },
        },
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should accept empty providers object", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {},
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });

    it("should accept config with only coder provider", () => {
      const config: SpawnConfig = {
        version: "0.1.0",
        providers: {
          coder: {},
        },
      };

      expect(() => manager.saveConfig(config)).not.toThrow();
    });
  });

  describe("validateSpawnConfig standalone function", () => {
    describe("port validation", () => {
      it("should accept valid ports", () => {
        expect(() => validateSpawnConfig({ port: 1024 })).not.toThrow();
        expect(() => validateSpawnConfig({ port: 3000 })).not.toThrow();
        expect(() => validateSpawnConfig({ port: 65535 })).not.toThrow();
      });

      it("should reject ports below 1024", () => {
        expect(() => validateSpawnConfig({ port: 1023 })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ port: 1023 })).toThrow(
          "Port must be between 1024 and 65535"
        );
      });

      it("should reject ports above 65535", () => {
        expect(() => validateSpawnConfig({ port: 65536 })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ port: 65536 })).toThrow(
          "Port must be between 1024 and 65535"
        );
      });

      it("should accept undefined port", () => {
        expect(() => validateSpawnConfig({})).not.toThrow();
      });
    });

    describe("idleTimeout validation", () => {
      it("should accept valid idle timeouts", () => {
        expect(() => validateSpawnConfig({ idleTimeout: 1 })).not.toThrow();
        expect(() => validateSpawnConfig({ idleTimeout: 100 })).not.toThrow();
        expect(() => validateSpawnConfig({ idleTimeout: 999999 })).not.toThrow();
      });

      it("should reject idle timeout below 1 minute", () => {
        expect(() => validateSpawnConfig({ idleTimeout: 0 })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ idleTimeout: 0 })).toThrow(
          "Idle timeout must be at least 1 minute"
        );
      });

      it("should reject negative idle timeout", () => {
        expect(() => validateSpawnConfig({ idleTimeout: -1 })).toThrow(
          SpawnConfigValidationError
        );
      });
    });

    describe("keepAliveHours validation", () => {
      it("should accept valid keep-alive hours", () => {
        expect(() => validateSpawnConfig({ keepAliveHours: 1 })).not.toThrow();
        expect(() => validateSpawnConfig({ keepAliveHours: 72 })).not.toThrow();
        expect(() => validateSpawnConfig({ keepAliveHours: 999999 })).not.toThrow();
      });

      it("should reject keep-alive hours below 1 hour", () => {
        expect(() => validateSpawnConfig({ keepAliveHours: 0 })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ keepAliveHours: 0 })).toThrow(
          "Keep-alive hours must be at least 1 hour"
        );
      });

      it("should reject negative keep-alive hours", () => {
        expect(() => validateSpawnConfig({ keepAliveHours: -1 })).toThrow(
          SpawnConfigValidationError
        );
      });
    });

    describe("retentionPeriod validation", () => {
      it("should accept valid retention periods", () => {
        expect(() => validateSpawnConfig({ retentionPeriod: 1 })).not.toThrow();
        expect(() => validateSpawnConfig({ retentionPeriod: 14 })).not.toThrow();
        expect(() => validateSpawnConfig({ retentionPeriod: 999999 })).not.toThrow();
      });

      it("should reject retention period below 1 day", () => {
        expect(() => validateSpawnConfig({ retentionPeriod: 0 })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ retentionPeriod: 0 })).toThrow(
          "Retention period must be at least 1 day"
        );
      });

      it("should reject negative retention period", () => {
        expect(() => validateSpawnConfig({ retentionPeriod: -1 })).toThrow(
          SpawnConfigValidationError
        );
      });
    });

    describe("machine type validation", () => {
      it("should accept valid machine types", () => {
        VALID_CODESPACES_MACHINE_TYPES.forEach((machineType) => {
          expect(() => validateSpawnConfig({ machine: machineType })).not.toThrow();
        });
      });

      it("should reject invalid machine types", () => {
        expect(() => validateSpawnConfig({ machine: "invalidMachine" })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ machine: "invalidMachine" })).toThrow(
          /Machine type must be one of:/
        );
      });

      it("should reject empty machine type", () => {
        expect(() => validateSpawnConfig({ machine: "" })).toThrow(
          SpawnConfigValidationError
        );
        expect(() => validateSpawnConfig({ machine: "" })).toThrow(
          "Machine type must be a non-empty string"
        );
      });

      it("should include list of valid machine types in error", () => {
        try {
          validateSpawnConfig({ machine: "invalid" });
          expect.fail("Should have thrown validation error");
        } catch (error) {
          expect(error).toBeInstanceOf(SpawnConfigValidationError);
          const errorMessage = (error as Error).message;
          VALID_CODESPACES_MACHINE_TYPES.forEach((machineType) => {
            expect(errorMessage).toContain(machineType);
          });
        }
      });

      it("should accept undefined machine type", () => {
        expect(() => validateSpawnConfig({})).not.toThrow();
      });
    });

    describe("defaultBranch validation", () => {
      it("should accept valid default branches", () => {
        expect(() => validateSpawnConfig({ defaultBranch: "main" })).not.toThrow();
        expect(() => validateSpawnConfig({ defaultBranch: "develop" })).not.toThrow();
        expect(() => validateSpawnConfig({ defaultBranch: "feature/test" })).not.toThrow();
      });

      it("should reject non-string default branch", () => {
        expect(() =>
          validateSpawnConfig({ defaultBranch: 123 as any })
        ).toThrow(SpawnConfigValidationError);
        expect(() =>
          validateSpawnConfig({ defaultBranch: 123 as any })
        ).toThrow("Default branch must be a string");
      });

      it("should accept undefined default branch", () => {
        expect(() => validateSpawnConfig({})).not.toThrow();
      });
    });

    describe("multiple validation errors", () => {
      it("should report all validation errors at once", () => {
        const invalidConfig: Partial<CodespacesProviderConfig> = {
          port: 100,
          idleTimeout: 0,
          keepAliveHours: 0,
          retentionPeriod: 0,
          machine: "invalid",
        };

        try {
          validateSpawnConfig(invalidConfig);
          expect.fail("Should have thrown validation error");
        } catch (error) {
          expect(error).toBeInstanceOf(SpawnConfigValidationError);
          const errorMessage = (error as Error).message;
          
          // Check that all errors are included
          expect(errorMessage).toContain("Port must be between 1024 and 65535");
          expect(errorMessage).toContain("Idle timeout must be at least 1 minute");
          expect(errorMessage).toContain("Keep-alive hours must be at least 1 hour");
          expect(errorMessage).toContain("Retention period must be at least 1 day");
          expect(errorMessage).toContain("Machine type must be one of:");
        }
      });

      it("should format error messages with bullet points", () => {
        try {
          validateSpawnConfig({ port: 100, idleTimeout: 0 });
          expect.fail("Should have thrown validation error");
        } catch (error) {
          const errorMessage = (error as Error).message;
          expect(errorMessage).toContain("Codespaces configuration validation failed:");
          expect(errorMessage).toContain("\n  - ");
        }
      });
    });

    describe("partial config validation", () => {
      it("should validate only provided fields", () => {
        // Only port provided - should fail
        expect(() => validateSpawnConfig({ port: 100 })).toThrow();

        // Only idleTimeout provided - should fail
        expect(() => validateSpawnConfig({ idleTimeout: 0 })).toThrow();

        // Only valid port provided - should pass
        expect(() => validateSpawnConfig({ port: 3000 })).not.toThrow();
      });

      it("should accept empty config", () => {
        expect(() => validateSpawnConfig({})).not.toThrow();
      });

      it("should validate complex partial config", () => {
        const partialConfig: Partial<CodespacesProviderConfig> = {
          port: 8080,
          machine: "basicLinux32gb",
        };

        expect(() => validateSpawnConfig(partialConfig)).not.toThrow();
      });
    });

    describe("boundary value testing", () => {
      it("should accept minimum boundary values", () => {
        const config: Partial<CodespacesProviderConfig> = {
          port: 1024,
          idleTimeout: 1,
          keepAliveHours: 1,
          retentionPeriod: 1,
        };

        expect(() => validateSpawnConfig(config)).not.toThrow();
      });

      it("should accept maximum boundary values", () => {
        const config: Partial<CodespacesProviderConfig> = {
          port: 65535,
          idleTimeout: Number.MAX_SAFE_INTEGER,
          keepAliveHours: Number.MAX_SAFE_INTEGER,
          retentionPeriod: Number.MAX_SAFE_INTEGER,
        };

        expect(() => validateSpawnConfig(config)).not.toThrow();
      });

      it("should reject below minimum boundary values", () => {
        expect(() => validateSpawnConfig({ port: 1023 })).toThrow();
        expect(() => validateSpawnConfig({ idleTimeout: 0 })).toThrow();
        expect(() => validateSpawnConfig({ keepAliveHours: 0 })).toThrow();
        expect(() => validateSpawnConfig({ retentionPeriod: 0 })).toThrow();
      });

      it("should reject above maximum boundary values", () => {
        expect(() => validateSpawnConfig({ port: 65536 })).toThrow();
      });
    });

    describe("valid machine types constant", () => {
      it("should export valid machine types array", () => {
        expect(VALID_CODESPACES_MACHINE_TYPES).toBeDefined();
        expect(Array.isArray(VALID_CODESPACES_MACHINE_TYPES)).toBe(true);
        expect(VALID_CODESPACES_MACHINE_TYPES.length).toBeGreaterThan(0);
      });

      it("should include common machine types", () => {
        expect(VALID_CODESPACES_MACHINE_TYPES).toContain("basicLinux32gb");
        expect(VALID_CODESPACES_MACHINE_TYPES).toContain("standardLinux32gb");
        expect(VALID_CODESPACES_MACHINE_TYPES).toContain("premiumLinux");
      });
    });
  });
});
