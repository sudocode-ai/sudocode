/**
 * Unit tests for Codex adapter
 */

import { describe, it, expect } from "vitest";
import { CodexAdapter } from "../../../../src/execution/adapters/codex-adapter.js";
import type { CodexConfig } from "@sudocode-ai/types/agents";

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(adapter.metadata.name).toBe("codex");
      expect(adapter.metadata.displayName).toBe("OpenAI Codex");
      expect(adapter.metadata.supportedModes).toEqual([
        "structured",
        "interactive",
      ]);
      expect(adapter.metadata.supportsStreaming).toBe(true);
      expect(adapter.metadata.supportsStructuredOutput).toBe(true);
    });
  });

  describe("buildProcessConfig", () => {
    it("should build basic config with defaults", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("codex");
      expect(processConfig.workDir).toBe("/test/dir");
      expect(processConfig.args).toContain("exec");
      expect(processConfig.args).toContain("-");
    });

    it("should include JSON flag when enabled", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        json: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--json");
    });

    it("should include model flag when specified", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        model: "gpt-5-codex",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("gpt-5-codex");
    });

    it("should include full-auto flag", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        fullAuto: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--full-auto");
    });

    it("should include sandbox flag", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        sandbox: "workspace-write",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--sandbox");
      expect(processConfig.args).toContain("workspace-write");
    });

    it("should include yolo flag (translated to --dangerously-bypass-approvals-and-sandbox)", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        yolo: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain(
        "--dangerously-bypass-approvals-and-sandbox"
      );
    });

    it("should include search flag", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        search: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--search");
    });

    it("should include image flags", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        image: ["/path/to/img1.png", "/path/to/img2.png"],
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--image");
      expect(processConfig.args).toContain(
        "/path/to/img1.png,/path/to/img2.png"
      );
    });

    it("should include add-dir flags", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        addDir: ["/extra/dir1", "/extra/dir2"],
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--add-dir");
      expect(processConfig.args).toContain("/extra/dir1");
      expect(processConfig.args).toContain("/extra/dir2");
    });

    it("should include prompt as last argument", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        prompt: "Write a hello world function",
      };

      const processConfig = adapter.buildProcessConfig(config);

      const lastArg = processConfig.args[processConfig.args.length - 1];
      expect(lastArg).toBe("Write a hello world function");
    });

    it("should use custom executable path", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        codexPath: "/custom/path/to/codex",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("/custom/path/to/codex");
    });
  });

  describe("validateConfig", () => {
    it("should pass validation for valid config", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        json: true,
        fullAuto: true,
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toEqual([]);
    });

    it("should fail if workDir is missing", () => {
      const config = {
        json: true,
      } as CodexConfig;

      const errors = adapter.validateConfig(config);

      expect(errors).toContain("workDir is required");
    });

    it("should fail if both json and experimentalJson are used", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        json: true,
        experimentalJson: true,
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "Cannot use both json and experimentalJson flags"
      );
    });

    it("should fail if fullAuto conflicts with sandbox", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        fullAuto: true,
        sandbox: "workspace-write",
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "fullAuto cannot be used with sandbox or askForApproval flags"
      );
    });

    it("should fail if fullAuto conflicts with askForApproval", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        fullAuto: true,
        askForApproval: "on-failure",
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "fullAuto cannot be used with sandbox or askForApproval flags"
      );
    });

    it("should fail if yolo conflicts with sandbox", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        yolo: true,
        sandbox: "workspace-write",
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "yolo flag cannot be used with sandbox, askForApproval, or fullAuto flags"
      );
    });

    it("should fail if yolo conflicts with fullAuto", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        yolo: true,
        fullAuto: true,
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "yolo flag cannot be used with sandbox, askForApproval, or fullAuto flags"
      );
    });

    it("should fail for invalid sandbox value", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        sandbox: "invalid" as any,
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "sandbox must be one of: read-only, workspace-write, danger-full-access"
      );
    });

    it("should fail for invalid askForApproval value", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        askForApproval: "invalid" as any,
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain(
        "askForApproval must be one of: untrusted, on-failure, on-request, never"
      );
    });

    it("should fail for invalid color value", () => {
      const config: CodexConfig = {
        workDir: "/test/dir",
        color: "invalid" as any,
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toContain("color must be one of: always, never, auto");
    });
  });

  describe("getDefaultConfig", () => {
    it("should return sensible defaults", () => {
      const defaults = adapter.getDefaultConfig();

      expect(defaults.codexPath).toBe("codex");
      expect(defaults.exec).toBe(true);
      expect(defaults.json).toBe(true);
      expect(defaults.experimentalJson).toBe(false);
      expect(defaults.fullAuto).toBe(true);
      expect(defaults.skipGitRepoCheck).toBe(false);
      expect(defaults.color).toBe("auto");
      expect(defaults.search).toBe(true);
      expect(defaults.yolo).toBe(false);
    });
  });
});
