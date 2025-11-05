/**
 * ExecutionLogsCleanup Service
 *
 * Automatic cleanup service to prune old execution logs and prevent unbounded database growth.
 * Runs periodically based on configuration and deletes logs older than the retention period.
 */

import type { ExecutionLogsStore } from './execution-logs-store.js';

/**
 * Configuration for the cleanup service
 */
export interface CleanupConfig {
  /** Enable/disable cleanup service */
  enabled: boolean;
  /** How often to run cleanup (milliseconds) */
  intervalMs: number;
  /** How long to keep logs (milliseconds) */
  retentionMs: number;
}

/**
 * Default cleanup configuration
 * - Enabled by default
 * - Runs every hour
 * - Retains logs for 30 days
 */
export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  enabled: true,
  intervalMs: 3600000, // 1 hour
  retentionMs: 2592000000, // 30 days
};

/**
 * Result from cleanup operation
 */
export interface CleanupResult {
  /** Number of execution logs deleted */
  deletedCount: number;
  /** Timestamp when cleanup ran */
  timestamp: string;
}

/**
 * ExecutionLogsCleanup Service
 *
 * Periodically prunes old execution logs from the database based on retention policy.
 * Runs in the background and logs cleanup operations.
 *
 * @example
 * ```typescript
 * const cleanup = new ExecutionLogsCleanup(logsStore, {
 *   enabled: true,
 *   intervalMs: 3600000,  // 1 hour
 *   retentionMs: 2592000000, // 30 days
 * });
 *
 * cleanup.start();
 *
 * // Later, on shutdown
 * cleanup.stop();
 * ```
 */
export class ExecutionLogsCleanup {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private logsStore: ExecutionLogsStore,
    private config: CleanupConfig
  ) {}

  /**
   * Start the periodic cleanup service
   *
   * Runs cleanup immediately on start, then periodically based on config.
   * Safe to call multiple times - will not start duplicate intervals.
   */
  start(): void {
    // Prevent duplicate starts
    if (this.running) {
      console.warn('[ExecutionLogsCleanup] Cleanup service already running');
      return;
    }

    // Check if disabled
    if (!this.config.enabled) {
      console.log('[ExecutionLogsCleanup] Cleanup service disabled by configuration');
      return;
    }

    // Calculate retention in days for logging
    const retentionDays = Math.round(this.config.retentionMs / (1000 * 60 * 60 * 24));
    console.log(
      `[ExecutionLogsCleanup] Starting cleanup service (retention: ${retentionDays} days, interval: ${this.config.intervalMs}ms)`
    );

    this.running = true;

    // Run cleanup immediately on start
    this.runCleanup().catch((err) => {
      console.error('[ExecutionLogsCleanup] Initial cleanup failed:', err);
    });

    // Schedule periodic cleanup
    this.intervalId = setInterval(() => {
      this.runCleanup().catch((err) => {
        console.error('[ExecutionLogsCleanup] Scheduled cleanup failed:', err);
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the periodic cleanup service
   *
   * Safe to call even if not running.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    console.log('[ExecutionLogsCleanup] Stopping cleanup service');

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.running = false;
  }

  /**
   * Check if cleanup service is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run cleanup operation immediately
   *
   * Deletes all execution logs older than the retention period.
   * Can be called manually for on-demand cleanup.
   *
   * @returns Cleanup result with deleted count and timestamp
   */
  async runCleanup(): Promise<CleanupResult> {
    const startTime = Date.now();

    try {
      console.log('[ExecutionLogsCleanup] Running cleanup...');

      // Prune old logs (passing retention period, not absolute cutoff)
      const deletedCount = this.logsStore.pruneOldLogs(this.config.retentionMs);

      // Calculate cutoff date for logging
      const cutoffMs = Date.now() - this.config.retentionMs;
      const cutoffDate = new Date(cutoffMs).toISOString();

      const duration = Date.now() - startTime;
      const retentionDays = Math.round(this.config.retentionMs / (1000 * 60 * 60 * 24));

      console.log(
        `[ExecutionLogsCleanup] Cleanup complete: deleted ${deletedCount} execution logs older than ${retentionDays} days (${cutoffDate}) in ${duration}ms`
      );

      return {
        deletedCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `[ExecutionLogsCleanup] Cleanup failed after ${duration}ms:`,
        error instanceof Error ? error.message : String(error)
      );

      // Don't throw - let the service continue on next interval
      return {
        deletedCount: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
