/**
 * Tests for Executor Factory
 *
 * These tests verify that adapter defaults are properly applied when creating executors.
 * Currently, these tests FAIL because executor-factory doesn't merge adapter defaults.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createExecutorForAgent,
  type ExecutorFactoryConfig,
} from "../../../src/execution/executors/executor-factory.js";
import type { ClaudeCodeConfig } from "@sudocode-ai/types/agents";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";

describe("createExecutorForAgent", () => {
  let testDir: string;
  let db: Database.Database;
  let factoryConfig: ExecutorFactoryConfig;

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
    const lifecycleService = new ExecutionLifecycleService(db);
    const logsStore = new ExecutionLogsStore(db);

    factoryConfig = {
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

  describe("adapter defaults", () => {
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
        factoryConfig
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
        factoryConfig
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
        factoryConfig
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
        factoryConfig
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
