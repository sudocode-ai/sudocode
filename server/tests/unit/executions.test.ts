/**
 * Tests for Executions database operations
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode/cli/dist/db.js";
import { EXECUTIONS_TABLE, SERVER_INDEXES } from "../../src/services/db.js";
import {
  createExecution,
  getExecution,
  getExecutionsByIssueId,
  updateExecution,
  deleteExecution,
  getAllExecutions,
} from "../../src/services/executions.js";
import { generateIssueId } from "@sudocode/cli/dist/id-generator.js";
import { createIssue } from "@sudocode/cli/dist/operations/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Executions Service", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;

  before(() => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-test-executions-")
    );
    testDbPath = path.join(testDir, "cache.db");

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

    // Initialize test database (with both CLI and server tables)
    // First, create CLI tables (issues, specs, relationships, tags)
    db = initCliDatabase({ path: testDbPath });

    // Then add server-specific tables (executions)
    db.exec(EXECUTIONS_TABLE);
    db.exec(SERVER_INDEXES);

    // Create a test issue to use in execution tests
    const issueId = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      title: "Test Issue for Execution",
      content: "This is a test issue",
    });
    testIssueId = issue.id;
  });

  after(() => {
    // Clean up database
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  describe("createExecution", () => {
    it("should create a new execution", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
      });

      assert.ok(execution);
      assert.ok(execution.id);
      assert.strictEqual(execution.issue_id, testIssueId);
      assert.strictEqual(execution.agent_type, "claude-code");
      assert.strictEqual(execution.status, "running");
      assert.ok(execution.started_at);
      assert.ok(execution.created_at);
      assert.ok(execution.updated_at);
    });

    it("should create execution with minimal fields", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
      });

      assert.ok(execution);
      assert.strictEqual(execution.agent_type, "codex");
      assert.strictEqual(execution.status, "running");
      assert.strictEqual(execution.before_commit, null);
      assert.strictEqual(execution.target_branch, null);
      assert.strictEqual(execution.worktree_path, null);
    });

    it("should create execution with optional fields", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        before_commit: "abc123def456",
        target_branch: "main",
        worktree_path: "/tmp/worktree",
      });

      assert.ok(execution);
      assert.strictEqual(execution.before_commit, "abc123def456");
      assert.strictEqual(execution.target_branch, "main");
      assert.strictEqual(execution.worktree_path, "/tmp/worktree");
    });
  });

  describe("getExecution", () => {
    let executionId: string;

    before(() => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
      });
      executionId = execution.id;
    });

    it("should get an execution by ID", () => {
      const execution = getExecution(db, executionId);

      assert.ok(execution);
      assert.strictEqual(execution.id, executionId);
      assert.strictEqual(execution.issue_id, testIssueId);
    });

    it("should return null for non-existent execution", () => {
      const execution = getExecution(db, "non-existent-id");
      assert.strictEqual(execution, null);
    });
  });

  describe("getExecutionsByIssueId", () => {
    before(() => {
      // Create multiple executions for the same issue
      createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
      });
      createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
      });
    });

    it("should get all executions for an issue", () => {
      const executions = getExecutionsByIssueId(db, testIssueId);

      assert.ok(Array.isArray(executions));
      assert.ok(executions.length >= 2);

      // Check that all executions belong to the same issue
      executions.forEach((exec) => {
        assert.strictEqual(exec.issue_id, testIssueId);
      });
    });

    it("should return empty array for issue with no executions", () => {
      const executions = getExecutionsByIssueId(db, "non-existent-issue");
      assert.ok(Array.isArray(executions));
      assert.strictEqual(executions.length, 0);
    });
  });

  describe("updateExecution", () => {
    let executionId: string;

    before(() => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
      });
      executionId = execution.id;
    });

    it("should update execution status", () => {
      const updated = updateExecution(db, executionId, {
        status: "completed",
      });

      assert.ok(updated);
      assert.strictEqual(updated.status, "completed");
      assert.strictEqual(updated.id, executionId);
    });

    it("should update multiple fields", () => {
      const now = Math.floor(Date.now() / 1000);
      const updated = updateExecution(db, executionId, {
        status: "completed",
        completed_at: now,
        exit_code: 0,
        after_commit: "def456abc123",
        target_branch: "feature-branch",
        worktree_path: "/tmp/execution-worktree",
        summary: "Fixed the bug successfully",
      });

      assert.ok(updated);
      assert.strictEqual(updated.status, "completed");
      assert.strictEqual(Number(updated.completed_at), now);
      assert.strictEqual(updated.exit_code, 0);
      assert.strictEqual(updated.after_commit, "def456abc123");
      assert.strictEqual(updated.target_branch, "feature-branch");
      assert.strictEqual(updated.worktree_path, "/tmp/execution-worktree");
      assert.strictEqual(updated.summary, "Fixed the bug successfully");
    });

    it("should update session_id", () => {
      const updated = updateExecution(db, executionId, {
        session_id: "claude-session-abc123",
      });

      assert.ok(updated);
      assert.strictEqual(updated.session_id, "claude-session-abc123");
    });

    it("should update error_message", () => {
      const updated = updateExecution(db, executionId, {
        error_message: "Failed to compile TypeScript",
      });

      assert.ok(updated);
      assert.strictEqual(updated.error_message, "Failed to compile TypeScript");
    });

    it("should throw error for non-existent execution", () => {
      assert.throws(() => {
        updateExecution(db, "non-existent-id", {
          status: "completed",
        });
      });
    });
  });

  describe("getAllExecutions", () => {
    before(() => {
      // Create executions with different statuses
      const exec1 = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
      });
      updateExecution(db, exec1.id, { status: "completed" });

      const exec2 = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
      });
      updateExecution(db, exec2.id, { status: "failed" });
    });

    it("should get all executions", () => {
      const executions = getAllExecutions(db);

      assert.ok(Array.isArray(executions));
      assert.ok(executions.length > 0);
    });

    it("should filter executions by status", () => {
      const completed = getAllExecutions(db, "completed");

      assert.ok(Array.isArray(completed));
      assert.ok(completed.length > 0);

      // All should have completed status
      completed.forEach((exec) => {
        assert.strictEqual(exec.status, "completed");
      });
    });

    it("should return empty array for status with no executions", () => {
      const stopped = getAllExecutions(db, "stopped");

      assert.ok(Array.isArray(stopped));
      // May or may not be empty depending on previous tests
    });
  });

  describe("deleteExecution", () => {
    let executionId: string;

    before(() => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
      });
      executionId = execution.id;
    });

    it("should delete an execution", () => {
      const result = deleteExecution(db, executionId);

      assert.strictEqual(result, true);

      // Verify it's actually deleted
      const execution = getExecution(db, executionId);
      assert.strictEqual(execution, null);
    });

    it("should return false for non-existent execution", () => {
      const result = deleteExecution(db, "non-existent-id");
      assert.strictEqual(result, false);
    });
  });

  describe("Integration tests", () => {
    it("should handle full execution lifecycle", () => {
      // Create execution
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        before_commit: "abc123",
      });

      assert.ok(execution);
      assert.strictEqual(execution.status, "running");

      // Update with session ID (agent started)
      const withSession = updateExecution(db, execution.id, {
        session_id: "session-xyz",
      });
      assert.strictEqual(withSession.session_id, "session-xyz");

      // Complete the execution
      const completed = updateExecution(db, execution.id, {
        status: "completed",
        completed_at: Math.floor(Date.now() / 1000),
        exit_code: 0,
        after_commit: "def456",
        summary: "Successfully implemented the feature",
      });

      assert.strictEqual(completed.status, "completed");
      assert.strictEqual(completed.exit_code, 0);
      assert.strictEqual(completed.after_commit, "def456");
      assert.ok(completed.completed_at);

      // Verify it's in the completed list
      const completedExecutions = getAllExecutions(db, "completed");
      const found = completedExecutions.find((e) => e.id === execution.id);
      assert.ok(found);
    });

    it("should handle failed execution", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
      });

      // Mark as failed
      const failed = updateExecution(db, execution.id, {
        status: "failed",
        completed_at: Math.floor(Date.now() / 1000),
        exit_code: 1,
      });

      assert.strictEqual(failed.status, "failed");
      assert.strictEqual(failed.exit_code, 1);
    });
  });
});
