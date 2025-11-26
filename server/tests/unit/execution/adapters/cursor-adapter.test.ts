/**
 * Unit tests for Cursor adapter
 */

import { describe, it, expect } from "vitest";
import { CursorAdapter } from "../../../../src/execution/adapters/cursor-adapter.js";
import type { CursorConfig } from "@sudocode-ai/types/agents";

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(adapter.metadata.name).toBe("cursor");
      expect(adapter.metadata.displayName).toBe("Cursor");
      expect(adapter.metadata.supportedModes).toEqual(["structured"]);
      expect(adapter.metadata.supportsStreaming).toBe(true);
      expect(adapter.metadata.supportsStructuredOutput).toBe(true);
    });
  });

  describe("buildProcessConfig", () => {
    it("should build basic config with defaults", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("cursor-agent");
      expect(processConfig.workDir).toBe("/test/dir");
      expect(processConfig.args).toContain("-p");
      expect(processConfig.args).toContain("--output-format=stream-json");
    });

    it("should include force flag when enabled", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        force: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--force");
    });

    it("should not include force flag when disabled", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        force: false,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).not.toContain("--force");
    });

    it("should include model flag when specified", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        model: "sonnet-4.5",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("sonnet-4.5");
    });

    it("should support auto model", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        model: "auto",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("auto");
    });

    it("should support sonnet-4.5-thinking model", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        model: "sonnet-4.5-thinking",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("sonnet-4.5-thinking");
    });

    it("should support gpt-5 model", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        model: "gpt-5",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("gpt-5");
    });

    it("should use custom executable path", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        cursorPath: "/custom/path/to/cursor-agent",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("/custom/path/to/cursor-agent");
    });

    it("should pass through timeout", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        timeout: 60000,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.timeout).toBe(60000);
    });

    it("should pass through idleTimeout", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        idleTimeout: 30000,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.idleTimeout).toBe(30000);
    });

    it("should pass through retry config", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        retry: {
          maxAttempts: 3,
          backoffMs: 1000,
        },
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.retry).toEqual({
        maxAttempts: 3,
        backoffMs: 1000,
      });
    });

    it("should pass through environment variables", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        env: {
          CURSOR_API_KEY: "test-key",
          DEBUG: "true",
        },
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.env).toEqual({
        CURSOR_API_KEY: "test-key",
        DEBUG: "true",
      });
    });

    it("should build config with all options", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        cursorPath: "/usr/local/bin/cursor-agent",
        force: true,
        model: "sonnet-4.5",
        timeout: 120000,
        idleTimeout: 60000,
        env: { CURSOR_API_KEY: "test" },
        retry: { maxAttempts: 3, backoffMs: 1000 },
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("/usr/local/bin/cursor-agent");
      expect(processConfig.workDir).toBe("/test/dir");
      expect(processConfig.args).toContain("-p");
      expect(processConfig.args).toContain("--output-format=stream-json");
      expect(processConfig.args).toContain("--force");
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("sonnet-4.5");
      expect(processConfig.timeout).toBe(120000);
      expect(processConfig.idleTimeout).toBe(60000);
      expect(processConfig.env).toEqual({ CURSOR_API_KEY: "test" });
      expect(processConfig.retry).toEqual({ maxAttempts: 3, backoffMs: 1000 });
    });
  });

  describe("validateConfig", () => {
    it("should pass validation for valid config", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        force: true,
        model: "auto",
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toEqual([]);
    });

    it("should fail if workDir is missing", () => {
      const config = {
        force: true,
      } as CursorConfig;

      const errors = adapter.validateConfig(config);

      expect(errors).toContain("workDir is required");
    });

    it("should pass validation with known models", () => {
      const models = [
        "auto",
        "sonnet-4.5",
        "sonnet-4.5-thinking",
        "gpt-5",
        "opus-4.1",
        "grok",
      ];

      for (const model of models) {
        const config: CursorConfig = {
          workDir: "/test/dir",
          model,
        };

        const errors = adapter.validateConfig(config);
        expect(errors).toEqual([]);
      }
    });

    it("should allow custom model strings", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
        model: "custom-model-name",
      };

      const errors = adapter.validateConfig(config);

      // Should not error, just warn (but we can't test console.warn easily)
      expect(errors).toEqual([]);
    });

    it("should pass validation with minimal config", () => {
      const config: CursorConfig = {
        workDir: "/test/dir",
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toEqual([]);
    });
  });

  describe("getDefaultConfig", () => {
    it("should return sensible defaults", () => {
      const defaults = adapter.getDefaultConfig();

      expect(defaults.cursorPath).toBe("cursor-agent");
      expect(defaults.force).toBe(true);
      expect(defaults.model).toBe("auto");
    });

    it("should have minimal defaults (no unnecessary options)", () => {
      const defaults = adapter.getDefaultConfig();

      // Should only have cursorPath, force, and model
      expect(Object.keys(defaults).sort()).toEqual(
        ["cursorPath", "force", "model"].sort()
      );
    });
  });
});
