/**
 * ExecutionLogsStore Service
 *
 * Manages persistence of raw execution logs to the database.
 * Provides CRUD operations for execution_logs table.
 *
 * Supports two log formats:
 * - ACP (CoalescedSessionUpdate): Modern format stored in raw_logs column
 * - Legacy (NormalizedEntry): Legacy format stored in normalized_entry column
 *
 * @module services/execution-logs-store
 */

import type Database from "better-sqlite3";
import type { NormalizedEntry } from "agent-execution-engine/agents";
import type { CoalescedSessionUpdate } from "../execution/output/coalesced-types.js";
import {
  deserializeCoalescedUpdate,
  isCoalescedUpdate,
} from "../execution/output/coalesced-types.js";
import { convertNormalizedEntryToCoalesced } from "../execution/output/normalized-to-coalesced.js";

/**
 * Log format type for detection
 */
export type LogFormat = "acp" | "normalized_entry" | "empty";

/**
 * Metadata for execution logs (without the full logs text)
 */
export interface LogMetadata {
  execution_id: string;
  byte_size: number;
  line_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Statistics about all execution logs
 */
export interface LogStats {
  totalExecutions: number;
  totalBytes: number;
  totalLines: number;
  avgLinesPerExecution: number;
  avgBytesPerExecution: number;
}

/**
 * ExecutionLogsStore - Database service for execution logs
 *
 * Provides methods to store and retrieve raw agent output logs in NDJSON format.
 * All logs are stored as newline-delimited JSON strings for efficient append operations.
 *
 * @example
 * ```typescript
 * const store = new ExecutionLogsStore(db);
 * store.initializeLogs('exec-123');
 * store.appendRawLog('exec-123', '{"type":"assistant","message":{...}}');
 * const logs = store.getRawLogs('exec-123');
 * ```
 */
export class ExecutionLogsStore {
  constructor(private db: Database.Database) {}

  /**
   * Initialize empty log entry for a new execution
   *
   * Creates a new row in execution_logs with empty raw_logs.
   * Uses INSERT OR IGNORE so calling multiple times is safe.
   *
   * @param executionId - Unique execution identifier
   *
   * @example
   * ```typescript
   * store.initializeLogs('exec-123');
   * ```
   */
  initializeLogs(executionId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO execution_logs (execution_id, raw_logs, normalized_entry, byte_size, line_count)
      VALUES (?, '', NULL, 0, 0)
    `);
    stmt.run(executionId);
  }

  /**
   * Append a single log line to an execution
   *
   * Appends the line with a newline character and updates metadata.
   * Uses prepared statement for performance.
   *
   * @param executionId - Unique execution identifier
   * @param line - Raw log line (NDJSON format, no trailing newline)
   *
   * @example
   * ```typescript
   * store.appendRawLog('exec-123', '{"type":"assistant","message":{...}}');
   * ```
   */
  appendRawLog(executionId: string, line: string): void {
    const byteSize = Buffer.byteLength(line) + 1; // +1 for newline

    const stmt = this.db.prepare(`
      UPDATE execution_logs
      SET raw_logs = raw_logs || ? || char(10),
          byte_size = byte_size + ?,
          line_count = line_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE execution_id = ?
    `);

    stmt.run(line, byteSize, executionId);
  }

  /**
   * Append multiple log lines in a single transaction
   *
   * More efficient than calling appendRawLog multiple times.
   * Uses transaction for atomicity - all lines added or none.
   *
   * @param executionId - Unique execution identifier
   * @param lines - Array of raw log lines
   *
   * @example
   * ```typescript
   * store.appendRawLogs('exec-123', [
   *   '{"type":"assistant",...}',
   *   '{"type":"tool_result",...}'
   * ]);
   * ```
   */
  appendRawLogs(executionId: string, lines: string[]): void {
    const transaction = this.db.transaction((lines: string[]) => {
      for (const line of lines) {
        this.appendRawLog(executionId, line);
      }
    });

    transaction(lines);
  }

  /**
   * Retrieve all raw logs for an execution
   *
   * Returns logs as an array of individual log lines (NDJSON).
   * Empty lines are filtered out.
   *
   * @param executionId - Unique execution identifier
   * @returns Array of log lines, or empty array if execution not found
   *
   * @example
   * ```typescript
   * const logs = store.getRawLogs('exec-123');
   * logs.forEach(line => {
   *   const message = JSON.parse(line);
   *   console.log(message.type);
   * });
   * ```
   */
  getRawLogs(executionId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT raw_logs FROM execution_logs WHERE execution_id = ?
    `);

    const result = stmt.get(executionId) as { raw_logs: string } | undefined;

    if (!result) {
      return [];
    }

    // Split by newline and filter empty lines
    return result.raw_logs.split("\n").filter((line) => line.trim().length > 0);
  }

  /**
   * Get metadata for an execution without fetching full logs
   *
   * Useful for displaying log size/count without loading entire log content.
   *
   * @param executionId - Unique execution identifier
   * @returns Metadata object or null if execution not found
   *
   * @example
   * ```typescript
   * const metadata = store.getLogMetadata('exec-123');
   * if (metadata) {
   *   console.log(`${metadata.line_count} lines, ${metadata.byte_size} bytes`);
   * }
   * ```
   */
  getLogMetadata(executionId: string): LogMetadata | null {
    const stmt = this.db.prepare(`
      SELECT execution_id, byte_size, line_count, created_at, updated_at
      FROM execution_logs
      WHERE execution_id = ?
    `);

    return (stmt.get(executionId) as LogMetadata | undefined) || null;
  }

  /**
   * Delete logs for an execution
   *
   * Removes the entire log entry from the database.
   * Foreign key constraint ensures execution must exist.
   *
   * @param executionId - Unique execution identifier
   *
   * @example
   * ```typescript
   * store.deleteLogs('exec-123');
   * ```
   */
  deleteLogs(executionId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM execution_logs WHERE execution_id = ?
    `);
    stmt.run(executionId);
  }

  /**
   * Prune old execution logs based on age
   *
   * Deletes logs for completed/failed/cancelled executions older than threshold.
   * Only removes logs where the execution has reached a terminal state.
   *
   * @param olderThanMs - Age threshold in milliseconds
   * @returns Number of log entries deleted
   *
   * @example
   * ```typescript
   * // Delete logs older than 30 days
   * const deleted = store.pruneOldLogs(30 * 24 * 60 * 60 * 1000);
   * console.log(`Pruned ${deleted} old execution logs`);
   * ```
   */
  pruneOldLogs(olderThanMs: number): number {
    // Calculate threshold timestamp as ISO string
    const thresholdMs = Date.now() - olderThanMs;
    const thresholdDate = new Date(thresholdMs).toISOString();

    const stmt = this.db.prepare(`
      DELETE FROM execution_logs
      WHERE execution_id IN (
        SELECT id FROM executions
        WHERE status IN ('completed', 'failed', 'cancelled', 'stopped')
        AND completed_at IS NOT NULL
        AND completed_at < ?
      )
    `);

    const result = stmt.run(thresholdDate);
    return result.changes;
  }

  /**
   * Get aggregate statistics about all execution logs
   *
   * Provides overview of total storage usage and averages.
   *
   * @returns Statistics object with totals and averages
   *
   * @example
   * ```typescript
   * const stats = store.getStats();
   * console.log(`Total storage: ${stats.totalBytes} bytes`);
   * console.log(`Average: ${stats.avgLinesPerExecution} lines/execution`);
   * ```
   */
  getStats(): LogStats {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as totalExecutions,
        COALESCE(SUM(byte_size), 0) as totalBytes,
        COALESCE(SUM(line_count), 0) as totalLines
      FROM execution_logs
    `);

    const result = stmt.get() as {
      totalExecutions: number;
      totalBytes: number;
      totalLines: number;
    };

    return {
      totalExecutions: result.totalExecutions,
      totalBytes: result.totalBytes,
      totalLines: result.totalLines,
      avgLinesPerExecution:
        result.totalExecutions > 0
          ? result.totalLines / result.totalExecutions
          : 0,
      avgBytesPerExecution:
        result.totalExecutions > 0
          ? result.totalBytes / result.totalExecutions
          : 0,
    };
  }

  /**
   * Append a normalized entry to execution logs
   *
   * Stores a NormalizedEntry object from agent-execution-engine as JSON.
   * The entry is stored in the normalized_entry column alongside raw logs.
   *
   * @param executionId - Unique execution identifier
   * @param entry - Normalized entry object from agent-execution-engine
   *
   * @example
   * ```typescript
   * const entry: NormalizedEntry = {
   *   index: 0,
   *   type: { kind: 'assistant_message' },
   *   content: 'Hello world',
   *   timestamp: new Date(),
   * };
   * store.appendNormalizedEntry('exec-123', entry);
   * ```
   */
  appendNormalizedEntry(executionId: string, entry: NormalizedEntry): void {
    // Check if execution_logs entry exists
    const checkStmt = this.db.prepare(`
      SELECT 1 FROM execution_logs WHERE execution_id = ?
    `);
    const exists = checkStmt.get(executionId);

    const serialized = JSON.stringify(entry);

    if (!exists) {
      // First entry - create new row with NULL raw_logs
      const insertStmt = this.db.prepare(`
        INSERT INTO execution_logs (execution_id, raw_logs, normalized_entry, byte_size, line_count)
        VALUES (?, NULL, ?, 0, 0)
      `);
      insertStmt.run(executionId, serialized);
    } else {
      // Subsequent entries - append with newline
      const updateStmt = this.db.prepare(`
        UPDATE execution_logs
        SET normalized_entry = COALESCE(normalized_entry, '') || char(10) || ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE execution_id = ?
      `);
      updateStmt.run(serialized, executionId);
    }
  }

  /**
   * Get all normalized entries for an execution
   *
   * Retrieves and deserializes all normalized entries for an execution.
   * Entries are returned in the order they were stored.
   *
   * @param executionId - Unique execution identifier
   * @returns Array of normalized entries, or empty array if none found
   *
   * @example
   * ```typescript
   * const entries = store.getNormalizedEntries('exec-123');
   * entries.forEach(entry => {
   *   console.log(entry.type.kind, entry.content);
   * });
   * ```
   */
  getNormalizedEntries(executionId: string): NormalizedEntry[] {
    const stmt = this.db.prepare(`
      SELECT normalized_entry
      FROM execution_logs
      WHERE execution_id = ?
      AND normalized_entry IS NOT NULL
    `);

    const result = stmt.get(executionId) as
      | { normalized_entry: string }
      | undefined;

    if (!result || !result.normalized_entry) {
      return [];
    }

    // Split by newline and parse each JSON line
    const lines = result.normalized_entry
      .split("\n")
      .filter((line) => line.trim().length > 0);

    return lines.map((line) => {
      const entry = JSON.parse(line) as NormalizedEntry;

      // Restore timestamp as Date object if it exists
      if (entry.timestamp) {
        entry.timestamp = new Date(entry.timestamp);
      }

      return entry;
    });
  }

  /**
   * Check if execution has normalized entries
   *
   * Useful for determining which log format to use during migration period.
   *
   * @param executionId - Unique execution identifier
   * @returns true if execution has at least one normalized entry
   *
   * @example
   * ```typescript
   * if (store.hasNormalizedEntries('exec-123')) {
   *   const entries = store.getNormalizedEntries('exec-123');
   * } else {
   *   const logs = store.getRawLogs('exec-123');
   * }
   * ```
   */
  hasNormalizedEntries(executionId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1
      FROM execution_logs
      WHERE execution_id = ?
      AND normalized_entry IS NOT NULL
      AND normalized_entry != ''
    `);

    const result = stmt.get(executionId);
    return result !== undefined;
  }

  /**
   * Get entry count by kind for an execution
   *
   * Analyzes normalized entries and returns statistics about entry types.
   * Useful for analytics, debugging, and monitoring.
   *
   * @param executionId - Unique execution identifier
   * @returns Object mapping entry kinds to their counts
   *
   * @example
   * ```typescript
   * const stats = store.getEntryStats('exec-123');
   * console.log(stats);
   * // { assistant_message: 5, tool_use: 3, error: 1 }
   * ```
   */
  getEntryStats(executionId: string): Record<string, number> {
    const entries = this.getNormalizedEntries(executionId);
    const stats: Record<string, number> = {};

    for (const entry of entries) {
      const kind = entry.type.kind;
      stats[kind] = (stats[kind] || 0) + 1;
    }

    return stats;
  }

  // ============================================================================
  // Unified Log Access (ACP Migration)
  // ============================================================================

  /**
   * Detect the log format for an execution
   *
   * Checks which column has data and inspects the first line to determine format:
   * - 'acp': raw_logs contains CoalescedSessionUpdate (has 'sessionUpdate' key)
   * - 'normalized_entry': normalized_entry column has NormalizedEntry (has 'type.kind')
   * - 'empty': No logs found
   *
   * @param executionId - Unique execution identifier
   * @returns The detected log format
   *
   * @example
   * ```typescript
   * const format = store.detectLogFormat('exec-123');
   * if (format === 'acp') {
   *   const logs = store.getCoalescedLogs('exec-123');
   * }
   * ```
   */
  detectLogFormat(executionId: string): LogFormat {
    const stmt = this.db.prepare(`
      SELECT raw_logs, normalized_entry
      FROM execution_logs
      WHERE execution_id = ?
    `);

    const result = stmt.get(executionId) as
      | { raw_logs: string | null; normalized_entry: string | null }
      | undefined;

    if (!result) {
      return "empty";
    }

    // Check raw_logs first (ACP format)
    if (result.raw_logs && result.raw_logs.trim().length > 0) {
      const firstLine = result.raw_logs.split("\n")[0];
      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine);
          if ("sessionUpdate" in parsed) {
            return "acp";
          }
        } catch {
          // Not valid JSON, fall through
        }
      }
    }

    // Check normalized_entry (legacy format)
    if (result.normalized_entry && result.normalized_entry.trim().length > 0) {
      // Find first non-empty line (appendNormalizedEntry may prefix with newline)
      const lines = result.normalized_entry.split("\n");
      const firstLine = lines.find((line) => line.trim().length > 0);
      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine);
          if (parsed.type && "kind" in parsed.type) {
            return "normalized_entry";
          }
        } catch {
          // Not valid JSON, fall through
        }
      }
    }

    return "empty";
  }

  /**
   * Get logs as CoalescedSessionUpdate array (unified format)
   *
   * Automatically detects the storage format and converts to CoalescedSessionUpdate.
   * - For ACP logs: Deserializes directly from raw_logs
   * - For legacy logs: Converts NormalizedEntry to CoalescedSessionUpdate
   *
   * @param executionId - Unique execution identifier
   * @returns Array of CoalescedSessionUpdate events
   *
   * @example
   * ```typescript
   * const logs = store.getCoalescedLogs('exec-123');
   * logs.forEach(event => {
   *   console.log(event.sessionUpdate, event);
   * });
   * ```
   */
  getCoalescedLogs(executionId: string): CoalescedSessionUpdate[] {
    const format = this.detectLogFormat(executionId);

    switch (format) {
      case "acp":
        return this.getAcpLogs(executionId);

      case "normalized_entry":
        return this.convertLegacyLogs(executionId);

      case "empty":
      default:
        return [];
    }
  }

  /**
   * Get ACP logs directly from raw_logs column
   *
   * @private
   */
  private getAcpLogs(executionId: string): CoalescedSessionUpdate[] {
    const rawLogs = this.getRawLogs(executionId);
    const results: CoalescedSessionUpdate[] = [];

    for (const line of rawLogs) {
      try {
        const parsed = deserializeCoalescedUpdate(line);
        if (isCoalescedUpdate(parsed)) {
          results.push(parsed);
        }
      } catch (error) {
        console.warn(
          `[ExecutionLogsStore] Failed to parse ACP log line for ${executionId}:`,
          error
        );
      }
    }

    return results;
  }

  /**
   * Convert legacy NormalizedEntry logs to CoalescedSessionUpdate
   *
   * @private
   */
  private convertLegacyLogs(executionId: string): CoalescedSessionUpdate[] {
    const entries = this.getNormalizedEntries(executionId);
    const results: CoalescedSessionUpdate[] = [];

    for (const entry of entries) {
      const converted = convertNormalizedEntryToCoalesced(entry);
      if (converted) {
        results.push(converted);
      }
    }

    return results;
  }
}
