/**
 * ExecutionLogsCleanup Service Tests
 *
 * Tests for the automatic cleanup service that prunes old execution logs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExecutionLogsCleanup, DEFAULT_CLEANUP_CONFIG } from "../../../src/services/execution-logs-cleanup.js";
import { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";
import Database from "better-sqlite3";
import { EXECUTION_LOGS_TABLE, EXECUTIONS_TABLE } from "@sudocode-ai/types/schema";

describe("ExecutionLogsCleanup", () => {
  let db: Database.Database;
  let logsStore: ExecutionLogsStore;
  let cleanup: ExecutionLogsCleanup;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(":memory:");

    // Disable foreign keys for unit tests
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTION_LOGS_TABLE);

    // Create logs store
    logsStore = new ExecutionLogsStore(db);

    // Create some test executions and logs with different ages
    const now = Date.now();
    const oneHourAgo = new Date(now - 3600000).toISOString();
    const oneDayAgo = new Date(now - 86400000).toISOString();
    const oneWeekAgo = new Date(now - 604800000).toISOString();
    const oneMonthAgo = new Date(now - 2592000000).toISOString();

    // Helper to insert execution and logs
    const insertExecution = (id: string, completedAt: string) => {
      db.prepare(`
        INSERT INTO executions (id, issue_id, status, mode, model, target_branch, branch_name, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, "issue-1", "completed", "local", "claude-3-5-sonnet-20241022", "main", `exec-${id}`, completedAt, completedAt);

      db.prepare(`
        INSERT INTO execution_logs (execution_id, raw_logs, line_count, byte_size, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, "", 0, 0, completedAt, completedAt);
    };

    // Insert test executions with various ages
    insertExecution("exec-recent", oneHourAgo);
    insertExecution("exec-day", oneDayAgo);
    insertExecution("exec-week", oneWeekAgo);
    insertExecution("exec-month", oneMonthAgo);
  });

  afterEach(() => {
    if (cleanup) {
      cleanup.stop();
    }
    db.close();
  });

  describe("Configuration", () => {
    it("should use default configuration", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, DEFAULT_CLEANUP_CONFIG);

      expect(DEFAULT_CLEANUP_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CLEANUP_CONFIG.intervalMs).toBe(3600000); // 1 hour
      expect(DEFAULT_CLEANUP_CONFIG.retentionMs).toBe(2592000000); // 30 days
    });

    it("should accept custom configuration", () => {
      const customConfig = {
        enabled: false,
        intervalMs: 60000, // 1 minute
        retentionMs: 86400000, // 1 day
      };

      cleanup = new ExecutionLogsCleanup(logsStore, customConfig);

      // Verify config is used (test via behavior, not direct access)
      cleanup.start();
      expect(cleanup.isRunning()).toBe(false); // Should not start when disabled
    });
  });

  describe("start()", () => {
    it("should start the cleanup service", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      cleanup.start();

      expect(cleanup.isRunning()).toBe(true);
    });

    it("should not start when disabled", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: false,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      cleanup.start();

      expect(cleanup.isRunning()).toBe(false);
    });

    it("should not start duplicate intervals", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      cleanup.start();
      const firstRunning = cleanup.isRunning();

      cleanup.start(); // Try to start again
      const secondRunning = cleanup.isRunning();

      expect(firstRunning).toBe(true);
      expect(secondRunning).toBe(true);
      // Should still be running, but not have duplicate intervals
    });

    it("should run cleanup immediately on start", async () => {
      const runCleanupSpy = vi.spyOn(ExecutionLogsCleanup.prototype, "runCleanup");

      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 1000, // Very short retention for immediate cleanup
      });

      cleanup.start();

      // Wait a bit for the initial cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(runCleanupSpy).toHaveBeenCalled();
    });
  });

  describe("stop()", () => {
    it("should stop the cleanup service", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      cleanup.start();
      expect(cleanup.isRunning()).toBe(true);

      cleanup.stop();
      expect(cleanup.isRunning()).toBe(false);
    });

    it("should be safe to call when not running", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      // Call stop without starting
      expect(() => cleanup.stop()).not.toThrow();
      expect(cleanup.isRunning()).toBe(false);
    });

    it("should clear the interval", async () => {
      let cleanupCount = 0;
      const runCleanupSpy = vi
        .spyOn(ExecutionLogsCleanup.prototype, "runCleanup")
        .mockImplementation(async () => {
          cleanupCount++;
          return { deletedCount: 0, timestamp: new Date().toISOString() };
        });

      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 100, // Very short interval for testing
        retentionMs: 2592000000,
      });

      cleanup.start();
      await new Promise((resolve) => setTimeout(resolve, 250)); // Wait for 2+ intervals

      const countBeforeStop = cleanupCount;

      cleanup.stop();
      await new Promise((resolve) => setTimeout(resolve, 250)); // Wait to ensure no more runs

      // Cleanup count should not increase after stop
      expect(cleanupCount).toBe(countBeforeStop);

      runCleanupSpy.mockRestore();
    });
  });

  describe("runCleanup()", () => {
    it.skip("DEBUG: check test data setup", () => {
      // Debug: Check what's in the database
      const executions = db.prepare("SELECT id, status, completed_at FROM executions ORDER BY completed_at").all();
      const logs = db.prepare("SELECT execution_id FROM execution_logs").all();

      console.log("Executions:", executions);
      console.log("Logs:", logs);
      console.log("Now:", new Date().toISOString());
      const cutoff = new Date(Date.now() - 172800000).toISOString(); // 2 days ago
      console.log("2 days ago cutoff:", cutoff);

      // Test ISO string comparison
      const testComparison = db.prepare(`
        SELECT id, completed_at, (completed_at < ?) as is_older
        FROM executions
        ORDER BY completed_at
      `).all(cutoff);
      console.log("Comparison test:", testComparison);
    });

    it("should delete logs older than retention period", async () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 172800000, // 2 days
      });

      const result = await cleanup.runCleanup();

      // exec-week (7 days old) and exec-month (30 days old) should be deleted
      // Both are older than 2-day retention period
      expect(result.deletedCount).toBe(2);

      // Check what remains - should be exec-recent and exec-day
      const remaining = db.prepare("SELECT execution_id FROM execution_logs ORDER BY execution_id").all() as Array<{ execution_id: string }>;
      expect(remaining).toHaveLength(2);
      expect(remaining.map(r => r.execution_id)).toContain("exec-recent");
      expect(remaining.map(r => r.execution_id)).toContain("exec-day");
    });

    it("should delete all logs when retention is 0", async () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 0, // Delete everything
      });

      const result = await cleanup.runCleanup();

      // Should delete all 4 test logs
      expect(result.deletedCount).toBe(4);

      // Verify no logs remain
      const remaining = db.prepare("SELECT COUNT(*) as count FROM execution_logs").get() as any;
      expect(remaining.count).toBe(0);
    });

    it("should keep all logs when retention is very long", async () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 31536000000, // 1 year
      });

      const result = await cleanup.runCleanup();

      // Should delete nothing
      expect(result.deletedCount).toBe(0);

      // Verify all logs remain
      const remaining = db.prepare("SELECT COUNT(*) as count FROM execution_logs").get() as any;
      expect(remaining.count).toBe(4);
    });

    it("should return timestamp in result", async () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      const beforeRun = new Date();
      const result = await cleanup.runCleanup();
      const afterRun = new Date();

      expect(result.timestamp).toBeDefined();

      const resultTime = new Date(result.timestamp);
      expect(resultTime.getTime()).toBeGreaterThanOrEqual(beforeRun.getTime());
      expect(resultTime.getTime()).toBeLessThanOrEqual(afterRun.getTime());
    });

    it("should handle errors gracefully", async () => {
      // Create a spy that throws an error
      const pruneOldLogsSpy = vi
        .spyOn(logsStore, "pruneOldLogs")
        .mockImplementationOnce(() => {
          throw new Error("Database error");
        });

      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      // Should not throw, but return 0 deleted count
      const result = await cleanup.runCleanup();

      expect(result.deletedCount).toBe(0);
      expect(result.timestamp).toBeDefined();

      pruneOldLogsSpy.mockRestore();
    });
  });

  describe("isRunning()", () => {
    it("should return false initially", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, DEFAULT_CLEANUP_CONFIG);

      expect(cleanup.isRunning()).toBe(false);
    });

    it("should return true after start", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      cleanup.start();

      expect(cleanup.isRunning()).toBe(true);
    });

    it("should return false after stop", () => {
      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 3600000,
        retentionMs: 2592000000,
      });

      cleanup.start();
      cleanup.stop();

      expect(cleanup.isRunning()).toBe(false);
    });
  });

  describe("Periodic Execution", () => {
    it("should run cleanup periodically", async () => {
      let runCount = 0;
      const runCleanupSpy = vi
        .spyOn(ExecutionLogsCleanup.prototype, "runCleanup")
        .mockImplementation(async () => {
          runCount++;
          return { deletedCount: 0, timestamp: new Date().toISOString() };
        });

      cleanup = new ExecutionLogsCleanup(logsStore, {
        enabled: true,
        intervalMs: 100, // Very short interval for testing
        retentionMs: 2592000000,
      });

      cleanup.start();

      // Wait for multiple intervals
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Should have run at least 3 times (initial + 2-3 intervals)
      expect(runCount).toBeGreaterThanOrEqual(3);

      runCleanupSpy.mockRestore();
    });
  });
});
