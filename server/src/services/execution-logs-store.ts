/**
 * ExecutionLogsStore Service
 *
 * Manages persistence of raw execution logs to the database.
 * Provides CRUD operations for execution_logs table.
 *
 * @module services/execution-logs-store
 */

import type Database from "better-sqlite3";

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
      INSERT OR IGNORE INTO execution_logs (execution_id, raw_logs, byte_size, line_count)
      VALUES (?, '', 0, 0)
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
    // Calculate threshold timestamp
    const thresholdMs = Date.now() - olderThanMs;
    const thresholdSeconds = Math.floor(thresholdMs / 1000);

    const stmt = this.db.prepare(`
      DELETE FROM execution_logs
      WHERE execution_id IN (
        SELECT id FROM executions
        WHERE status IN ('completed', 'failed', 'cancelled', 'stopped')
        AND completed_at IS NOT NULL
        AND completed_at < datetime(?, 'unixepoch')
      )
    `);

    const result = stmt.run(thresholdSeconds);
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
}
