/**
 * Integration Tests for GitHub Copilot Agent
 *
 * Tests the complete Copilot execution stack:
 * - Copilot adapter configuration and validation
 * - Process config building
 * - Integration with agent registry
 * - Tool permission handling
 * - Error handling scenarios
 *
 * Note: This test suite mocks actual Copilot CLI execution to prevent
 * external API calls. Real E2E tests with actual Copilot should be
 * run separately with proper API credentials.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  PROMPT_TEMPLATES_TABLE,
  PROMPT_TEMPLATES_INDEXES,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";
import { initializeDefaultTemplates } from "../../src/services/prompt-templates.js";
import {
  generateIssueId,
  generateSpecId,
} from "@sudocode-ai/cli/dist/id-generator.js";
import {
  createIssue,
  createSpec,
  addRelationship,
} from "@sudocode-ai/cli/dist/operations/index.js";
import { agentRegistryService } from "../../src/services/agent-registry.js";
import { CopilotAdapter } from "../../src/execution/adapters/copilot-adapter.js";
import type { CopilotConfig } from "@sudocode-ai/types/agents";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock WebSocket module
vi.mock("../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
}));

describe("Copilot Agent Integration", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;
  let copilotAdapter: CopilotAdapter;

  beforeAll(() => {
    // Create temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-copilot-test-"));
    testDbPath = path.join(testDir, "cache.db");
    process.env.SUDOCODE_DIR = testDir;

    // Create config for ID generation
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: "1.0.0",
        id_prefix: { spec: "SPEC", issue: "ISSUE" },
      })
    );

    // Initialize database with schema and migrations
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);
    db.exec(PROMPT_TEMPLATES_TABLE);
    db.exec(PROMPT_TEMPLATES_INDEXES);
    runMigrations(db);
    initializeDefaultTemplates(db);

    // Create test issue and spec
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, testDir);
    testIssueId = issueId;
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test Copilot execution",
      content: "Integration test for GitHub Copilot agent",
    });

    const { id: specId, uuid: specUuid } = generateSpecId(db, testDir);
    testSpecId = specId;
    createSpec(db, {
      id: specId,
      uuid: specUuid,
      title: "Copilot integration spec",
      content: "Test specification for GitHub Copilot",
      file_path: path.join(testDir, "specs", "copilot-test.md"),
    });

    addRelationship(db, {
      from_id: testIssueId,
      from_type: "issue",
      to_id: testSpecId,
      to_type: "spec",
      relationship_type: "implements",
    });

    // Initialize Copilot adapter
    copilotAdapter = new CopilotAdapter();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.SUDOCODE_DIR;
  });

  describe("Copilot Adapter", () => {
    // Note: Copilot now uses ACP via copilot-cli, so it's no longer registered
    // in the agent registry. The adapter file exists for the CopilotAdapter class
    // but is not registered.
    it("should NOT be registered in agent registry (uses ACP now)", () => {
      // copilot uses ACP via copilot-cli and doesn't have an adapter
      expect(() => agentRegistryService.getAdapter("copilot")).toThrow();
    });

    it("should provide correct metadata", () => {
      const metadata = copilotAdapter.metadata;
      expect(metadata.name).toBe("copilot");
      expect(metadata.displayName).toBe("GitHub Copilot");
      expect(metadata.supportedModes).toContain("structured");
      expect(metadata.supportedModes).toContain("interactive");
      expect(metadata.supportsStreaming).toBe(true);
      expect(metadata.supportsStructuredOutput).toBe(true);
    });

    it("should provide default configuration", () => {
      const defaultConfig = copilotAdapter.getDefaultConfig();
      expect(defaultConfig.copilotPath).toBe("copilot");
      expect(defaultConfig.allowAllTools).toBe(true);
      expect(defaultConfig.model).toBeUndefined(); // Use account default
    });
  });

  describe("Configuration Building", () => {
    it("should build process config from Copilot config", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        copilotPath: "copilot",
        allowAllTools: true,
        model: "claude-sonnet-4.5",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("copilot");
      expect(processConfig.workDir).toBe(testDir);
      expect(processConfig.args).toContain("--no-color");
      expect(processConfig.args).toContain("--log-level");
      expect(processConfig.args).toContain("debug");
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("claude-sonnet-4.5");
      expect(processConfig.args).toContain("--allow-all-tools");
    });

    it("should handle tool permissions correctly", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        allowTool: "bash,read_file",
        denyTool: "web_search",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--allow-tool");
      expect(processConfig.args).toContain("bash,read_file");
      expect(processConfig.args).toContain("--deny-tool");
      expect(processConfig.args).toContain("web_search");
      expect(processConfig.args).not.toContain("--allow-all-tools");
    });

    it("should handle additional directories", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        addDir: ["/path/to/lib1", "/path/to/lib2"],
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--add-dir");
      expect(processConfig.args).toContain("/path/to/lib1");
      expect(processConfig.args).toContain("/path/to/lib2");
    });

    it("should handle disabled MCP servers", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        disableMcpServer: ["server1", "server2"],
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--disable-mcp-server");
      expect(processConfig.args).toContain("server1");
      expect(processConfig.args).toContain("server2");
    });

    it("should handle custom copilot path", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        copilotPath: "/custom/path/to/copilot",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("/custom/path/to/copilot");
    });

    it("should use executablePath fallback", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        executablePath: "/fallback/copilot",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe("/fallback/copilot");
    });
  });

  describe("Configuration Validation", () => {
    it("should validate valid configuration", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        copilotPath: "copilot",
        allowAllTools: true,
        model: "claude-sonnet-4.5",
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(errors).toEqual([]);
    });

    it("should require workDir", () => {
      const config: CopilotConfig = {
        workDir: "",
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(errors).toContain("workDir is required");
    });

    it("should detect allowTool conflict with allowAllTools", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        allowAllTools: true,
        allowTool: "bash",
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        errors.some((e) => e.includes("allowTool is ignored"))
      ).toBe(true);
    });

    it("should detect denyTool with allowAllTools", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        allowAllTools: true,
        denyTool: "bash",
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        errors.some((e) => e.includes("denyTool takes precedence over allowAllTools"))
      ).toBe(true);
    });

    it("should detect empty paths in addDir", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        addDir: ["", "/valid/path"],
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(errors.some((e) => e.includes("addDir contains empty path"))).toBe(
        true
      );
    });

    it("should detect empty server names in disableMcpServer", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        disableMcpServer: ["", "valid-server"],
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(
        errors.some((e) => e.includes("disableMcpServer contains empty server name"))
      ).toBe(true);
    });

    it("should accept multiple validation errors", () => {
      const config: CopilotConfig = {
        workDir: "",
        allowAllTools: true,
        allowTool: "bash",
        addDir: [""],
      };

      const errors = copilotAdapter.validateConfig(config);
      expect(errors.length).toBeGreaterThan(1);
    });
  });

  describe("Agent Registry Integration", () => {
    it("should be marked as implemented", () => {
      const isImplemented = agentRegistryService.isAgentImplemented("copilot");
      expect(isImplemented).toBe(true);
    });

    it("should be available in agent list", () => {
      const agents = agentRegistryService.getAvailableAgents();
      const copilot = agents.find((a) => a.name === "copilot");

      expect(copilot).toBeDefined();
      expect(copilot?.displayName).toBe("Copilot"); // Updated from "GitHub Copilot" since using ACP now
      expect(copilot?.implemented).toBe(true);
      expect(copilot?.supportsStreaming).toBe(true);
      expect(copilot?.supportsStructuredOutput).toBe(true);
    });

    it("should NOT have an adapter in registry (uses ACP now)", () => {
      // copilot uses ACP via copilot-cli and doesn't have an adapter
      expect(() => agentRegistryService.getAdapter("copilot")).toThrow();
    });
  });

  describe("Tool Permission Scenarios", () => {
    it("should allow all tools by default", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        allowAllTools: true,
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--allow-all-tools");
    });

    it("should allow specific tools only", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        allowAllTools: false,
        allowTool: "bash,read_file,write_file",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).not.toContain("--allow-all-tools");
      expect(processConfig.args).toContain("--allow-tool");
      expect(processConfig.args).toContain("bash,read_file,write_file");
    });

    it("should deny specific tools", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        denyTool: "web_search,shell",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--deny-tool");
      expect(processConfig.args).toContain("web_search,shell");
    });

    it("should combine allow and deny (deny takes precedence)", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        allowAllTools: true,
        denyTool: "bash",
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--allow-all-tools");
      expect(processConfig.args).toContain("--deny-tool");
      expect(processConfig.args).toContain("bash");

      // Validation should warn
      const errors = copilotAdapter.validateConfig(config);
      expect(
        errors.some((e) => e.includes("denyTool takes precedence"))
      ).toBe(true);
    });
  });

  describe("Model Selection", () => {
    it("should support GPT models", () => {
      const models = ["gpt-5", "gpt-5.1", "gpt-5.1-codex"];
      models.forEach((model) => {
        const config: CopilotConfig = {
          workDir: testDir,
          model,
        };

        const processConfig = copilotAdapter.buildProcessConfig(config);
        expect(processConfig.args).toContain("--model");
        expect(processConfig.args).toContain(model);
      });
    });

    it("should support Claude models", () => {
      const models = ["claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5"];
      models.forEach((model) => {
        const config: CopilotConfig = {
          workDir: testDir,
          model,
        };

        const processConfig = copilotAdapter.buildProcessConfig(config);
        expect(processConfig.args).toContain("--model");
        expect(processConfig.args).toContain(model);
      });
    });

    it("should not include model flag when not specified", () => {
      const config: CopilotConfig = {
        workDir: testDir,
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).not.toContain("--model");
    });
  });

  describe("MCP Server Configuration", () => {
    it("should disable specific MCP servers", () => {
      const config: CopilotConfig = {
        workDir: testDir,
        disableMcpServer: ["filesystem", "database"],
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--disable-mcp-server");
      expect(processConfig.args).toContain("filesystem");
      expect(processConfig.args).toContain("database");
    });

    it("should not include disable-mcp-server when not specified", () => {
      const config: CopilotConfig = {
        workDir: testDir,
      };

      const processConfig = copilotAdapter.buildProcessConfig(config);
      expect(processConfig.args).not.toContain("--disable-mcp-server");
    });
  });
});
