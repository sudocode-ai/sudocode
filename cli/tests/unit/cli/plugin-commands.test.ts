/**
 * Tests for plugin CLI commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handlePluginList,
  handlePluginStatus,
} from "../../../src/cli/plugin-commands.js";
import * as pluginLoader from "../../../src/integrations/plugin-loader.js";

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
});
