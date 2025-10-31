/**
 * Engine Layer Types
 *
 * Core types for the Execution Engine (Layer 2) that manages
 * task queueing, concurrency, and multi-agent execution.
 *
 * @module execution/engine/types
 */

/**
 * ExecutionTask - Represents a unit of work to be executed by a Claude Code agent
 */
export interface ExecutionTask {
  // Identity
  id: string;
  type: 'issue' | 'spec' | 'custom';
  entityId?: string; // Issue/spec ID if applicable

  // Execution context
  prompt: string; // What to send to Claude
  workDir: string; // Where to execute

  // Scheduling
  priority: number; // 0 = highest
  dependencies: string[]; // Task IDs that must complete first
  createdAt: Date;

  // Configuration
  config: {
    timeout?: number; // Max duration (ms)
    maxRetries?: number; // Retry attempts
    env?: Record<string, string>; // Environment variables
  };

  // Metadata
  metadata?: Record<string, any>; // Custom data
}

/**
 * ExecutionResult - The outcome of executing a task
 */
export interface ExecutionResult {
  // Identity
  taskId: string;
  executionId: string; // Process ID that ran it

  // Outcome
  success: boolean;
  exitCode: number;

  // Output
  output: string; // stdout
  error?: string; // stderr or error message

  // Timing
  startedAt: Date;
  completedAt: Date;
  duration: number; // milliseconds

  // Parsed data (from stream-json)
  metadata?: {
    toolsUsed?: string[];
    filesChanged?: string[];
    tokensUsed?: number;
    cost?: number;
  };
}

/**
 * EngineMetrics - Real-time engine performance statistics
 */
export interface EngineMetrics {
  // Capacity
  maxConcurrent: number;
  currentlyRunning: number;
  availableSlots: number;

  // Queue
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;

  // Performance
  averageDuration: number; // ms
  successRate: number; // 0-1
  throughput: number; // tasks/minute

  // Resources
  totalProcessesSpawned: number;
  activeProcesses: number;
}

/**
 * TaskStatus - Discriminated union for task state tracking
 */
export type TaskStatus =
  | { state: 'queued'; position: number }
  | { state: 'running'; processId: string; startedAt: Date }
  | { state: 'completed'; result: ExecutionResult }
  | { state: 'failed'; error: string }
  | { state: 'cancelled'; cancelledAt: Date };

/**
 * TaskCompleteHandler - Callback for task completion events
 */
export type TaskCompleteHandler = (result: ExecutionResult) => void;

/**
 * TaskFailedHandler - Callback for task failure events
 */
export type TaskFailedHandler = (taskId: string, error: Error) => void;

/**
 * EngineConfig - Configuration options for execution engines
 */
export interface EngineConfig {
  maxConcurrent?: number; // Maximum concurrent processes (default: 3)
  claudePath?: string; // Path to Claude executable (default: 'claude')
}

/**
 * RunningTask - Internal tracking for currently executing tasks
 */
export interface RunningTask {
  task: ExecutionTask;
  process: any; // ManagedProcess from process layer
  startedAt: Date;
  attempt: number; // Current retry attempt (1-indexed)
}

/**
 * TaskResolver - Promise resolver for async task waiting
 */
export interface TaskResolver {
  resolve: (result: ExecutionResult) => void;
  reject: (error: Error) => void;
}
