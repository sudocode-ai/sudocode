/**
 * Tests for Execution WebSocket Broadcasts
 *
 * Tests that execution create/update/delete operations correctly broadcast
 * WebSocket messages to subscribers.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
} from "@sudocode-ai/types/schema";
import {
  createExecution,
  updateExecution,
  deleteExecution,
} from "../../src/services/executions.js";
import { generateIssueId } from "@sudocode-ai/cli/dist/id-generator.js";
import { createIssue } from "@sudocode-ai/cli/dist/operations/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the WebSocket module
vi.mock("../../src/services/websocket.js", () => {
  return {
    broadcastExecutionUpdate: vi.fn(),
  };
});

describe("Execution WebSocket Broadcasts", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;

  beforeAll(() => {
    // Create a unique temporary directory
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-test-exec-ws-")
    );
    testDbPath = path.join(testDir, "cache.db");
    process.env.SUDOCODE_DIR = testDir;

    // Create config.json
    const configPath = path.join(testDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Initialize database
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);

    // Create a test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test Issue for WebSocket",
      content: "Test issue content",
    });
    testIssueId = issue.id;
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.SUDOCODE_DIR;
  });

  beforeEach(async () => {
    // Clear mock call history before each test
    vi.clearAllMocks();
  });

  describe("createExecution broadcasts", () => {
    it("should broadcast execution_created when creating execution with issue", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      expect(broadcastExecutionUpdate).toHaveBeenCalledTimes(1);
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        execution.id,
        "created",
        execution,
        testIssueId
      );
    });

    it("should broadcast execution_created with undefined issueId when creating execution without issue", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      const execution = createExecution(db, {
        issue_id: null,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      expect(broadcastExecutionUpdate).toHaveBeenCalledTimes(1);
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        execution.id,
        "created",
        execution,
        undefined
      );
    });
  });

  describe("updateExecution broadcasts", () => {
    it("should broadcast execution_status_changed when status changes", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      // Create execution
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      // Clear mock calls from creation
      vi.clearAllMocks();

      // Update status
      const updated = updateExecution(db, execution.id, {
        status: "completed",
      });

      expect(broadcastExecutionUpdate).toHaveBeenCalledTimes(1);
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        execution.id,
        "status_changed",
        updated,
        testIssueId
      );
    });

    it("should broadcast execution_updated when non-status fields change", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      // Create execution
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      // Clear mock calls from creation
      vi.clearAllMocks();

      // Update summary
      const updated = updateExecution(db, execution.id, {
        summary: "Test summary",
      });

      expect(broadcastExecutionUpdate).toHaveBeenCalledTimes(1);
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        execution.id,
        "updated",
        updated,
        testIssueId
      );
    });

    it("should broadcast with undefined issueId for executions without issue", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      // Create execution without issue
      const execution = createExecution(db, {
        issue_id: null,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      // Clear mock calls from creation
      vi.clearAllMocks();

      // Update
      const updated = updateExecution(db, execution.id, {
        summary: "Test",
      });

      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        execution.id,
        "updated",
        updated,
        undefined
      );
    });
  });

  describe("deleteExecution broadcasts", () => {
    it("should broadcast execution_deleted when deleting execution", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      // Create execution
      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      // Clear mock calls from creation
      vi.clearAllMocks();

      // Delete
      const deleted = deleteExecution(db, execution.id);

      expect(deleted).toBe(true);
      expect(broadcastExecutionUpdate).toHaveBeenCalledTimes(1);
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        execution.id,
        "deleted",
        { id: execution.id },
        testIssueId
      );
    });

    it("should not broadcast when deleting non-existent execution", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      const deleted = deleteExecution(db, "non-existent-id");

      expect(deleted).toBe(false);
      expect(broadcastExecutionUpdate).not.toHaveBeenCalled();
    });
  });

  describe("dual broadcast behavior", () => {
    it("should include issue_id in broadcast for issue-linked executions", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      const execution = createExecution(db, {
        issue_id: testIssueId,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      // Verify that issueId is passed for dual broadcast
      const calls = vi.mocked(broadcastExecutionUpdate).mock.calls;
      expect(calls[0][3]).toBe(testIssueId); // Fourth parameter is issueId
    });

    it("should pass undefined issue_id for standalone executions", async () => {
      const { broadcastExecutionUpdate } = await import("../../src/services/websocket.js");

      const execution = createExecution(db, {
        issue_id: null,
        agent_type: "claude-code",
        target_branch: "main",
        branch_name: "main",
      });

      // Verify that issueId is undefined for executions without issue
      const calls = vi.mocked(broadcastExecutionUpdate).mock.calls;
      expect(calls[0][3]).toBeUndefined();
    });
  });
});
