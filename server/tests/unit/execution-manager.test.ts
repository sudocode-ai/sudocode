/**
 * Tests for ExecutionManager
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode/cli/dist/db.js";
import { EXECUTIONS_TABLE, SERVER_INDEXES } from "../../src/services/db.js";
import { ExecutionManager } from "../../src/execution/manager.js";
import { generateIssueId } from "@sudocode/cli/dist/id-generator.js";
import { createIssue } from "@sudocode/cli/dist/operations/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ExecutionManager", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let logsDir: string;
  let testIssueId: string;
  let manager: ExecutionManager;

  before(() => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-test-exec-manager-")
    );
    testDbPath = path.join(testDir, "cache.db");
    logsDir = path.join(testDir, "logs");

    // Set SUDOCODE_DIR environment variable
    process.env.SUDOCODE_DIR = testDir;

    // Create config.json for ID generation
    const configPath = path.join(testDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Initialize test database
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(SERVER_INDEXES);

    // Create a test issue
    const issueId = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      title: "Test Issue for Execution Manager",
      description: "This is a test issue",
    });
    testIssueId = issue.id;
  });

  beforeEach(() => {
    // Create a new manager for each test
    manager = new ExecutionManager(db, logsDir);
  });

  after(async () => {
    // Clean up any running executions
    await manager.cleanup();

    // Close database
    db.close();

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  describe("Constructor", () => {
    it("should create logs directory if it doesn't exist", () => {
      const customLogsDir = path.join(testDir, "custom-logs");
      const customManager = new ExecutionManager(db, customLogsDir);

      assert.ok(customManager);
      assert.ok(fs.existsSync(customLogsDir));
    });

    it("should use default logs directory if not provided", () => {
      const defaultManager = new ExecutionManager(db);
      // Just verify it doesn't throw
      assert.ok(defaultManager);
    });
  });

  describe("startExecution", () => {
    it("should start an execution and create database record", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      assert.ok(execution);
      assert.ok(execution.id);
      assert.strictEqual(execution.issue_id, testIssueId);
      assert.strictEqual(execution.agent_type, "claude-code");
      assert.strictEqual(execution.status, "running");

      // Wait a bit for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should create log file for execution", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      // Wait a bit for log file to be created (writeStream needs time to create file)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const logFile = manager.getLogFilePath(execution.id);
      assert.ok(fs.existsSync(logFile));

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should track execution as running", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      assert.ok(manager.isRunning(execution.id));

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should support optional fields", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "codex",
        before_commit: "abc123",
        target_branch: "main",
        worktree_path: "/tmp/worktree",
      });

      assert.ok(execution);
      assert.strictEqual(execution.before_commit, "abc123");
      assert.strictEqual(execution.target_branch, "main");
      assert.strictEqual(execution.worktree_path, "/tmp/worktree");

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe("stopExecution", () => {
    it("should stop a running execution", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      assert.ok(manager.isRunning(execution.id));

      const stopped = await manager.stopExecution(execution.id);

      assert.strictEqual(stopped.status, "stopped");
      assert.ok(stopped.completed_at);
      assert.ok(!manager.isRunning(execution.id));
    });

    it("should throw error for non-running execution", async () => {
      await assert.rejects(
        async () => {
          await manager.stopExecution("non-existent-id");
        },
        {
          message: /is not running/,
        }
      );
    });
  });

  describe("getExecutionStatus", () => {
    it("should get execution status from database", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      const status = manager.getExecutionStatus(execution.id);

      assert.ok(status);
      assert.strictEqual(status.id, execution.id);
      assert.strictEqual(status.issue_id, testIssueId);

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should return null for non-existent execution", () => {
      const status = manager.getExecutionStatus("non-existent-id");
      assert.strictEqual(status, null);
    });
  });

  describe("getLogFilePath", () => {
    it("should return log file path for running execution", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      const logPath = manager.getLogFilePath(execution.id);
      assert.ok(logPath.includes(execution.id));
      assert.ok(logPath.endsWith(".log"));

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should return expected path for non-running execution", () => {
      const logPath = manager.getLogFilePath("some-id");
      assert.ok(logPath.includes("some-id"));
      assert.ok(logPath.endsWith(".log"));
    });
  });

  describe("isRunning", () => {
    it("should return true for running execution", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      assert.ok(manager.isRunning(execution.id));

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should return false for non-running execution", () => {
      assert.ok(!manager.isRunning("non-existent-id"));
    });

    it("should return false after execution completes", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.ok(!manager.isRunning(execution.id));
    });
  });

  describe("getRunningExecutionIds", () => {
    it("should return empty array when no executions running", () => {
      const ids = manager.getRunningExecutionIds();
      assert.ok(Array.isArray(ids));
      assert.strictEqual(ids.length, 0);
    });

    it("should return IDs of running executions", async () => {
      const exec1 = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      const exec2 = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "codex",
      });

      const ids = manager.getRunningExecutionIds();
      assert.ok(ids.includes(exec1.id));
      assert.ok(ids.includes(exec2.id));

      // Wait for processes to complete
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  describe("cleanup", () => {
    it("should stop all running executions", async () => {
      const exec1 = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      const exec2 = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "codex",
      });

      assert.ok(exec1);
      assert.ok(exec2);
      assert.strictEqual(manager.getRunningExecutionIds().length, 2);

      await manager.cleanup();

      assert.strictEqual(manager.getRunningExecutionIds().length, 0);
    });
  });

  describe("Process Lifecycle", () => {
    it("should update status when process exits successfully", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const status = manager.getExecutionStatus(execution.id);
      assert.ok(status);
      assert.strictEqual(status.status, "completed");
      assert.strictEqual(status.exit_code, 0);
      assert.ok(status.completed_at);
    });

    it("should write logs to file", async () => {
      const execution = await manager.startExecution({
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const logPath = manager.getLogFilePath(execution.id);
      const logContent = fs.readFileSync(logPath, "utf-8");

      // Should contain the output from our test command
      assert.ok(logContent.includes("Claude Code agent running"));
    });

    it("should handle multiple executions concurrently", async () => {
      const executions = await Promise.all([
        manager.startExecution({
          issue_id: testIssueId,
          agent_type: "claude-code",
        }),
        manager.startExecution({
          issue_id: testIssueId,
          agent_type: "codex",
        }),
        manager.startExecution({
          issue_id: testIssueId,
          agent_type: "claude-code",
        }),
      ]);

      assert.strictEqual(executions.length, 3);

      // Wait for all processes to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify all completed successfully
      for (const exec of executions) {
        const status = manager.getExecutionStatus(exec.id);
        assert.ok(status);
        assert.strictEqual(status.status, "completed");
      }
    });
  });
});
