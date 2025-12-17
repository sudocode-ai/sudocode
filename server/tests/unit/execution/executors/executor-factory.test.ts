/**
 * Unit tests for Executor Factory
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import {
  createExecutorForAgent,
  validateAgentConfig,
  AgentConfigValidationError,
} from "../../../../src/execution/executors/executor-factory.js";
import {
  AgentNotFoundError,
  AgentNotImplementedError,
} from "../../../../src/services/agent-registry.js";
import { AgentExecutorWrapper } from "../../../../src/execution/executors/agent-executor-wrapper.js";
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
const mockTransportManager = {} as any;

const factoryConfig: ExecutorFactoryConfig = {
  workDir: "/tmp/test",
  lifecycleService: mockLifecycleService,
  logsStore: mockLogsStore,
  projectId: "test-project",
  db: mockDb,
  transportManager: mockTransportManager,
};

describe("ExecutorFactory", () => {
  describe("createExecutorForAgent", () => {
    it("should create AgentExecutorWrapper for claude-code agent", () => {
      const executor = createExecutorForAgent(
        "claude-code",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      // All agents now use unified AgentExecutorWrapper
      expect(executor).toBeInstanceOf(AgentExecutorWrapper);
    });

    it("should create AgentExecutorWrapper for codex agent", () => {
      const executor = createExecutorForAgent(
        "codex",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      // All agents now use unified AgentExecutorWrapper
      expect(executor).toBeInstanceOf(AgentExecutorWrapper);
    });

    it("should throw AgentNotFoundError for unknown agent type", () => {
      expect(() => {
        createExecutorForAgent(
          "unknown-agent" as AgentType,
          { workDir: "/tmp/test" },
          factoryConfig
        );
      }).toThrow(AgentNotFoundError);
    });

    it("should create AgentExecutorWrapper for copilot", () => {
      const wrapper = createExecutorForAgent(
        "copilot",
        { workDir: "/tmp/test", allowAllTools: true },
        factoryConfig
      );

      expect(wrapper).toBeDefined();
      expect(wrapper.constructor.name).toBe("AgentExecutorWrapper");
    });

    it("should create AgentExecutorWrapper for cursor", () => {
      const wrapper = createExecutorForAgent(
        "cursor",
        { workDir: "/tmp/test", force: true },
        factoryConfig
      );

      expect(wrapper).toBeDefined();
      expect(wrapper.constructor.name).toBe("AgentExecutorWrapper");
    });

    it("should validate config before creating executor", () => {
      // Invalid config: missing workDir
      expect(() => {
        createExecutorForAgent(
          "claude-code",
          { workDir: "" }, // Empty workDir is invalid
          factoryConfig
        );
      }).toThrow(AgentConfigValidationError);
    });

    it("should throw AgentConfigValidationError with validation errors", () => {
      try {
        createExecutorForAgent(
          "claude-code",
          {
            workDir: "",
            print: false,
            outputFormat: "stream-json", // Invalid: stream-json requires print mode
          },
          factoryConfig
        );
        expect.fail("Should have thrown AgentConfigValidationError");
      } catch (error) {
        expect(error).toBeInstanceOf(AgentConfigValidationError);
        const validationError = error as AgentConfigValidationError;
        expect(validationError.agentType).toBe("claude-code");
        expect(validationError.validationErrors.length).toBeGreaterThan(0);
      }
    });

    it("should create executor with valid config", () => {
      const executor = createExecutorForAgent(
        "claude-code",
        {
          workDir: "/tmp/test",
          print: true,
          outputFormat: "stream-json",
        },
        factoryConfig
      );

      // All agents now use unified AgentExecutorWrapper
      expect(executor).toBeInstanceOf(AgentExecutorWrapper);
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

    it("should throw AgentNotFoundError for unknown agent", () => {
      expect(() => {
        validateAgentConfig("unknown-agent" as AgentType, {
          workDir: "/tmp/test",
        });
      }).toThrow(AgentNotFoundError);
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

  describe("adapter defaults", () => {
    let testDir: string;
    let db: Database.Database;
    let factoryConfigWithDb: ExecutorFactoryConfig;

    beforeAll(() => {
      // Create temporary directory for test database
      testDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-executor-factory-")
      );
      const dbPath = path.join(testDir, "test.db");

      // Create in-memory database
      db = new Database(dbPath);

      // Initialize minimal schema for ExecutionLifecycleService
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

    it("should apply adapter defaults when config fields are missing", () => {
      // Arrange: Create config without dangerouslySkipPermissions
      const agentConfig: ClaudeCodeConfig = {
        workDir: testDir,
        // dangerouslySkipPermissions not provided
      };

      // Act: Create executor
      const executor = createExecutorForAgent(
        "claude-code",
        agentConfig,
        factoryConfigWithDb
      );

      // Assert: Adapter's default should be applied
      // ClaudeCodeAdapter.getDefaultConfig() returns { dangerouslySkipPermissions: true }
      // Access private field for testing using type assertion
      const agentConfigInternal = (executor as any)._agentConfig;
      expect(agentConfigInternal.dangerouslySkipPermissions).toBe(true);
    });

    it("should apply adapter defaults when config fields are explicitly undefined", () => {
      // Arrange: Config with explicit undefined
      const agentConfig: ClaudeCodeConfig = {
        workDir: testDir,
        dangerouslySkipPermissions: undefined,
      };

      // Act: Create executor
      const executor = createExecutorForAgent(
        "claude-code",
        agentConfig,
        factoryConfigWithDb
      );

      // Assert: Adapter's default should win over undefined
      const agentConfigInternal = (executor as any)._agentConfig;
      expect(agentConfigInternal.dangerouslySkipPermissions).toBe(true);
    });

    it("should allow config to override adapter defaults when explicitly set", () => {
      // Arrange: Config with explicit value (even if it differs from default)
      const agentConfig: ClaudeCodeConfig = {
        workDir: testDir,
        dangerouslySkipPermissions: false, // Explicit override
        print: false, // Override another default
        outputFormat: "text", // Must override outputFormat when setting print: false (stream-json requires print: true)
      };

      // Act: Create executor
      const executor = createExecutorForAgent(
        "claude-code",
        agentConfig,
        factoryConfigWithDb
      );

      // Assert: Explicit values should override defaults
      const agentConfigInternal = (executor as any)._agentConfig;
      expect(agentConfigInternal.dangerouslySkipPermissions).toBe(false);
      expect(agentConfigInternal.print).toBe(false);
      expect(agentConfigInternal.outputFormat).toBe("text");
    });

    it("should preserve defaults when creating task-specific executor with undefined metadata", () => {
      // Arrange: Create executor with defaults applied
      const agentConfig: ClaudeCodeConfig = {
        workDir: testDir,
        // dangerouslySkipPermissions not provided - should get default (true)
      };

      const executor = createExecutorForAgent(
        "claude-code",
        agentConfig,
        factoryConfigWithDb
      );

      // Verify wrapper has correct default
      const wrapperConfig = (executor as any)._agentConfig;
      expect(wrapperConfig.dangerouslySkipPermissions).toBe(true);

      // Act: Simulate what happens when executing a task with undefined metadata
      // This is what agent-executor-wrapper does internally
      const taskMetadata = {
        dangerouslySkipPermissions: undefined, // Undefined from API request
      };

      // Build task-specific config (simulating agent-executor-wrapper logic)
      const taskSpecificConfig: Record<string, any> = { ...wrapperConfig };
      if (taskMetadata.dangerouslySkipPermissions !== undefined) {
        taskSpecificConfig.dangerouslySkipPermissions = taskMetadata.dangerouslySkipPermissions;
      }

      // Assert: Default should be preserved (not overridden by undefined)
      expect(taskSpecificConfig.dangerouslySkipPermissions).toBe(true);
    });
  });
});
