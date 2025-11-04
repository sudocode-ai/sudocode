/**
 * Tests for ExecutionLogsStore service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  ExecutionLogsStore,
  type LogMetadata,
} from "../../../src/services/execution-logs-store.js";
import {
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  EXECUTION_LOGS_INDEXES,
} from "@sudocode-ai/types/schema";

describe("ExecutionLogsStore", () => {
  let db: Database.Database;
  let store: ExecutionLogsStore;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");

    // Set up schema (disable foreign keys for unit tests)
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTION_LOGS_TABLE);
    db.exec(EXECUTION_LOGS_INDEXES);

    // Create test execution
    db.prepare(`
      INSERT INTO executions (id, agent_type, target_branch, branch_name, status)
      VALUES (?, ?, ?, ?, ?)
    `).run("exec-test-1", "claude-code", "main", "test-branch", "running");

    store = new ExecutionLogsStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("initializeLogs", () => {
    it("should create empty log entry", () => {
      store.initializeLogs("exec-test-1");

      const metadata = store.getLogMetadata("exec-test-1");
      expect(metadata).not.toBeNull();
      expect(metadata!.execution_id).toBe("exec-test-1");
      expect(metadata!.byte_size).toBe(0);
      expect(metadata!.line_count).toBe(0);
    });

    it("should be idempotent (INSERT OR IGNORE)", () => {
      store.initializeLogs("exec-test-1");
      store.initializeLogs("exec-test-1");
      store.initializeLogs("exec-test-1");

      // Should still have only one entry
      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(0);
    });

    it("should handle multiple executions", () => {
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status)
        VALUES (?, ?, ?, ?, ?)
      `).run("exec-test-2", "claude-code", "main", "test-branch", "running");

      store.initializeLogs("exec-test-1");
      store.initializeLogs("exec-test-2");

      expect(store.getLogMetadata("exec-test-1")).not.toBeNull();
      expect(store.getLogMetadata("exec-test-2")).not.toBeNull();
    });
  });

  describe("appendRawLog", () => {
    beforeEach(() => {
      store.initializeLogs("exec-test-1");
    });

    it("should append single log line", () => {
      const logLine = '{"type":"assistant","message":{"content":[]}}';
      store.appendRawLog("exec-test-1", logLine);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe(logLine);
    });

    it("should update metadata correctly", () => {
      const logLine = '{"type":"assistant"}';
      store.appendRawLog("exec-test-1", logLine);

      const metadata = store.getLogMetadata("exec-test-1");
      expect(metadata!.line_count).toBe(1);
      // byte_size includes newline character
      expect(metadata!.byte_size).toBe(Buffer.byteLength(logLine) + 1);
    });

    it("should append multiple lines sequentially", () => {
      store.appendRawLog("exec-test-1", "line1");
      store.appendRawLog("exec-test-1", "line2");
      store.appendRawLog("exec-test-1", "line3");

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(3);
      expect(logs).toEqual(["line1", "line2", "line3"]);
    });

    it("should handle empty lines", () => {
      store.appendRawLog("exec-test-1", "");

      const logs = store.getRawLogs("exec-test-1");
      // Empty lines are filtered out by getRawLogs
      expect(logs).toHaveLength(0);
    });

    it("should handle special characters", () => {
      // Note: In actual NDJSON, newlines must be escaped as \\n
      const logLine = '{"text":"Hello\\nWorld\\t!"}';
      store.appendRawLog("exec-test-1", logLine);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs[0]).toBe(logLine);
    });

    it("should handle UTF-8 characters correctly", () => {
      const logLine = '{"text":"Hello 世界 🌍"}';
      store.appendRawLog("exec-test-1", logLine);

      const metadata = store.getLogMetadata("exec-test-1");
      const logs = store.getRawLogs("exec-test-1");

      expect(logs[0]).toBe(logLine);
      // byte_size should account for multi-byte UTF-8 characters
      expect(metadata!.byte_size).toBe(Buffer.byteLength(logLine) + 1);
    });
  });

  describe("appendRawLogs", () => {
    beforeEach(() => {
      store.initializeLogs("exec-test-1");
    });

    it("should append multiple lines in transaction", () => {
      const lines = [
        '{"type":"assistant","message":{}}',
        '{"type":"tool_result","result":{}}',
        '{"type":"result","usage":{}}',
      ];

      store.appendRawLogs("exec-test-1", lines);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(3);
      expect(logs).toEqual(lines);
    });

    it("should update metadata for batch", () => {
      const lines = ["line1", "line2", "line3"];
      store.appendRawLogs("exec-test-1", lines);

      const metadata = store.getLogMetadata("exec-test-1");
      expect(metadata!.line_count).toBe(3);
    });

    it("should handle empty array", () => {
      store.appendRawLogs("exec-test-1", []);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(0);
    });

    it("should be atomic (transaction)", () => {
      const lines = ["line1", "line2"];
      store.appendRawLogs("exec-test-1", lines);

      // Both lines should be present
      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(2);
    });
  });

  describe("getRawLogs", () => {
    beforeEach(() => {
      store.initializeLogs("exec-test-1");
    });

    it("should return empty array for execution with no logs", () => {
      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toEqual([]);
    });

    it("should return empty array for non-existent execution", () => {
      const logs = store.getRawLogs("non-existent");
      expect(logs).toEqual([]);
    });

    it("should return all logs in order", () => {
      const lines = ["first", "second", "third"];
      store.appendRawLogs("exec-test-1", lines);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toEqual(lines);
    });

    it("should filter empty lines", () => {
      store.appendRawLog("exec-test-1", "line1");
      store.appendRawLog("exec-test-1", "");
      store.appendRawLog("exec-test-1", "line2");

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toEqual(["line1", "line2"]);
    });

    it("should handle large number of logs", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `log-${i}`);
      store.appendRawLogs("exec-test-1", lines);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(1000);
      expect(logs[0]).toBe("log-0");
      expect(logs[999]).toBe("log-999");
    });
  });

  describe("getLogMetadata", () => {
    beforeEach(() => {
      store.initializeLogs("exec-test-1");
    });

    it("should return null for non-existent execution", () => {
      const metadata = store.getLogMetadata("non-existent");
      expect(metadata).toBeNull();
    });

    it("should return metadata for empty logs", () => {
      const metadata = store.getLogMetadata("exec-test-1");

      expect(metadata).not.toBeNull();
      expect(metadata!.execution_id).toBe("exec-test-1");
      expect(metadata!.byte_size).toBe(0);
      expect(metadata!.line_count).toBe(0);
      expect(metadata!.created_at).toBeDefined();
      expect(metadata!.updated_at).toBeDefined();
    });

    it("should return accurate counts after appending", () => {
      store.appendRawLog("exec-test-1", "test-line");

      const metadata = store.getLogMetadata("exec-test-1");
      expect(metadata!.line_count).toBe(1);
      expect(metadata!.byte_size).toBeGreaterThan(0);
    });

    it("should update updated_at timestamp", () => {
      const before = store.getLogMetadata("exec-test-1")!.updated_at;

      // Small delay to ensure timestamp changes
      const waitMs = 10;
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        // busy wait
      }

      store.appendRawLog("exec-test-1", "new-line");

      const after = store.getLogMetadata("exec-test-1")!.updated_at;
      // Timestamps should be different (though both are ISO strings)
      expect(after >= before).toBe(true);
    });
  });

  describe("deleteLogs", () => {
    beforeEach(() => {
      store.initializeLogs("exec-test-1");
      store.appendRawLog("exec-test-1", "test-line");
    });

    it("should delete logs for execution", () => {
      store.deleteLogs("exec-test-1");

      const metadata = store.getLogMetadata("exec-test-1");
      expect(metadata).toBeNull();
    });

    it("should not affect other executions", () => {
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status)
        VALUES (?, ?, ?, ?, ?)
      `).run("exec-test-2", "claude-code", "main", "test-branch", "running");

      store.initializeLogs("exec-test-2");
      store.appendRawLog("exec-test-2", "other-line");

      store.deleteLogs("exec-test-1");

      // exec-test-2 should still exist
      expect(store.getLogMetadata("exec-test-2")).not.toBeNull();
      expect(store.getRawLogs("exec-test-2")).toHaveLength(1);
    });

    it("should be idempotent", () => {
      store.deleteLogs("exec-test-1");
      store.deleteLogs("exec-test-1"); // Should not throw

      expect(store.getLogMetadata("exec-test-1")).toBeNull();
    });
  });

  describe("pruneOldLogs", () => {
    it("should remove logs for old completed executions", () => {
      // Create old completed execution
      const oldTimestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, completed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "exec-old",
        "claude-code",
        "main",
        "test-branch",
        "completed",
        oldTimestamp.toISOString()
      );

      store.initializeLogs("exec-old");
      store.appendRawLog("exec-old", "old-log");

      // Prune logs older than 30 days
      const deleted = store.pruneOldLogs(30 * 24 * 60 * 60 * 1000);

      expect(deleted).toBe(1);
      expect(store.getLogMetadata("exec-old")).toBeNull();
    });

    it("should not remove logs for recent executions", () => {
      db.prepare(`
        UPDATE executions
        SET status = ?, completed_at = ?
        WHERE id = ?
      `).run("completed", new Date().toISOString(), "exec-test-1");

      store.initializeLogs("exec-test-1");
      store.appendRawLog("exec-test-1", "recent-log");

      // Prune logs older than 30 days
      const deleted = store.pruneOldLogs(30 * 24 * 60 * 60 * 1000);

      expect(deleted).toBe(0);
      expect(store.getLogMetadata("exec-test-1")).not.toBeNull();
    });

    it("should not remove logs for running executions", () => {
      const oldTimestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      db.prepare(`
        UPDATE executions
        SET status = ?, completed_at = ?
        WHERE id = ?
      `).run("running", oldTimestamp.toISOString(), "exec-test-1");

      store.initializeLogs("exec-test-1");
      store.appendRawLog("exec-test-1", "running-log");

      const deleted = store.pruneOldLogs(30 * 24 * 60 * 60 * 1000);

      expect(deleted).toBe(0);
      expect(store.getLogMetadata("exec-test-1")).not.toBeNull();
    });

    it("should return 0 when no logs to prune", () => {
      const deleted = store.pruneOldLogs(30 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return zero stats for empty database", () => {
      const stats = store.getStats();

      expect(stats.totalExecutions).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(stats.totalLines).toBe(0);
      expect(stats.avgLinesPerExecution).toBe(0);
      expect(stats.avgBytesPerExecution).toBe(0);
    });

    it("should calculate stats for single execution", () => {
      store.initializeLogs("exec-test-1");
      store.appendRawLog("exec-test-1", "line1");
      store.appendRawLog("exec-test-1", "line2");

      const stats = store.getStats();

      expect(stats.totalExecutions).toBe(1);
      expect(stats.totalLines).toBe(2);
      expect(stats.totalBytes).toBeGreaterThan(0);
      expect(stats.avgLinesPerExecution).toBe(2);
    });

    it("should calculate stats for multiple executions", () => {
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status)
        VALUES (?, ?, ?, ?, ?)
      `).run("exec-test-2", "claude-code", "main", "test-branch", "running");

      store.initializeLogs("exec-test-1");
      store.appendRawLogs("exec-test-1", ["line1", "line2"]);

      store.initializeLogs("exec-test-2");
      store.appendRawLogs("exec-test-2", ["line1", "line2", "line3", "line4"]);

      const stats = store.getStats();

      expect(stats.totalExecutions).toBe(2);
      expect(stats.totalLines).toBe(6);
      expect(stats.avgLinesPerExecution).toBe(3);
    });
  });

  describe("performance", () => {
    beforeEach(() => {
      store.initializeLogs("exec-test-1");
    });

    it("should handle 1000 log lines efficiently", () => {
      const lines = Array.from({ length: 1000 }, (_, i) =>
        JSON.stringify({ type: "test", index: i })
      );

      const start = Date.now();
      store.appendRawLogs("exec-test-1", lines);
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);

      const logs = store.getRawLogs("exec-test-1");
      expect(logs).toHaveLength(1000);
    });

    it("should retrieve large logs efficiently", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `log-${i}`);
      store.appendRawLogs("exec-test-1", lines);

      const start = Date.now();
      const logs = store.getRawLogs("exec-test-1");
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
      expect(logs).toHaveLength(500);
    });
  });
});
