/**
 * Tests for plugin CLI commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handlePluginList,
  handlePluginStatus,
  handlePluginConfigure,
  handlePluginTest,
  handlePluginInfo,
} from "../../../src/cli/plugin-commands.js";
import * as pluginLoader from "../../../src/integrations/plugin-loader.js";
import * as config from "../../../src/config.js";

// Mock chalk to capture styled output with chained methods
vi.mock("chalk", () => {
  const createChalkMock = () => {
    const fn = (s: string) => s;
    const mock = Object.assign(fn, { bold: (s: string) => s });
    return mock;
  };

  return {
    default: {
      blue: createChalkMock(),
      green: createChalkMock(),
      yellow: createChalkMock(),
      red: createChalkMock(),
      gray: createChalkMock(),
      bold: (s: string) => s,
    },
  };
});

describe("Plugin Commands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("handlePluginList", () => {
    it("should list available plugins in JSON format", async () => {
      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginList(ctx, {});

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);

      // Check structure
      const first = parsed[0];
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("package");
      expect(first).toHaveProperty("installed");
    });

    it("should list available plugins in text format", async () => {
      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: false,
      };

      await handlePluginList(ctx, {});

      // Should have been called multiple times for formatted output
      expect(consoleSpy).toHaveBeenCalled();

      // Check that output includes plugin names
      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("beads");
    });
  });

  describe("handlePluginStatus", () => {
    it("should show status in JSON format", async () => {
      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginStatus(ctx);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed)).toBe(true);
    });

    it("should show helpful message when no plugins installed", async () => {
      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: false,
      };

      await handlePluginStatus(ctx);

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      // Should show either installed plugins or "no plugins" message
      expect(allOutput.length).toBeGreaterThan(0);
    });
  });

  describe("getFirstPartyPlugins", () => {
    it("should return list of first-party plugins", () => {
      const plugins = pluginLoader.getFirstPartyPlugins();

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBeGreaterThan(0);

      // Check structure
      plugins.forEach((p) => {
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("package");
        expect(p.package).toMatch(/^@sudocode-ai\/integration-/);
      });
    });

    it("should include beads plugin", () => {
      const plugins = pluginLoader.getFirstPartyPlugins();
      const beads = plugins.find((p) => p.name === "beads");

      expect(beads).toBeDefined();
      expect(beads?.package).toBe("@sudocode-ai/integration-beads");
    });
  });

  describe("resolvePluginPath", () => {
    it("should resolve short name to full package", () => {
      const path = pluginLoader.resolvePluginPath("beads");
      expect(path).toBe("@sudocode-ai/integration-beads");
    });

    it("should pass through scoped packages", () => {
      const path = pluginLoader.resolvePluginPath("@my-org/my-plugin");
      expect(path).toBe("@my-org/my-plugin");
    });

    it("should pass through paths with slashes", () => {
      const path = pluginLoader.resolvePluginPath("./local/plugin");
      expect(path).toBe("./local/plugin");
    });

    it("should generate package name for unknown short names", () => {
      const path = pluginLoader.resolvePluginPath("unknown");
      expect(path).toBe("@sudocode-ai/integration-unknown");
    });
  });

  describe("handlePluginConfigure", () => {
    const mockPlugin = {
      name: "test-plugin",
      displayName: "Test Plugin",
      version: "1.0.0",
      validateConfig: vi.fn(),
      testConnection: vi.fn(),
      createProvider: vi.fn(),
      configSchema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string" as const,
            title: "Path",
            required: true,
          },
        },
        required: ["path"],
      },
    };

    beforeEach(() => {
      vi.spyOn(pluginLoader, "loadPlugin").mockResolvedValue(mockPlugin);
      vi.spyOn(config, "getConfig").mockReturnValue({ version: "0.1.0" });
      vi.spyOn(config, "updateConfig").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should configure plugin with valid options", async () => {
      mockPlugin.validateConfig.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginConfigure(ctx, "test-plugin", {
        set: ["path=.test"],
      });

      expect(mockPlugin.validateConfig).toHaveBeenCalledWith({ path: ".test" });
      expect(config.updateConfig).toHaveBeenCalled();

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.config.options.path).toBe(".test");
    });

    it("should fail configuration with invalid options", async () => {
      mockPlugin.validateConfig.mockReturnValue({
        valid: false,
        errors: ["path is required"],
        warnings: [],
      });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginConfigure(ctx, "test-plugin", {});

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.errors).toContain("path is required");
    });

    it("should error when plugin not installed", async () => {
      vi.spyOn(pluginLoader, "loadPlugin").mockResolvedValue(null);

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginConfigure(ctx, "not-installed", {});

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not installed");
    });

    it("should apply --enable flag", async () => {
      mockPlugin.validateConfig.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginConfigure(ctx, "test-plugin", {
        set: ["path=.test"],
        enable: true,
      });

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.config.enabled).toBe(true);
    });

    it("should apply --disable flag", async () => {
      mockPlugin.validateConfig.mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.spyOn(config, "getConfig").mockReturnValue({
        version: "0.1.0",
        integrations: {
          "test-plugin": { enabled: true, options: { path: ".test" } },
        },
      });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginConfigure(ctx, "test-plugin", {
        disable: true,
      });

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.config.enabled).toBe(false);
    });

    it("should apply --delete-behavior flag", async () => {
      mockPlugin.validateConfig.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginConfigure(ctx, "test-plugin", {
        set: ["path=.test"],
        deleteBehavior: "delete",
      });

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.config.delete_behavior).toBe("delete");
    });
  });

  describe("handlePluginTest", () => {
    beforeEach(() => {
      vi.spyOn(config, "getConfig").mockReturnValue({
        version: "0.1.0",
        integrations: {
          beads: { enabled: true, options: { path: ".beads" } },
        },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should error when plugin not configured", async () => {
      vi.spyOn(config, "getConfig").mockReturnValue({ version: "0.1.0" });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginTest(ctx, "unconfigured");

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not configured");
    });

    it("should run test for configured plugin", async () => {
      vi.spyOn(pluginLoader, "testProviderConnection").mockResolvedValue({
        success: true,
        configured: true,
        enabled: true,
        details: { path: ".beads", issueCount: 5 },
      });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginTest(ctx, "beads");

      expect(pluginLoader.testProviderConnection).toHaveBeenCalledWith(
        "beads",
        { enabled: true, options: { path: ".beads" } },
        expect.any(String)
      );

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
    });
  });

  describe("handlePluginInfo", () => {
    const mockPlugin = {
      name: "beads",
      displayName: "Beads",
      version: "0.1.0",
      description: "Test description",
      validateConfig: vi.fn(),
      testConnection: vi.fn(),
      createProvider: vi.fn(),
      configSchema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string" as const,
            title: "Path",
            description: "Path to beads directory",
            required: true,
          },
        },
        required: ["path"],
      },
    };

    beforeEach(() => {
      vi.spyOn(pluginLoader, "loadPlugin").mockResolvedValue(mockPlugin);
      vi.spyOn(config, "getConfig").mockReturnValue({ version: "0.1.0" });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should show plugin info in JSON format", async () => {
      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginInfo(ctx, "beads");

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.plugin.name).toBe("beads");
      expect(parsed.plugin.displayName).toBe("Beads");
      expect(parsed.plugin.configSchema).toBeDefined();
    });

    it("should show configured status", async () => {
      vi.spyOn(config, "getConfig").mockReturnValue({
        version: "0.1.0",
        integrations: {
          beads: { enabled: true, options: { path: ".beads" } },
        },
      });

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginInfo(ctx, "beads");

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.configured).toBe(true);
      expect(parsed.currentConfig.enabled).toBe(true);
    });

    it("should error when plugin not installed", async () => {
      vi.spyOn(pluginLoader, "loadPlugin").mockResolvedValue(null);

      const ctx = {
        db: {},
        outputDir: ".sudocode",
        jsonOutput: true,
      };

      await handlePluginInfo(ctx, "not-installed");

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not installed");
    });
  });
});
