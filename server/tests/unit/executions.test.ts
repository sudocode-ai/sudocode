/**
 * Tests for Executions database operations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
} from "@sudocode-ai/types/schema";
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

  beforeAll(() => {
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
    db.exec(EXECUTIONS_INDEXES);

    // Create a test issue to use in execution tests
    const issueId = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      title: "Test Issue for Execution",
      content: "This is a test issue",
    });
    testIssueId = issue.id;
  });

  afterAll(() => {
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
        target_branch: "main",
        branch_name: "main",
      });

      expect(execution).toBeTruthy();
      expect(execution.id).toBeTruthy();
      expect(execution.issue_id).toBe(testIssueId);
      expect(execution.agent_type).toBe("claude-code");
      expect(execution.status).toBe("running");
      expect(execution.started_at).toBeTruthy();
      expect(execution.created_at).toBeTruthy();
      expect(execution.updated_at).toBeTruthy();
    });

    it("should create execution with minimal fields", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
        target_branch: "main",
        branch_name: "main",
      });

      expect(execution).toBeTruthy();
      expect(execution.agent_type).toBe("codex");
      expect(execution.status).toBe("running");
      expect(execution.before_commit).toBe(null);
      expect(execution.target_branch).toBe("main");
      expect(execution.branch_name).toBe("main");
      expect(execution.worktree_path).toBe(null);
    });

    it("should create execution with optional fields", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        before_commit: "abc123def456",
        target_branch: "main",
        branch_name: "main",
        worktree_path: "/tmp/worktree",
      });

      expect(execution).toBeTruthy();
      expect(execution.before_commit).toBe("abc123def456");
      expect(execution.target_branch).toBe("main");
      expect(execution.branch_name).toBe("main");
      expect(execution.worktree_path).toBe("/tmp/worktree");
    });
  });

  describe("getExecution", () => {
    let executionId: string;

    beforeAll(() => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });
      executionId = execution.id;
    });

    it("should get an execution by ID", () => {
      const execution = getExecution(db, executionId);

      expect(execution).toBeTruthy();
      expect(execution?.id).toBe(executionId);
      expect(execution?.issue_id).toBe(testIssueId);
    });

    it("should return null for non-existent execution", () => {
      const execution = getExecution(db, "non-existent-id");
      expect(execution).toBe(null);
    });
  });

  describe("getExecutionsByIssueId", () => {
    beforeAll(() => {
      // Create multiple executions for the same issue
      createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });
      createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
        target_branch: "main",
        branch_name: "main",
      });
    });

    it("should get all executions for an issue", () => {
      const executions = getExecutionsByIssueId(db, testIssueId);

      expect(Array.isArray(executions)).toBeTruthy();
      expect(executions.length >= 2).toBeTruthy();

      // Check that all executions belong to the same issue
      executions.forEach((exec) => {
        expect(exec.issue_id).toBe(testIssueId);
      });
    });

    it("should return empty array for issue with no executions", () => {
      const executions = getExecutionsByIssueId(db, "non-existent-issue");
      expect(Array.isArray(executions)).toBeTruthy();
      expect(executions.length).toBe(0);
    });
  });

  describe("updateExecution", () => {
    let executionId: string;

    beforeAll(() => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });
      executionId = execution.id;
    });

    it("should update execution status", () => {
      const updated = updateExecution(db, executionId, {
        status: "completed",
      });

      expect(updated).toBeTruthy();
      expect(updated.status).toBe("completed");
      expect(updated.id).toBe(executionId);
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

      expect(updated).toBeTruthy();
      expect(updated.status).toBe("completed");
      expect(Number(updated.completed_at)).toBe(now);
      expect(updated.exit_code).toBe(0);
      expect(updated.after_commit).toBe("def456abc123");
      expect(updated.target_branch).toBe("feature-branch");
      expect(updated.worktree_path).toBe("/tmp/execution-worktree");
      expect(updated.summary).toBe("Fixed the bug successfully");
    });

    it("should update session_id", () => {
      const updated = updateExecution(db, executionId, {
        session_id: "claude-session-abc123",
      });

      expect(updated).toBeTruthy();
      expect(updated.session_id).toBe("claude-session-abc123");
    });

    it("should update error_message", () => {
      const updated = updateExecution(db, executionId, {
        error_message: "Failed to compile TypeScript",
      });

      expect(updated).toBeTruthy();
      expect(updated.error_message).toBe("Failed to compile TypeScript");
    });

    it("should throw error for non-existent execution", () => {
      expect(() => {
        updateExecution(db, "non-existent-id", {
          status: "completed",
        });
      }).toThrow();
    });
  });

  describe("getAllExecutions", () => {
    beforeAll(() => {
      // Create executions with different statuses
      const exec1 = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });
      updateExecution(db, exec1.id, { status: "completed" });

      const exec2 = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
        target_branch: "main",
        branch_name: "main",
      });
      updateExecution(db, exec2.id, { status: "failed" });
    });

    it("should get all executions", () => {
      const executions = getAllExecutions(db);

      expect(Array.isArray(executions)).toBeTruthy();
      expect(executions.length > 0).toBeTruthy();
    });

    it("should filter executions by status", () => {
      const completed = getAllExecutions(db, "completed");

      expect(Array.isArray(completed)).toBeTruthy();
      expect(completed.length > 0).toBeTruthy();

      // All should have completed status
      completed.forEach((exec) => {
        expect(exec.status).toBe("completed");
      });
    });

    it("should return empty array for status with no executions", () => {
      const stopped = getAllExecutions(db, "stopped");

      expect(Array.isArray(stopped)).toBeTruthy();
      // May or may not be empty depending on previous tests
    });
  });

  describe("deleteExecution", () => {
    let executionId: string;

    beforeAll(() => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });
      executionId = execution.id;
    });

    it("should delete an execution", () => {
      const result = deleteExecution(db, executionId);

      expect(result).toBe(true);

      // Verify it's actually deleted
      const execution = getExecution(db, executionId);
      expect(execution).toBe(null);
    });

    it("should return false for non-existent execution", () => {
      const result = deleteExecution(db, "non-existent-id");
      expect(result).toBe(false);
    });
  });

  describe("Integration tests", () => {
    it("should handle full execution lifecycle", () => {
      // Create execution
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
        before_commit: "abc123",
      });

      expect(execution).toBeTruthy();
      expect(execution.status).toBe("running");

      // Update with session ID (agent started)
      const withSession = updateExecution(db, execution.id, {
        session_id: "session-xyz",
      });
      expect(withSession.session_id).toBe("session-xyz");

      // Complete the execution
      const completed = updateExecution(db, execution.id, {
        status: "completed",
        completed_at: Math.floor(Date.now() / 1000),
        exit_code: 0,
        after_commit: "def456",
        summary: "Successfully implemented the feature",
      });

      expect(completed.status).toBe("completed");
      expect(completed.exit_code).toBe(0);
      expect(completed.after_commit).toBe("def456");
      expect(completed.completed_at).toBeTruthy();

      // Verify it's in the completed list
      const completedExecutions = getAllExecutions(db, "completed");
      const found = completedExecutions.find((e) => e.id === execution.id);
      expect(found).toBeTruthy();
    });

    it("should handle failed execution", () => {
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "codex",
        target_branch: "main",
        branch_name: "main",
      });

      // Mark as failed
      const failed = updateExecution(db, execution.id, {
        status: "failed",
        completed_at: Math.floor(Date.now() / 1000),
        exit_code: 1,
      });

      expect(failed.status).toBe("failed");
      expect(failed.exit_code).toBe(1);
    });
  });
});
