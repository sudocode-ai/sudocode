/**
 * Integration Tests for ExecutionLogsStore with ExecutionService
 *
 * Tests that ExecutionLogsStore is properly integrated into the execution lifecycle:
 * - Log initialization on execution creation
 * - Log initialization on follow-up execution creation
 * - Error handling in log operations
 *
 * Note: These are unit tests that mock the execution engine, not full E2E tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import {
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  EXECUTION_LOGS_INDEXES,
  ISSUES_TABLE,
} from "@sudocode-ai/types/schema";

describe("ExecutionLogsStore Integration", () => {
  let db: Database.Database;
  let executionService: ExecutionService;
  let logsStore: ExecutionLogsStore;
  let testDir: string;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");

    // Set up schema (disable foreign keys for unit tests)
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTION_LOGS_TABLE);
    db.exec(EXECUTION_LOGS_INDEXES);
    db.exec(ISSUES_TABLE);

    // Create test issue
    db.prepare(`
      INSERT INTO issues (id, uuid, title, content, status, priority)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "ISSUE-001",
      "00000000-0000-0000-0000-000000000001",
      "Test Issue",
      "Test content",
      "open",
      2
    );

    // Create test directory for repo
    testDir = "/tmp/test-repo";

    // Create logs store
    logsStore = new ExecutionLogsStore(db);

    // Create lifecycle service (we won't use worktrees in these tests)
    const lifecycleService = new ExecutionLifecycleService(db, testDir);

    // Create execution service with logs store
    executionService = new ExecutionService(
      db,
      "test-project",
      testDir,
      lifecycleService,
      undefined, // No transport manager
      logsStore
    );
  });

  afterEach(() => {
    db.close();
  });

  describe("Log Initialization", () => {
    it("should initialize logs when creating execution in local mode", async () => {
      // Create execution in local mode (no worktree, faster for unit test)
      const execution = await executionService.createExecution(
        "ISSUE-001",
        {
          mode: "local",
          baseBranch: "main",
        },
        "Test prompt"
      );

      // Verify execution was created
      expect(execution).toBeDefined();
      expect(execution.id).toBeDefined();

      // Verify logs were initialized
      const metadata = logsStore.getLogMetadata(execution.id);
      expect(metadata).not.toBeNull();
      expect(metadata!.execution_id).toBe(execution.id);
      expect(metadata!.line_count).toBe(0);
      expect(metadata!.byte_size).toBe(0);

      // Verify we can retrieve empty logs
      const logs = logsStore.getRawLogs(execution.id);
      expect(logs).toEqual([]);
    });

    it("should initialize logs for multiple executions independently", async () => {
      // Create second test issue
      db.prepare(`
        INSERT INTO issues (id, uuid, title, content, status, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "ISSUE-002",
        "00000000-0000-0000-0000-000000000002",
        "Test Issue 2",
        "Test content 2",
        "open",
        2
      );

      // Create two executions
      const execution1 = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Test prompt 1"
      );

      const execution2 = await executionService.createExecution(
        "ISSUE-002",
        { mode: "local", baseBranch: "main" },
        "Test prompt 2"
      );

      // Verify both have independent logs
      const metadata1 = logsStore.getLogMetadata(execution1.id);
      const metadata2 = logsStore.getLogMetadata(execution2.id);

      expect(metadata1).not.toBeNull();
      expect(metadata2).not.toBeNull();
      expect(metadata1!.execution_id).toBe(execution1.id);
      expect(metadata2!.execution_id).toBe(execution2.id);
    });

    it("should handle log initialization failure gracefully", async () => {
      // Create a spy on logsStore.initializeLogs to make it throw
      const initSpy = vi
        .spyOn(logsStore, "initializeLogs")
        .mockImplementationOnce(() => {
          throw new Error("Database error");
        });

      // Create execution should still succeed even if log init fails
      const execution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Test prompt"
      );

      // Verify execution was still created
      expect(execution).toBeDefined();
      expect(execution.id).toBeDefined();

      // Verify initializeLogs was called
      expect(initSpy).toHaveBeenCalledWith(execution.id);

      // Logs should not exist due to failure
      const metadata = logsStore.getLogMetadata(execution.id);
      expect(metadata).toBeNull();
    });
  });

  describe("Follow-up Execution Logs", () => {
    it.skip("should initialize logs for follow-up execution", async () => {
      // Create initial execution
      const initialExecution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Initial prompt"
      );

      // Update execution to have completed status and worktree path (required for follow-up)
      db.prepare(`
        UPDATE executions
        SET status = 'completed', completed_at = ?, worktree_path = ?
        WHERE id = ?
      `).run(new Date().toISOString(), "/tmp/test-worktree", initialExecution.id);

      // Create follow-up execution
      const followUpExecution = await executionService.createFollowUp(
        initialExecution.id,
        "Please make this change"
      );

      // Verify follow-up has its own logs initialized
      const metadata = logsStore.getLogMetadata(followUpExecution.id);
      expect(metadata).not.toBeNull();
      expect(metadata!.execution_id).toBe(followUpExecution.id);
      expect(metadata!.line_count).toBe(0);
      expect(metadata!.byte_size).toBe(0);

      // Verify initial execution logs are separate
      const initialMetadata = logsStore.getLogMetadata(initialExecution.id);
      expect(initialMetadata).not.toBeNull();
      expect(initialMetadata!.execution_id).toBe(initialExecution.id);
    });

    it.skip("should handle log initialization failure in follow-up gracefully", async () => {
      // Create initial execution
      const initialExecution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Initial prompt"
      );

      // Update execution to have completed status and worktree path
      db.prepare(`
        UPDATE executions
        SET status = 'completed', completed_at = ?, worktree_path = ?
        WHERE id = ?
      `).run(new Date().toISOString(), "/tmp/test-worktree", initialExecution.id);

      // Create a spy on logsStore.initializeLogs to make it throw on second call
      let callCount = 0;
      const initSpy = vi
        .spyOn(logsStore, "initializeLogs")
        .mockImplementation((executionId: string) => {
          callCount++;
          if (callCount > 1) {
            throw new Error("Database error");
          }
          // Call original implementation for first call
          const stmt = db.prepare(`
            INSERT OR IGNORE INTO execution_logs (execution_id, raw_logs, byte_size, line_count)
            VALUES (?, '', 0, 0)
          `);
          stmt.run(executionId);
        });

      // Create follow-up should still succeed
      const followUpExecution = await executionService.createFollowUp(
        initialExecution.id,
        "Follow-up feedback"
      );

      // Verify follow-up execution was created
      expect(followUpExecution).toBeDefined();
      expect(initSpy).toHaveBeenCalledTimes(2);

      // Follow-up logs should not exist due to failure
      const followUpMetadata = logsStore.getLogMetadata(followUpExecution.id);
      expect(followUpMetadata).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should not throw if logs already initialized (idempotent)", async () => {
      const execution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Test prompt"
      );

      // Try initializing again manually (should be no-op due to INSERT OR IGNORE)
      expect(() => {
        logsStore.initializeLogs(execution.id);
      }).not.toThrow();

      // Verify still only one log entry
      const metadata = logsStore.getLogMetadata(execution.id);
      expect(metadata).not.toBeNull();
      expect(metadata!.line_count).toBe(0);
    });

    it("should handle database closed scenario", async () => {
      const execution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Test prompt"
      );

      // Close database to simulate error condition
      const tempDb = db;
      tempDb.close();

      // Try to get metadata (should fail gracefully in actual usage)
      expect(() => {
        logsStore.getLogMetadata(execution.id);
      }).toThrow();

      // Recreate database for cleanup
      db = new Database(":memory:");
    });
  });

  describe("Log Store Integration", () => {
    it("should allow appending logs after execution creation", async () => {
      const execution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Test prompt"
      );

      // Simulate appending logs (as would happen during execution)
      logsStore.appendRawLog(
        execution.id,
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}'
      );
      logsStore.appendRawLog(
        execution.id,
        '{"type":"result","usage":{"input_tokens":100,"output_tokens":50}}'
      );

      // Verify logs were persisted
      const logs = logsStore.getRawLogs(execution.id);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain("assistant");
      expect(logs[1]).toContain("result");

      // Verify metadata updated
      const metadata = logsStore.getLogMetadata(execution.id);
      expect(metadata!.line_count).toBe(2);
      expect(metadata!.byte_size).toBeGreaterThan(0);
    });

    it("should allow querying logs via API endpoint pattern", async () => {
      const execution = await executionService.createExecution(
        "ISSUE-001",
        { mode: "local", baseBranch: "main" },
        "Test prompt"
      );

      // Add some logs
      logsStore.appendRawLogs(execution.id, [
        '{"type":"assistant","message":{}}',
        '{"type":"tool_result","result":{}}',
        '{"type":"result","usage":{}}',
      ]);

      // Query logs (as API endpoint would do)
      const logs = logsStore.getRawLogs(execution.id);
      const metadata = logsStore.getLogMetadata(execution.id);

      // Verify API response shape
      expect(logs).toHaveLength(3);
      expect(metadata).not.toBeNull();
      expect(metadata!.line_count).toBe(3);
      expect(metadata!.execution_id).toBe(execution.id);
      expect(metadata!.created_at).toBeDefined();
      expect(metadata!.updated_at).toBeDefined();
    });
  });

  describe("Execution Service Methods", () => {
    it("should have logsStore instance available", () => {
      // Verify ExecutionService has logsStore
      expect((executionService as any).logsStore).toBeDefined();
      expect((executionService as any).logsStore).toBeInstanceOf(
        ExecutionLogsStore
      );
    });

    it("should use the same logsStore instance passed to constructor", () => {
      // Create a new service with explicit logsStore
      const customLogsStore = new ExecutionLogsStore(db);
      const customService = new ExecutionService(
        db,
        "test-project",
        testDir,
        undefined,
        undefined,
        customLogsStore
      );

      // Verify it uses the same instance
      expect((customService as any).logsStore).toBe(customLogsStore);
    });

    it("should create default logsStore if not provided", () => {
      // Create service without explicit logsStore
      const serviceWithoutLogs = new ExecutionService(
        db,
        "test-project",
        testDir,
        undefined,
        undefined
        // logsStore omitted
      );

      // Should have created a default instance
      expect((serviceWithoutLogs as any).logsStore).toBeDefined();
      expect((serviceWithoutLogs as any).logsStore).toBeInstanceOf(
        ExecutionLogsStore
      );
    });
  });
});
