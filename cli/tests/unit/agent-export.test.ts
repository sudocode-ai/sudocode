/**
 * Tests for agent preset export functionality
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  exportAgentPreset,
  exportAllPresets,
  getRecommendedExportPath,
  type ExportPlatform,
} from "../../src/operations/export.js";
import {
  initializeAgentsDirectory,
  createAgentPreset,
} from "../../src/operations/agents.js";

describe("Agent Export System", () => {
  let testDir: string;
  let sudocodeDir: string;

  beforeEach(() => {
    // Create temporary test directory
    const timestamp = Date.now();
    testDir = path.join("/tmp", `agent-export-test-${timestamp}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(testDir, { recursive: true });
    initializeAgentsDirectory(sudocodeDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("getRecommendedExportPath", () => {
    it("should return claude-code path", () => {
      const exportPath = getRecommendedExportPath("claude-code", "test-agent");
      expect(exportPath).toContain(".claude/agents");
      expect(exportPath).toContain("test-agent.md");
    });

    it("should return cursor path", () => {
      const exportPath = getRecommendedExportPath("cursor", "test-rule");
      expect(exportPath).toContain(".cursor/rules");
      expect(exportPath).toContain("test-rule.mdc");
    });

    it("should return gemini-cli path", () => {
      const exportPath = getRecommendedExportPath("gemini-cli", "test-agent");
      expect(exportPath).toContain(".gemini/agents");
      expect(exportPath).toContain("test-agent.agent.json");
    });

    it("should return mcp path", () => {
      const exportPath = getRecommendedExportPath("mcp", "test-server");
      expect(exportPath).toContain(".config/mcp");
      expect(exportPath).toContain("test-server.json");
    });
  });

  describe("exportAgentPreset - Claude Code", () => {
    beforeEach(() => {
      // Create test preset
      createAgentPreset(sudocodeDir, {
        id: "test-reviewer",
        name: "Test Reviewer",
        description: "A test code reviewer",
        agent_type: "claude-code",
        model: "claude-sonnet-4-5",
        system_prompt: "You are a code reviewer.",
        tools: ["Read", "Grep", "Glob"],
        max_context_tokens: 200000,
        isolation_mode: "subagent",
        capabilities: ["code-review"],
        tags: ["reviewer", "quality"],
      });
    });

    it("should export to claude-code format", () => {
      const outputPath = path.join(testDir, "test-reviewer.md");
      const result = exportAgentPreset(sudocodeDir, "test-reviewer", {
        platform: "claude-code",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("id: test-reviewer");
      expect(content).toContain("name: Test Reviewer");
      expect(content).toContain("tools: Read, Grep, Glob");
      expect(content).toContain("You are a code reviewer.");
    });

    it("should not overwrite existing file without flag", () => {
      const outputPath = path.join(testDir, "test-reviewer.md");

      // First export
      exportAgentPreset(sudocodeDir, "test-reviewer", {
        platform: "claude-code",
        outputPath,
      });

      // Second export without overwrite flag
      const result = exportAgentPreset(sudocodeDir, "test-reviewer", {
        platform: "claude-code",
        outputPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should overwrite existing file with flag", () => {
      const outputPath = path.join(testDir, "test-reviewer.md");

      // First export
      exportAgentPreset(sudocodeDir, "test-reviewer", {
        platform: "claude-code",
        outputPath,
      });

      // Second export with overwrite flag
      const result = exportAgentPreset(sudocodeDir, "test-reviewer", {
        platform: "claude-code",
        outputPath,
        overwrite: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("exportAgentPreset - Cursor", () => {
    beforeEach(() => {
      createAgentPreset(sudocodeDir, {
        id: "test-cursor",
        name: "Test Cursor Rule",
        description: "A test cursor rule",
        agent_type: "cursor",
        system_prompt: "Follow TypeScript best practices.",
        capabilities: ["linting"],
        tags: ["typescript"],
      });
    });

    it("should export to cursor .mdc format", () => {
      const outputPath = path.join(testDir, "test-cursor.mdc");
      const result = exportAgentPreset(sudocodeDir, "test-cursor", {
        platform: "cursor",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain('name: "test-cursor"');
      expect(content).toContain('description: "A test cursor rule"');
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain("Follow TypeScript best practices.");
    });

    it("should include globs if specified in platform_configs", () => {
      // Create preset with cursor-specific config
      createAgentPreset(sudocodeDir, {
        id: "cursor-with-globs",
        name: "TypeScript Files",
        description: "Rules for TS files",
        agent_type: "cursor",
        system_prompt: "Use TypeScript.",
        platform_configs: {
          cursor: {
            globs: ["**/*.ts", "**/*.tsx"],
            alwaysApply: false,
          },
        },
      });

      const outputPath = path.join(testDir, "cursor-with-globs.mdc");
      const result = exportAgentPreset(sudocodeDir, "cursor-with-globs", {
        platform: "cursor",
        outputPath,
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("**/*.ts");
      expect(content).toContain("**/*.tsx");
      expect(content).toContain("alwaysApply: false");
    });
  });

  describe("exportAgentPreset - Gemini CLI", () => {
    beforeEach(() => {
      createAgentPreset(sudocodeDir, {
        id: "test-gemini",
        name: "Test Gemini Agent",
        description: "A test gemini agent",
        agent_type: "gemini-cli",
        model: "gemini-pro",
        system_prompt: "You are a helpful agent.",
        tools: ["Read", "Write"],
        capabilities: ["file-ops"],
      });
    });

    it("should export to gemini JSON format", () => {
      const outputPath = path.join(testDir, "test-gemini.json");
      const result = exportAgentPreset(sudocodeDir, "test-gemini", {
        platform: "gemini-cli",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.id).toBe("test-gemini");
      expect(config.name).toBe("Test Gemini Agent");
      expect(config.model).toBe("gemini-pro");
      expect(config.systemPrompt).toBe("You are a helpful agent.");
      expect(config.tools).toEqual(["read", "write"]);
    });

    it("should convert tools to lowercase", () => {
      const outputPath = path.join(testDir, "test-gemini.json");
      exportAgentPreset(sudocodeDir, "test-gemini", {
        platform: "gemini-cli",
        outputPath,
      });

      const content = fs.readFileSync(outputPath, "utf-8");
      const config = JSON.parse(content);

      // Verify tools are lowercase
      config.tools.forEach((tool: string) => {
        expect(tool).toBe(tool.toLowerCase());
      });
    });
  });

  describe("exportAgentPreset - MCP", () => {
    beforeEach(() => {
      createAgentPreset(sudocodeDir, {
        id: "test-mcp",
        name: "Test MCP Server",
        description: "A test MCP server",
        agent_type: "claude-code",
        system_prompt: "You provide code assistance.",
        mcp_servers: ["filesystem", "git"],
        capabilities: ["mcp"],
      });
    });

    it("should export to MCP server config format", () => {
      const outputPath = path.join(testDir, "test-mcp.json");
      const result = exportAgentPreset(sudocodeDir, "test-mcp", {
        platform: "mcp",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers["test-mcp"]).toBeDefined();
      expect(config.mcpServers["test-mcp"].command).toBe("npx");
      expect(config.mcpServers["test-mcp"].args).toContain("-y");
      expect(config.mcpServers["test-mcp"].args).toContain(
        "@sudocode-ai/mcp-server"
      );
    });
  });

  describe("exportAllPresets", () => {
    beforeEach(() => {
      // Create multiple presets
      createAgentPreset(sudocodeDir, {
        id: "reviewer",
        name: "Code Reviewer",
        description: "Reviews code",
        agent_type: "claude-code",
        system_prompt: "Review code.",
      });

      createAgentPreset(sudocodeDir, {
        id: "tester",
        name: "Test Writer",
        description: "Writes tests",
        agent_type: "claude-code",
        system_prompt: "Write tests.",
      });
    });

    it("should export all presets to claude-code format", () => {
      const outputDir = path.join(testDir, "exports");
      const results = exportAllPresets(sudocodeDir, "claude-code", {
        outputDir,
      });

      expect(results.length).toBe(2);
      expect(results.every((r) => r.success)).toBe(true);

      // Check files exist
      expect(fs.existsSync(path.join(outputDir, "reviewer.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "tester.md"))).toBe(true);
    });

    it("should handle partial failures gracefully", () => {
      const outputDir = path.join(testDir, "exports");

      // Create first export to cause conflict
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, "reviewer.md"), "existing");

      const results = exportAllPresets(sudocodeDir, "claude-code", {
        outputDir,
      });

      expect(results.length).toBe(2);

      // One should fail (reviewer), one should succeed (tester)
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].error).toContain("already exists");
    });

    it("should overwrite with overwrite flag", () => {
      const outputDir = path.join(testDir, "exports");

      // First export
      exportAllPresets(sudocodeDir, "claude-code", { outputDir });

      // Second export with overwrite
      const results = exportAllPresets(sudocodeDir, "claude-code", {
        outputDir,
        overwrite: true,
      });

      expect(results.length).toBe(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should fail when preset does not exist", () => {
      const result = exportAgentPreset(sudocodeDir, "nonexistent", {
        platform: "claude-code",
        outputPath: path.join(testDir, "test.md"),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail with invalid platform", () => {
      createAgentPreset(sudocodeDir, {
        id: "test",
        name: "Test",
        description: "Test",
        agent_type: "claude-code",
        system_prompt: "Test",
      });

      const result = exportAgentPreset(sudocodeDir, "test", {
        platform: "invalid-platform" as ExportPlatform,
        outputPath: path.join(testDir, "test.md"),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported platform");
    });

    it("should handle file system errors gracefully", () => {
      createAgentPreset(sudocodeDir, {
        id: "test",
        name: "Test",
        description: "Test",
        agent_type: "claude-code",
        system_prompt: "Test",
      });

      // Try to write to a directory that doesn't exist and can't be created
      const invalidPath = path.join("/nonexistent-root-path-12345", "test.md");
      const result = exportAgentPreset(sudocodeDir, "test", {
        platform: "claude-code",
        outputPath: invalidPath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
