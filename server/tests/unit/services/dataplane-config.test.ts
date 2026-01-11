/**
 * Unit tests for Dataplane Configuration
 *
 * Tests configuration loading, validation, and defaults.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadDataplaneConfig,
  validateDataplaneConfig,
  getDataplaneConfig,
  isDataplaneEnabled,
  clearDataplaneConfigCache,
  DEFAULT_DATAPLANE_CONFIG,
  type DataplaneConfig,
} from "../../../src/services/dataplane-config.js";

describe("Dataplane Configuration", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-dataplane-config-test-")
    );
    clearDataplaneConfigCache();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    clearDataplaneConfigCache();
  });

  describe("DEFAULT_DATAPLANE_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_DATAPLANE_CONFIG.enabled).toBe(false);
      expect(DEFAULT_DATAPLANE_CONFIG.dbPath).toBe("dataplane.db");
      expect(DEFAULT_DATAPLANE_CONFIG.conflictStrategy.default).toBe("defer");
      expect(DEFAULT_DATAPLANE_CONFIG.conflictStrategy.code).toBe("defer");
      expect(DEFAULT_DATAPLANE_CONFIG.conflictStrategy.cascade).toBe(
        "skip_conflicting"
      );
      expect(DEFAULT_DATAPLANE_CONFIG.autoReconcile).toBe(true);
      expect(DEFAULT_DATAPLANE_CONFIG.cascadeOnMerge).toBe(false);
      expect(DEFAULT_DATAPLANE_CONFIG.mergeQueue.enabled).toBe(false);
      expect(DEFAULT_DATAPLANE_CONFIG.streams.branchPrefix).toBe("sudocode");
      expect(DEFAULT_DATAPLANE_CONFIG.recovery.runOnStartup).toBe(true);
    });
  });

  describe("loadDataplaneConfig", () => {
    it("returns defaults when no config file exists", () => {
      const { config, warnings } = loadDataplaneConfig(testDir);

      expect(config).toEqual(DEFAULT_DATAPLANE_CONFIG);
      expect(warnings).toHaveLength(0);
    });

    it("returns defaults when config.json has no dataplane section", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ version: "1.0.0" })
      );

      const { config, warnings } = loadDataplaneConfig(testDir);

      expect(config).toEqual(DEFAULT_DATAPLANE_CONFIG);
      expect(warnings).toHaveLength(0);
    });

    it("loads enabled flag from config", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: { enabled: true },
        })
      );

      const { config, warnings } = loadDataplaneConfig(testDir);

      expect(config.enabled).toBe(true);
      expect(warnings).toHaveLength(0);
    });

    it("loads full configuration from config file", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: {
            enabled: true,
            dbPath: "custom.db",
            conflictStrategy: {
              default: "ours",
              code: "theirs",
              cascade: "defer_conflicts",
            },
            autoReconcile: false,
            cascadeOnMerge: true,
            mergeQueue: {
              enabled: true,
              autoEnqueue: true,
              requireQueue: false,
            },
            streams: {
              branchPrefix: "custom-prefix",
              autoCleanupAbandoned: false,
              abandonedRetentionDays: 14,
            },
            recovery: {
              runOnStartup: false,
              enableCheckpoints: false,
            },
          },
        })
      );

      const { config, warnings } = loadDataplaneConfig(testDir);

      expect(warnings).toHaveLength(0);
      expect(config.enabled).toBe(true);
      expect(config.dbPath).toBe("custom.db");
      expect(config.conflictStrategy.default).toBe("ours");
      expect(config.conflictStrategy.code).toBe("theirs");
      expect(config.conflictStrategy.cascade).toBe("defer_conflicts");
      expect(config.autoReconcile).toBe(false);
      expect(config.cascadeOnMerge).toBe(true);
      expect(config.mergeQueue.enabled).toBe(true);
      expect(config.mergeQueue.autoEnqueue).toBe(true);
      expect(config.streams.branchPrefix).toBe("custom-prefix");
      expect(config.streams.autoCleanupAbandoned).toBe(false);
      expect(config.streams.abandonedRetentionDays).toBe(14);
      expect(config.recovery.runOnStartup).toBe(false);
      expect(config.recovery.enableCheckpoints).toBe(false);
    });

    it("returns defaults with warning on JSON parse error", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        "invalid json {"
      );

      const { config, warnings } = loadDataplaneConfig(testDir);

      expect(config).toEqual(DEFAULT_DATAPLANE_CONFIG);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Failed to load dataplane config");
    });
  });

  describe("validateDataplaneConfig", () => {
    it("validates enabled field type", () => {
      const { config, warnings } = validateDataplaneConfig({
        enabled: "true" as unknown as boolean,
      });

      expect(config.enabled).toBe(false); // Default
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("enabled");
    });

    it("validates dbPath field type", () => {
      const { config, warnings } = validateDataplaneConfig({
        dbPath: 123 as unknown as string,
      });

      expect(config.dbPath).toBe("dataplane.db"); // Default
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("dbPath");
    });

    it("validates conflictStrategy.default", () => {
      const { config, warnings } = validateDataplaneConfig({
        conflictStrategy: {
          default: "invalid" as any,
          code: "defer",
          cascade: "skip_conflicting",
        },
      });

      expect(config.conflictStrategy.default).toBe("defer"); // Default
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("conflictStrategy.default");
    });

    it("validates conflictStrategy.cascade", () => {
      const { config, warnings } = validateDataplaneConfig({
        conflictStrategy: {
          default: "defer",
          code: "defer",
          cascade: "invalid" as any,
        },
      });

      expect(config.conflictStrategy.cascade).toBe("skip_conflicting"); // Default
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("conflictStrategy.cascade");
    });

    it("validates mergeQueue settings", () => {
      const { config, warnings } = validateDataplaneConfig({
        mergeQueue: {
          enabled: "yes" as unknown as boolean,
          autoEnqueue: false,
          requireQueue: false,
        },
      });

      expect(config.mergeQueue.enabled).toBe(false); // Default
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("mergeQueue.enabled");
    });

    it("validates streams.abandonedRetentionDays", () => {
      const { config, warnings } = validateDataplaneConfig({
        streams: {
          branchPrefix: "sudocode",
          autoCleanupAbandoned: true,
          abandonedRetentionDays: -5,
        },
      });

      expect(config.streams.abandonedRetentionDays).toBe(30); // Default
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("abandonedRetentionDays");
    });

    it("accepts valid partial configuration", () => {
      const { config, warnings } = validateDataplaneConfig({
        enabled: true,
        conflictStrategy: {
          default: "ours",
          code: "defer",
          cascade: "skip_conflicting",
        },
      });

      expect(warnings).toHaveLength(0);
      expect(config.enabled).toBe(true);
      expect(config.conflictStrategy.default).toBe("ours");
      expect(config.dbPath).toBe("dataplane.db"); // Default retained
    });
  });

  describe("getDataplaneConfig (singleton)", () => {
    it("caches configuration for same project root", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const config1 = getDataplaneConfig(testDir);
      const config2 = getDataplaneConfig(testDir);

      expect(config1).toBe(config2); // Same object reference
      expect(config1.enabled).toBe(true);
    });

    it("reloads configuration when forceReload is true", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const config1 = getDataplaneConfig(testDir);
      expect(config1.enabled).toBe(true);

      // Update file
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: false } })
      );

      // Without forceReload - returns cached
      const config2 = getDataplaneConfig(testDir);
      expect(config2.enabled).toBe(true);

      // With forceReload - reads new file
      const config3 = getDataplaneConfig(testDir, true);
      expect(config3.enabled).toBe(false);
    });
  });

  describe("isDataplaneEnabled", () => {
    it("returns false when dataplane is not configured", () => {
      expect(isDataplaneEnabled(testDir)).toBe(false);
    });

    it("returns true when dataplane is enabled in config", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      clearDataplaneConfigCache();
      expect(isDataplaneEnabled(testDir)).toBe(true);
    });

    it("returns false when dataplane is explicitly disabled", () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: false } })
      );

      clearDataplaneConfigCache();
      expect(isDataplaneEnabled(testDir)).toBe(false);
    });
  });
});
