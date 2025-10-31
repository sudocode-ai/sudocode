/**
 * Execution Engine Interface
 *
 * Core abstraction for task execution engines. Provides methods for
 * submitting, controlling, monitoring, and waiting for task execution.
 *
 * @module execution/engine/engine
 */

import type {
  ExecutionTask,
  ExecutionResult,
  TaskStatus,
  EngineMetrics,
  TaskCompleteHandler,
  TaskFailedHandler,
} from './types.js';

/**
 * IExecutionEngine - Interface for task execution engines
 *
 * Defines the contract for engines that manage Claude Code agent execution.
 * Implementations may use different strategies (queue-based, pool-based, etc.)
 * but must provide these core capabilities.
 */
export interface IExecutionEngine {
  /**
   * Submit a single task for execution
   *
   * @param task - The task to execute
   * @returns Promise resolving to the task ID
   */
  submitTask(task: ExecutionTask): Promise<string>;

  /**
   * Submit multiple tasks for execution
   *
   * @param tasks - Array of tasks to execute
   * @returns Promise resolving to array of task IDs
   */
  submitTasks(tasks: ExecutionTask[]): Promise<string[]>;

  /**
   * Cancel a queued or running task
   *
   * For queued tasks, removes from queue without execution.
   * For running tasks, terminates the process.
   *
   * @param taskId - ID of task to cancel
   * @returns Promise that resolves when cancellation complete
   */
  cancelTask(taskId: string): Promise<void>;

  /**
   * Get current status of a task
   *
   * @param taskId - ID of task to query
   * @returns Current task status or null if task not found
   */
  getTaskStatus(taskId: string): TaskStatus | null;

  /**
   * Wait for a task to complete
   *
   * Returns immediately if task already completed, otherwise
   * waits for completion and returns result.
   *
   * @param taskId - ID of task to wait for
   * @returns Promise resolving to execution result
   * @throws Error if task fails
   */
  waitForTask(taskId: string): Promise<ExecutionResult>;

  /**
   * Wait for multiple tasks to complete
   *
   * @param taskIds - IDs of tasks to wait for
   * @returns Promise resolving to array of execution results
   * @throws Error if any task fails
   */
  waitForTasks(taskIds: string[]): Promise<ExecutionResult[]>;

  /**
   * Get current engine metrics
   *
   * Returns real-time statistics about engine performance
   * and resource utilization.
   *
   * @returns Current engine metrics (defensive copy)
   */
  getMetrics(): EngineMetrics;

  /**
   * Register handler for task completion events
   *
   * Called when any task completes successfully.
   *
   * @param handler - Callback function to invoke on completion
   */
  onTaskComplete(handler: TaskCompleteHandler): void;

  /**
   * Register handler for task failure events
   *
   * Called when any task fails after all retries exhausted.
   *
   * @param handler - Callback function to invoke on failure
   */
  onTaskFailed(handler: TaskFailedHandler): void;

  /**
   * Gracefully shutdown the engine
   *
   * Stops accepting new tasks, cancels queued tasks,
   * terminates running tasks, and releases all resources.
   *
   * @returns Promise that resolves when shutdown complete
   */
  shutdown(): Promise<void>;
}
