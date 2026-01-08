/**
 * Unit tests for Executor Factory
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import {
  createExecutorForAgent,
  validateAgentConfig,
  AgentConfigValidationError,
  isAcpAgent,
  listAcpAgents,
  isLegacyAgent,
  listLegacyAgents,
  listAllAgents,
} from "../../../../src/execution/executors/executor-factory.js";
import { AcpExecutorWrapper } from "../../../../src/execution/executors/acp-executor-wrapper.js";
import { LegacyShimExecutorWrapper } from "../../../../src/execution/executors/legacy-shim-executor-wrapper.js";
import type { AgentType, ClaudeCodeConfig } from "@sudocode-ai/types/agents";
import type { ExecutorFactoryConfig } from "../../../../src/execution/executors/executor-factory.js";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ExecutionLifecycleService } from "../../../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../../../src/services/execution-logs-store.js";

// Mock dependencies
const mockDb = {} as any;
const mockLifecycleService = {} as any;
const mockLogsStore = {} as any;

const factoryConfig: ExecutorFactoryConfig = {
  workDir: "/tmp/test",
  lifecycleService: mockLifecycleService,
  logsStore: mockLogsStore,
  projectId: "test-project",
  db: mockDb,
};

describe("ExecutorFactory", () => {
  describe("createExecutorForAgent", () => {
    it("should create AcpExecutorWrapper for claude-code agent (ACP-native)", () => {
      const executor = createExecutorForAgent(
        "claude-code",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      // ACP-native agents use AcpExecutorWrapper
      expect(executor).toBeInstanceOf(AcpExecutorWrapper);
    });

    it("should throw error for unknown agent type", () => {
      expect(() => {
        createExecutorForAgent(
          "unknown-agent" as AgentType,
          { workDir: "/tmp/test" },
          factoryConfig
        );
      }).toThrow(/Unknown agent type/);
    });

    it("should create LegacyShimExecutorWrapper for copilot (legacy agent)", () => {
      const wrapper = createExecutorForAgent(
        "copilot",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      expect(wrapper).toBeDefined();
      // Legacy agents now use LegacyShimExecutorWrapper
      expect(wrapper).toBeInstanceOf(LegacyShimExecutorWrapper);
    });

    it("should create LegacyShimExecutorWrapper for cursor (legacy agent)", () => {
      const wrapper = createExecutorForAgent(
        "cursor",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      expect(wrapper).toBeDefined();
      // Legacy agents now use LegacyShimExecutorWrapper
      expect(wrapper).toBeInstanceOf(LegacyShimExecutorWrapper);
    });

    it("should create AcpExecutorWrapper for ACP agents without validation (ACP handles config internally)", () => {
      // ACP agents skip legacy validation since ACP factory handles config
      const executor = createExecutorForAgent(
        "claude-code",
        { workDir: "" }, // ACP doesn't use legacy validation
        factoryConfig
      );
      // Should create AcpExecutorWrapper regardless of legacy config issues
      expect(executor).toBeInstanceOf(AcpExecutorWrapper);
    });

    it("should create AcpExecutorWrapper with valid config", () => {
      const executor = createExecutorForAgent(
        "claude-code",
        {
          workDir: "/tmp/test",
          print: true,
          outputFormat: "stream-json",
        },
        factoryConfig
      );

      // ACP-native agents use AcpExecutorWrapper
      expect(executor).toBeInstanceOf(AcpExecutorWrapper);
    });

    it("should create LegacyShimExecutorWrapper for legacy agents (unified SessionUpdate output)", () => {
      // Legacy agents now use LegacyShimExecutorWrapper for unified SessionUpdate output
      const wrapper = createExecutorForAgent(
        "copilot",
        { workDir: "/tmp/test" },
        factoryConfig
      );
      expect(wrapper).toBeInstanceOf(LegacyShimExecutorWrapper);
    });
  });

  describe("validateAgentConfig", () => {
    it("should return empty array for valid config", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "/tmp/test",
        print: true,
        outputFormat: "stream-json",
      });

      expect(errors).toEqual([]);
    });

    it("should return validation errors for invalid config", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "", // Invalid: empty workDir
        print: false,
        outputFormat: "stream-json", // Invalid: requires print mode
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain("workDir is required");
      expect(errors).toContain(
        "stream-json output format requires print mode to be enabled"
      );
    });

    it("should throw error for unknown agent", () => {
      expect(() => {
        validateAgentConfig("unknown-agent" as AgentType, {
          workDir: "/tmp/test",
        });
      }).toThrow(/not found|unknown|not registered/i);
    });

    it("should validate workDir is required", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "",
      });

      expect(errors).toContain("workDir is required");
    });

    it("should validate stream-json requires print mode", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "/tmp/test",
        print: false,
        outputFormat: "stream-json",
      });

      expect(errors).toContain(
        "stream-json output format requires print mode to be enabled"
      );
    });
  });

  describe("AgentConfigValidationError", () => {
    it("should create error with agent type and validation errors", () => {
      const error = new AgentConfigValidationError("claude-code", [
        "workDir is required",
        "invalid config",
      ]);

      expect(error.name).toBe("AgentConfigValidationError");
      expect(error.agentType).toBe("claude-code");
      expect(error.validationErrors).toEqual([
        "workDir is required",
        "invalid config",
      ]);
      expect(error.message).toContain("claude-code");
      expect(error.message).toContain("workDir is required");
      expect(error.message).toContain("invalid config");
    });
  });

  describe("agent type detection functions", () => {
    // ACP detection
    it("should identify claude-code as ACP agent", () => {
      expect(isAcpAgent("claude-code")).toBe(true);
    });

    it("should identify copilot as non-ACP (legacy) agent", () => {
      expect(isAcpAgent("copilot")).toBe(false);
    });

    it("should identify cursor as non-ACP (legacy) agent", () => {
      expect(isAcpAgent("cursor")).toBe(false);
    });

    it("should identify unknown agent as non-ACP", () => {
      expect(isAcpAgent("unknown-agent")).toBe(false);
    });

    it("should list ACP agents (currently claude-code)", () => {
      const agents = listAcpAgents();
      expect(agents).toContain("claude-code");
      expect(agents).not.toContain("copilot");
      expect(agents).not.toContain("cursor");
    });

    // Legacy detection
    it("should identify copilot as legacy agent", () => {
      expect(isLegacyAgent("copilot")).toBe(true);
    });

    it("should identify cursor as legacy agent", () => {
      expect(isLegacyAgent("cursor")).toBe(true);
    });

    it("should identify claude-code as non-legacy agent", () => {
      expect(isLegacyAgent("claude-code")).toBe(false);
    });

    it("should list legacy agents", () => {
      const agents = listLegacyAgents();
      expect(agents).toContain("copilot");
      expect(agents).toContain("cursor");
      expect(agents).not.toContain("claude-code");
    });

    // All agents
    it("should list all supported agents", () => {
      const allAgents = listAllAgents();
      expect(allAgents).toContain("claude-code");
      expect(allAgents).toContain("copilot");
      expect(allAgents).toContain("cursor");
    });

    it("should return consistent results between detection functions and list functions", () => {
      const acpAgents = listAcpAgents();
      const legacyAgents = listLegacyAgents();
      const allAgents = listAllAgents();

      // All ACP agents should be identified as ACP
      for (const agent of acpAgents) {
        expect(isAcpAgent(agent)).toBe(true);
        expect(isLegacyAgent(agent)).toBe(false);
      }

      // All legacy agents should be identified as legacy
      for (const agent of legacyAgents) {
        expect(isLegacyAgent(agent)).toBe(true);
        expect(isAcpAgent(agent)).toBe(false);
      }

      // All agents should be in the combined list
      expect(allAgents.length).toBe(acpAgents.length + legacyAgents.length);
    });
  });

  describe("executor wrapper configuration", () => {
    // Tests verify that each executor type receives the correct configuration

    let testDir: string;
    let db: Database.Database;
    let factoryConfigWithDb: ExecutorFactoryConfig;

    beforeAll(() => {
      // Create temporary directory for test database
      testDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-executor-factory-")
      );
      const dbPath = path.join(testDir, "test.db");

      // Create database
      db = new Database(dbPath);

      // Initialize minimal schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          agent_type TEXT NOT NULL,
          status TEXT NOT NULL,
          mode TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          session_id TEXT,
          exit_code INTEGER,
          error_message TEXT,
          files_changed TEXT,
          parent_execution_id TEXT,
          workflow_execution_id TEXT,
          step_type TEXT,
          step_index INTEGER,
          step_config TEXT
        );

        CREATE TABLE IF NOT EXISTS execution_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          raw_logs TEXT,
          normalized_entry TEXT,
          FOREIGN KEY (execution_id) REFERENCES executions(id)
        );
      `);

      // Create minimal factory config
      const lifecycleService = new ExecutionLifecycleService(db, testDir);
      const logsStore = new ExecutionLogsStore(db);

      factoryConfigWithDb = {
        workDir: testDir,
        lifecycleService,
        logsStore,
        projectId: "test-project",
        db,
      };
    });

    afterAll(() => {
      // Clean up
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("should create LegacyShimExecutorWrapper for legacy agents with correct config", () => {
      // Legacy agents (copilot, cursor) now use LegacyShimExecutorWrapper
      const executor = createExecutorForAgent(
        "copilot",
        { workDir: testDir },
        factoryConfigWithDb
      );

      expect(executor).toBeInstanceOf(LegacyShimExecutorWrapper);
      // LegacyShimExecutorWrapper has agentType property
      expect((executor as any).agentType).toBe("copilot");
    });

    it("should create AcpExecutorWrapper for ACP agents", () => {
      // ACP agents use AcpExecutorWrapper
      const executor = createExecutorForAgent(
        "claude-code",
        { workDir: testDir },
        factoryConfigWithDb
      );

      expect(executor).toBeInstanceOf(AcpExecutorWrapper);
    });

    it("should pass config to AcpExecutorWrapper for ACP agents", () => {
      // ACP agents receive config via acpConfig
      const executor = createExecutorForAgent(
        "claude-code",
        {
          workDir: testDir,
          mcpServers: { test: { command: "test" } } as any,
        },
        factoryConfigWithDb
      );

      expect(executor).toBeInstanceOf(AcpExecutorWrapper);
      // AcpExecutorWrapper stores config in acpConfig
      const acpConfig = (executor as any).acpConfig;
      expect(acpConfig).toBeDefined();
      expect(acpConfig.agentType).toBe("claude-code");
    });

    it("should pass model config to LegacyShimExecutorWrapper", () => {
      const executor = createExecutorForAgent(
        "cursor",
        { workDir: testDir, model: "gpt-4o" },
        factoryConfigWithDb
      );

      expect(executor).toBeInstanceOf(LegacyShimExecutorWrapper);
      expect((executor as any).agentConfig.model).toBe("gpt-4o");
    });
  });
});
