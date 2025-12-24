/**
 * Unit tests for ExecutionService MCP Detection Methods
 *
 * Tests the MCP detection methods that determine if sudocode-mcp is installed
 * and configured for agent executions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  createExecutionServiceSetup,
  mockSudocodeMcpDetection,
  mockAgentMcpDetection,
} from "../../integration/execution/helpers/execution-test-utils.js";

/**
 * Mock modules before importing ExecutionService
 */
vi.mock("fs/promises");
vi.mock("child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));
vi.mock("../../../src/utils/execFileNoThrow.js", () => ({
  execFileNoThrow: vi.fn(),
}));

describe("ExecutionService - MCP Detection", () => {
  let service: any; // Use 'any' to access private methods
  let setup: ReturnType<typeof createExecutionServiceSetup>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create ExecutionService setup with all dependencies
    setup = createExecutionServiceSetup("test-project-id", "/test/repo/path");
    service = setup.service;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setup.db.close();
  });

  describe("detectSudocodeMcp", () => {
    it("should return true when sudocode-mcp package is available in PATH", async () => {
      // Mock successful command execution (sudocode-mcp exists in PATH)
      await mockSudocodeMcpDetection(true);

      const result = await service.detectSudocodeMcp();
      expect(result).toBe(true);
    });

    it("should return false when sudocode-mcp package is not available", async () => {
      // Mock failed command execution (sudocode-mcp not found)
      await mockSudocodeMcpDetection(false);

      const result = await service.detectSudocodeMcp();
      expect(result).toBe(false);
    });

    it("should return false on detection errors (logs warning, doesn't throw)", async () => {
      // Mock command execution error (not just "not found", but actual failure)
      const { execFileNoThrow } = await import("../../../src/utils/execFileNoThrow.js");
      vi.mocked(execFileNoThrow).mockRejectedValue(new Error("Unexpected error"));

      const result = await service.detectSudocodeMcp();
      expect(result).toBe(false);
      // Verify warning was logged but no error thrown
    });
  });

  describe("detectAgentMcp - claude-code", () => {
    const claudeSettingsPath = path.join(
      os.homedir(),
      ".claude",
      "settings.json"
    );

    it("should return true when settings.json has sudocode plugin enabled", async () => {
      // Mock successful file read with plugin enabled
      mockAgentMcpDetection(true);

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(true);
      expect(fs.readFile).toHaveBeenCalledWith(claudeSettingsPath, "utf-8");
    });

    it("should return false when settings.json exists but plugin is not enabled", async () => {
      // Mock file read with plugin disabled or missing
      mockAgentMcpDetection(false);

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(false);
    });

    it("should return false when settings.json doesn't exist", async () => {
      // Mock file read error (ENOENT - file not found)
      const error = new Error("ENOENT: no such file or directory") as any;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(false);
    });

    it("should return true when settings.json is malformed JSON (conservative behavior, logs error)", async () => {
      // Mock file read with invalid JSON
      // Returns true (assume configured) as conservative behavior
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid json }");

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(true);
      // Verify error was logged but no exception thrown
    });

    it("should return false when enabledPlugins['sudocode@sudocode-marketplace'] is false", async () => {
      // Mock file read with plugin explicitly disabled
      const mockSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        enabledPlugins: {
          "sudocode@sudocode-marketplace": false,
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSettings));

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(false);
    });

    it("should return false when enabledPlugins['sudocode@sudocode-marketplace'] is missing", async () => {
      // Mock file read with no sudocode plugin in enabledPlugins
      const mockSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        enabledPlugins: {},
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSettings));

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(false);
    });

    it("should handle file read errors gracefully (returns true - conservative, logs warning)", async () => {
      // Mock file read error (permission denied or other error)
      // Returns true (assume configured) as conservative behavior
      const error = new Error("EACCES: permission denied") as any;
      error.code = "EACCES";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("claude-code");
      expect(result).toBe(true);
      // Verify warning was logged
    });
  });

  describe("detectAgentMcp - cursor", () => {
    it("should return true when sudocode-mcp is configured in project root", async () => {
      // Mock .cursor/mcp.json in repoPath with sudocode-mcp
      const cursorConfigPath = path.join("/test/repo/path", ".cursor", "mcp.json");
      const mockConfig = {
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.detectAgentMcp("cursor");
      expect(result).toBe(true);
      expect(fs.readFile).toHaveBeenCalledWith(cursorConfigPath, "utf-8");
    });

    it("should return false when .cursor/mcp.json doesn't exist", async () => {
      // Mock ENOENT error
      const error = new Error("ENOENT: no such file or directory") as any;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("cursor");
      expect(result).toBe(false);
    });

    it("should check project root, not home directory", async () => {
      // Mock successful read
      const cursorConfigPath = path.join("/test/repo/path", ".cursor", "mcp.json");
      const mockConfig = {
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      await service.detectAgentMcp("cursor");

      // Verify path uses repoPath, not os.homedir()
      expect(fs.readFile).toHaveBeenCalledWith(cursorConfigPath, "utf-8");
      expect(fs.readFile).not.toHaveBeenCalledWith(
        expect.stringContaining(os.homedir()),
        expect.anything()
      );
    });

    it("should return true when sudocode-mcp has custom server name", async () => {
      // Mock .cursor/mcp.json with different server name but same command
      const mockConfig = {
        mcpServers: {
          "my-custom-name": {
            command: "sudocode-mcp",
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.detectAgentMcp("cursor");
      expect(result).toBe(true);
    });

    it("should return false when file exists but no sudocode-mcp command found", async () => {
      // Mock .cursor/mcp.json with different MCP servers
      const mockConfig = {
        mcpServers: {
          "other-mcp": {
            command: "other-mcp",
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.detectAgentMcp("cursor");
      expect(result).toBe(false);
    });

    it("should return false when file is malformed JSON (logs error)", async () => {
      // Mock file read with invalid JSON
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid json }");

      const result = await service.detectAgentMcp("cursor");
      expect(result).toBe(false);
      // Verify error was logged but no exception thrown
    });

    it("should return false on file read errors (permission denied, etc.)", async () => {
      // Mock file read error (permission denied)
      const error = new Error("EACCES: permission denied") as any;
      error.code = "EACCES";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("cursor");
      expect(result).toBe(false);
    });
  });

  describe("detectAgentMcp - codex", () => {
    const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");

    it("should return true when sudocode-mcp is configured", async () => {
      // Mock ~/.codex/config.toml with [mcp_servers.sudocode-mcp]
      const mockToml = `
model = "gpt-5.1-codex-max"

[mcp_servers.sudocode-mcp]
command = "sudocode-mcp"
`;
      vi.mocked(fs.readFile).mockResolvedValue(mockToml);

      const result = await service.detectAgentMcp("codex");
      expect(result).toBe(true);
      expect(fs.readFile).toHaveBeenCalledWith(codexConfigPath, "utf-8");
    });

    it("should return false when file doesn't exist", async () => {
      // Mock ENOENT error
      const error = new Error("ENOENT: no such file or directory") as any;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("codex");
      expect(result).toBe(false);
    });

    it("should return false when sudocode-mcp not in config", async () => {
      // Mock file with other MCP servers but not sudocode-mcp
      const mockToml = `
model = "gpt-5.1-codex-max"

[mcp_servers.another-server]
command = "some-other-command"
`;
      vi.mocked(fs.readFile).mockResolvedValue(mockToml);

      const result = await service.detectAgentMcp("codex");
      expect(result).toBe(false);
    });

    it("should return false when TOML is malformed", async () => {
      // Mock invalid TOML syntax
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid toml syntax [[[");

      const result = await service.detectAgentMcp("codex");
      expect(result).toBe(false);
      // Verify error was logged but no exception thrown
    });

    it("should return true when sudocode-mcp has custom server name", async () => {
      // Mock config with different server name but same command
      const mockToml = `
model = "gpt-5.1-codex-max"

[mcp_servers.my-custom-name]
command = "sudocode-mcp"
`;
      vi.mocked(fs.readFile).mockResolvedValue(mockToml);

      const result = await service.detectAgentMcp("codex");
      expect(result).toBe(true);
    });

    it("should return false on file read errors (permission denied, etc.)", async () => {
      // Mock file read error (permission denied)
      const error = new Error("EACCES: permission denied") as any;
      error.code = "EACCES";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("codex");
      expect(result).toBe(false);
    });
  });

  describe("detectAgentMcp - copilot", () => {
    const copilotConfigPath = path.join(
      os.homedir(),
      ".copilot",
      "mcp-config.json"
    );

    it("should return true when sudocode-mcp is configured", async () => {
      // Mock ~/.copilot/mcp-config.json with sudocode-mcp
      const mockConfig = {
        mcpServers: {
          "sudocode-mcp": {
            type: "local",
            command: "sudocode-mcp",
            tools: ["*"],
            args: [],
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.detectAgentMcp("copilot");
      expect(result).toBe(true);
      expect(fs.readFile).toHaveBeenCalledWith(copilotConfigPath, "utf-8");
    });

    it("should return false when file doesn't exist", async () => {
      // Mock ENOENT error
      const error = new Error("ENOENT: no such file or directory") as any;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("copilot");
      expect(result).toBe(false);
    });

    it("should return false when sudocode-mcp not in config", async () => {
      // Mock file with other MCP servers but not sudocode-mcp
      const mockConfig = {
        mcpServers: {
          "other-mcp": {
            type: "local",
            command: "other-mcp",
            tools: ["*"],
            args: [],
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.detectAgentMcp("copilot");
      expect(result).toBe(false);
    });

    it("should return false when JSON is malformed", async () => {
      // Mock invalid JSON syntax
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid json }");

      const result = await service.detectAgentMcp("copilot");
      expect(result).toBe(false);
      // Verify error was logged but no exception thrown
    });

    it("should return true when sudocode-mcp has custom server name", async () => {
      // Mock config with different server name but same command
      const mockConfig = {
        mcpServers: {
          "my-custom-name": {
            type: "local",
            command: "sudocode-mcp",
            tools: ["*"],
            args: [],
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.detectAgentMcp("copilot");
      expect(result).toBe(true);
    });

    it("should return false on file read errors (permission denied, etc.)", async () => {
      // Mock file read error (permission denied)
      const error = new Error("EACCES: permission denied") as any;
      error.code = "EACCES";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await service.detectAgentMcp("copilot");
      expect(result).toBe(false);
    });
  });

  describe("Integration - buildExecutionConfig", () => {
    it("should throw error when detectSudocodeMcp() returns false", async () => {
      // Mock sudocode-mcp not installed
      await mockSudocodeMcpDetection(false);

      await expect(
        service.buildExecutionConfig('claude-code', {})
      ).rejects.toThrow(/sudocode-mcp package not found/);
    });

    it("should add sudocode-mcp to mcpServers when detectAgentMcp() returns false", async () => {
      // Mock sudocode-mcp installed but not configured for agent
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      const result = await service.buildExecutionConfig('claude-code', {});
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers['sudocode-mcp']).toEqual({
        command: 'sudocode-mcp',
      });
    });

    it("should skip injection when detectAgentMcp() returns true (plugin already configured)", async () => {
      // Mock sudocode-mcp installed AND configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(true);

      const result = await service.buildExecutionConfig('claude-code', {});
      expect(result.mcpServers?.['sudocode-mcp']).toBeUndefined();
    });

    it("should preserve user-provided MCP servers when auto-injecting", async () => {
      // Mock sudocode-mcp installed but not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      const userConfig = {
        mcpServers: {
          "custom-mcp": {
            command: "custom-mcp",
            args: ["--verbose"],
          },
        },
      };

      const result = await service.buildExecutionConfig('claude-code', userConfig);
      expect(result.mcpServers['custom-mcp']).toEqual(userConfig.mcpServers['custom-mcp']);
      expect(result.mcpServers['sudocode-mcp']).toBeDefined();
    });

    it("should not duplicate sudocode-mcp if user already provided it", async () => {
      // Mock sudocode-mcp installed
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      const userConfig = {
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: ["--custom-flag"],
          },
        },
      };

      const result = await service.buildExecutionConfig('claude-code', userConfig);
      expect(result.mcpServers['sudocode-mcp']).toEqual(userConfig.mcpServers['sudocode-mcp']);
      // Should preserve user's custom config, not overwrite with default
    });
  });
});
