/**
 * Unit Tests for ExecutionLogsStore - Normalized Entries
 *
 * Tests the new normalized entry storage methods added for Phase 1
 * of the direct execution pattern migration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";
import type { NormalizedEntry } from "agent-execution-engine/agents";

describe("ExecutionLogsStore - Normalized Entries", () => {
  let db: Database.Database;
  let store: ExecutionLogsStore;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");

    // Create execution_logs table with new nullable schema
    db.exec(`
      CREATE TABLE execution_logs (
        execution_id TEXT PRIMARY KEY,
        raw_logs TEXT,
        normalized_entry TEXT,
        byte_size INTEGER NOT NULL DEFAULT 0,
        line_count INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (raw_logs IS NOT NULL OR normalized_entry IS NOT NULL)
      )
    `);

    store = new ExecutionLogsStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("appendNormalizedEntry", () => {
    it("should append and retrieve a normalized entry", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Hello world",
        timestamp: new Date("2025-01-01T00:00:00Z"),
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].index).toBe(0);
      expect(entries[0].type.kind).toBe("assistant_message");
      expect(entries[0].content).toBe("Hello world");
      expect(entries[0].timestamp).toEqual(new Date("2025-01-01T00:00:00Z"));
    });

    it("should append multiple entries in sequence", () => {
      const entries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "Message 1",
          timestamp: new Date("2025-01-01T00:00:00Z"),
        },
        {
          index: 1,
          type: { kind: "assistant_message" },
          content: "Message 2",
          timestamp: new Date("2025-01-01T00:00:01Z"),
        },
        {
          index: 2,
          type: { kind: "assistant_message" },
          content: "Message 3",
          timestamp: new Date("2025-01-01T00:00:02Z"),
        },
      ];

      entries.forEach((e) => store.appendNormalizedEntry("exec-1", e));

      const retrieved = store.getNormalizedEntries("exec-1");
      expect(retrieved).toHaveLength(3);
      expect(retrieved[0].content).toBe("Message 1");
      expect(retrieved[1].content).toBe("Message 2");
      expect(retrieved[2].content).toBe("Message 3");
    });

    it("should handle entries with missing timestamps", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "No timestamp",
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("No timestamp");
    });

    it("should serialize complex entry types correctly", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "ls -la" },
            status: "success",
            result: {
              success: true,
              data: "total 0\ndrwxr-xr-x  2 user user 4096 Jan  1 00:00 .",
            },
          },
        },
        content: "",
        timestamp: new Date("2025-01-01T00:00:00Z"),
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].type.kind).toBe("tool_use");
      if (entries[0].type.kind === "tool_use") {
        expect(entries[0].type.tool.toolName).toBe("Bash");
        expect(entries[0].type.tool.status).toBe("success");
      }
    });
  });

  describe("getNormalizedEntries", () => {
    it("should return empty array for execution with no entries", () => {
      const entries = store.getNormalizedEntries("non-existent");
      expect(entries).toEqual([]);
    });

    it("should preserve entry order", () => {
      const entries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "First",
          timestamp: new Date(),
        },
        {
          index: 1,
          type: { kind: "assistant_message" },
          content: "Second",
          timestamp: new Date(),
        },
        {
          index: 2,
          type: { kind: "assistant_message" },
          content: "Third",
          timestamp: new Date(),
        },
      ];

      entries.forEach((e) => store.appendNormalizedEntry("exec-1", e));

      const retrieved = store.getNormalizedEntries("exec-1");
      expect(retrieved[0].content).toBe("First");
      expect(retrieved[1].content).toBe("Second");
      expect(retrieved[2].content).toBe("Third");
    });

    it("should handle all entry type variants", () => {
      const entries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "Message",
          timestamp: new Date(),
        },
        {
          index: 1,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Bash",
              action: { kind: "command_run", command: "echo test" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 2,
          type: {
            kind: "thinking",
            reasoning: "Let me analyze...",
          },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 3,
          type: {
            kind: "error",
            error: { message: "Test error", code: "E001" },
          },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 4,
          type: { kind: "system_message" },
          content: "System initialized",
          timestamp: new Date(),
        },
        {
          index: 5,
          type: { kind: "user_message" },
          content: "User input",
          timestamp: new Date(),
        },
      ];

      entries.forEach((e) => store.appendNormalizedEntry("exec-1", e));

      const retrieved = store.getNormalizedEntries("exec-1");
      expect(retrieved).toHaveLength(6);
      expect(retrieved[0].type.kind).toBe("assistant_message");
      expect(retrieved[1].type.kind).toBe("tool_use");
      expect(retrieved[2].type.kind).toBe("thinking");
      expect(retrieved[3].type.kind).toBe("error");
      expect(retrieved[4].type.kind).toBe("system_message");
      expect(retrieved[5].type.kind).toBe("user_message");
    });

    it("should restore Date objects from timestamps", () => {
      const timestamp = new Date("2025-01-01T12:00:00Z");
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Test",
        timestamp,
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries[0].timestamp).toBeInstanceOf(Date);
      expect(entries[0].timestamp).toEqual(timestamp);
    });
  });

  describe("hasNormalizedEntries", () => {
    it("should return false for execution with no entries", () => {
      expect(store.hasNormalizedEntries("exec-1")).toBe(false);
    });

    it("should return true after appending an entry", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Test",
        timestamp: new Date(),
      };

      store.appendNormalizedEntry("exec-1", entry);

      expect(store.hasNormalizedEntries("exec-1")).toBe(true);
    });

    it("should return false for execution with only raw logs", () => {
      // Insert raw logs without normalized entries
      db.prepare(`
        INSERT INTO execution_logs (execution_id, raw_logs, byte_size, line_count)
        VALUES (?, ?, ?, ?)
      `).run("exec-1", '{"type":"test"}', 14, 1);

      expect(store.hasNormalizedEntries("exec-1")).toBe(false);
    });
  });

  describe("getEntryStats", () => {
    it("should return empty stats for execution with no entries", () => {
      const stats = store.getEntryStats("exec-1");
      expect(stats).toEqual({});
    });

    it("should count entries by kind", () => {
      const entries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 1,
          type: { kind: "assistant_message" },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 2,
          type: { kind: "assistant_message" },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 3,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Bash",
              action: { kind: "command_run", command: "ls" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 4,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Read",
              action: { kind: "file_read", path: "/test.ts" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 5,
          type: {
            kind: "error",
            error: { message: "Test error" },
          },
          content: "",
          timestamp: new Date(),
        },
      ];

      entries.forEach((e) => store.appendNormalizedEntry("exec-1", e));

      const stats = store.getEntryStats("exec-1");
      expect(stats).toEqual({
        assistant_message: 3,
        tool_use: 2,
        error: 1,
      });
    });

    it("should handle all entry kinds", () => {
      const entries: NormalizedEntry[] = [
        { index: 0, type: { kind: "assistant_message" }, content: "", timestamp: new Date() },
        { index: 1, type: { kind: "tool_use", tool: {} as any }, content: "", timestamp: new Date() },
        { index: 2, type: { kind: "thinking" }, content: "", timestamp: new Date() },
        { index: 3, type: { kind: "error", error: { message: "" } }, content: "", timestamp: new Date() },
        { index: 4, type: { kind: "system_message" }, content: "", timestamp: new Date() },
        { index: 5, type: { kind: "user_message" }, content: "", timestamp: new Date() },
      ];

      entries.forEach((e) => store.appendNormalizedEntry("exec-1", e));

      const stats = store.getEntryStats("exec-1");
      expect(stats).toEqual({
        assistant_message: 1,
        tool_use: 1,
        thinking: 1,
        error: 1,
        system_message: 1,
        user_message: 1,
      });
    });
  });

  describe("Backward Compatibility", () => {
    it("should not break existing raw log methods", () => {
      // Initialize logs the old way
      store.initializeLogs("exec-1");
      store.appendRawLog("exec-1", '{"type":"assistant"}');
      store.appendRawLog("exec-1", '{"type":"tool_result"}');

      // Verify raw logs still work
      const rawLogs = store.getRawLogs("exec-1");
      expect(rawLogs).toHaveLength(2);
      expect(rawLogs[0]).toBe('{"type":"assistant"}');
      expect(rawLogs[1]).toBe('{"type":"tool_result"}');

      // Verify metadata still works
      const metadata = store.getLogMetadata("exec-1");
      expect(metadata).not.toBeNull();
      expect(metadata!.line_count).toBe(2);
    });

    it("should support both raw and normalized logs for same execution", () => {
      // Add raw logs
      store.initializeLogs("exec-1");
      store.appendRawLog("exec-1", '{"type":"assistant"}');

      // Add normalized entries
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Test",
        timestamp: new Date(),
      };
      store.appendNormalizedEntry("exec-1", entry);

      // Both should be retrievable
      const rawLogs = store.getRawLogs("exec-1");
      expect(rawLogs).toHaveLength(1);

      const normalized = store.getNormalizedEntries("exec-1");
      expect(normalized).toHaveLength(1);

      expect(store.hasNormalizedEntries("exec-1")).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty content", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "",
        timestamp: new Date(),
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("");
    });

    it("should handle special characters in content", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: 'Special chars: "\n\t\r\\ and unicode: 🎉',
        timestamp: new Date(),
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries[0].content).toBe('Special chars: "\n\t\r\\ and unicode: 🎉');
    });

    it("should handle large entries", () => {
      const largeContent = "x".repeat(10000);
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: largeContent,
        timestamp: new Date(),
      };

      store.appendNormalizedEntry("exec-1", entry);

      const entries = store.getNormalizedEntries("exec-1");
      expect(entries[0].content).toBe(largeContent);
    });
  });
});
