/**
 * Process Layer Types
 *
 * Core types and interfaces for the Process Layer (Layer 1) of the execution system.
 * Defines generic types for managing any CLI tool/agent process lifecycle.
 *
 * @module execution/process/types
 */

import type { ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';

/**
 * Status of a managed process throughout its lifecycle
 */
export type ProcessStatus =
  | 'spawning'     // Being created
  | 'idle'         // Ready for work (pool only)
  | 'busy'         // Executing task
  | 'terminating'  // Shutting down
  | 'crashed'      // Exited unexpectedly
  | 'completed';   // Exited normally

/**
 * Configuration for spawning a new process
 * Generic interface that works with any CLI tool/agent
 */
export interface ProcessConfig {
  /** Path to the executable (e.g., 'claude', 'codex', 'node') */
  executablePath: string;

  /** Command-line arguments to pass to the executable */
  args: string[];

  /** Working directory for the process */
  workDir: string;

  /** Environment variables to pass to the process */
  env?: Record<string, string>;

  /** Maximum execution time in milliseconds */
  timeout?: number;

  /** Maximum idle time before cleanup (pool only) */
  idleTimeout?: number;

  /** Retry configuration for failed spawns */
  retry?: {
    /** Maximum number of retry attempts */
    maxAttempts: number;
    /** Initial backoff delay in milliseconds */
    backoffMs: number;
  };
}

/**
 * Represents a single managed process instance with its lifecycle state
 * Can be any CLI tool/agent (Claude Code, Codex, Gemini CLI, etc.)
 */
export interface ManagedProcess {
  // Identity
  /** Unique process identifier */
  id: string;
  /** Operating system process ID */
  pid: number;

  // Lifecycle
  /** Current status of the process */
  status: ProcessStatus;
  /** When the process was spawned */
  spawnedAt: Date;
  /** Last I/O activity timestamp */
  lastActivity: Date;
  /** Exit code if process has exited */
  exitCode: number | null;
  /** Signal that terminated the process if applicable */
  signal: string | null;

  // Resources
  /** Node.js ChildProcess handle */
  process: ChildProcess;
  /** Process I/O streams */
  streams: {
    stdout: Readable;
    stderr: Readable;
    stdin: Writable;
  };

  // Metrics
  /** Process execution metrics */
  metrics: {
    /** Total duration in milliseconds */
    totalDuration: number;
    /** Number of tasks completed */
    tasksCompleted: number;
    /** Success rate (0-1) */
    successRate: number;
  };
}

/**
 * Handler for process output (stdout/stderr)
 *
 * @param data - Output data buffer
 * @param type - Stream type
 */
export type OutputHandler = (data: Buffer, type: 'stdout' | 'stderr') => void;

/**
 * Handler for process errors
 *
 * @param error - Error that occurred
 */
export type ErrorHandler = (error: Error) => void;

/**
 * Aggregate metrics for all processes managed by a ProcessManager
 */
export interface ProcessMetrics {
  /** Total number of processes spawned */
  totalSpawned: number;
  /** Number of currently active processes */
  currentlyActive: number;
  /** Total number of successfully completed processes */
  totalCompleted: number;
  /** Total number of failed processes */
  totalFailed: number;
  /** Average process duration in milliseconds */
  averageDuration: number;
}
