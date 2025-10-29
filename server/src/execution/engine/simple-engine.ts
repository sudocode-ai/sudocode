/**
 * Simple Execution Engine
 *
 * Queue-based execution engine that spawns a process per task
 * with concurrency limits. Implements the "simple first" approach.
 *
 * @module execution/engine/simple-engine
 */

import type { IExecutionEngine } from './engine.js';
import type {
  ExecutionTask,
  ExecutionResult,
  TaskStatus,
  EngineMetrics,
  TaskCompleteHandler,
  TaskFailedHandler,
  EngineConfig,
  RunningTask,
  TaskResolver,
} from './types.js';
import type { IProcessManager } from '../process/manager.js';
import { buildClaudeConfig } from '../process/builders/claude.js';
import type { ManagedProcess } from '../process/types.js';

/**
 * SimpleExecutionEngine - Queue-based task execution with concurrency control
 *
 * Key features:
 * - FIFO queue for task ordering
 * - Configurable concurrency limit (default: 3)
 * - Automatic retry on failure
 * - Event emission for task lifecycle
 * - Promise-based waiting
 * - Graceful shutdown
 */
export class SimpleExecutionEngine implements IExecutionEngine {
  // Task queue (FIFO)
  private taskQueue: ExecutionTask[] = [];

  // Running tasks tracking
  private runningTasks = new Map<string, RunningTask>();

  // Completed task results
  private completedResults = new Map<string, ExecutionResult>();

  // Promise resolvers for waiting
  private taskResolvers = new Map<string, TaskResolver>();

  // Engine metrics
  private metrics: EngineMetrics;

  // Event handlers
  private completeHandlers: TaskCompleteHandler[] = [];
  private failedHandlers: TaskFailedHandler[] = [];

  /**
   * Create a new SimpleExecutionEngine
   *
   * @param processManager - Process manager for spawning Claude processes
   * @param config - Engine configuration options
   */
  constructor(
    private _processManager: IProcessManager,
    private _config: EngineConfig = {}
  ) {
    // Initialize metrics
    this.metrics = {
      maxConcurrent: _config.maxConcurrent ?? 3,
      currentlyRunning: 0,
      availableSlots: _config.maxConcurrent ?? 3,
      queuedTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageDuration: 0,
      successRate: 1.0,
      throughput: 0,
      totalProcessesSpawned: 0,
      activeProcesses: 0,
    };
  }

  /**
   * Submit a single task for execution
   *
   * Adds task to queue and attempts to start execution if capacity available.
   *
   * @param task - The task to execute
   * @returns Promise resolving to the task ID
   */
  async submitTask(task: ExecutionTask): Promise<string> {
    // Add to queue
    this.taskQueue.push(task);
    this.metrics.queuedTasks++;

    // Try to start immediately if capacity available
    this.processQueue();

    return task.id;
  }

  /**
   * Submit multiple tasks for execution
   *
   * @param tasks - Array of tasks to execute
   * @returns Promise resolving to array of task IDs
   */
  async submitTasks(tasks: ExecutionTask[]): Promise<string[]> {
    const ids: string[] = [];

    for (const task of tasks) {
      const id = await this.submitTask(task);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Process the task queue
   *
   * Dequeues tasks and starts execution while capacity is available.
   * Checks dependencies before execution and re-queues if not met.
   *
   * @private
   */
  private processQueue(): void {
    // Track if we've made any progress in this pass
    let tasksProcessed = 0;
    const initialQueueSize = this.taskQueue.length;

    // Check if we have capacity and tasks to process
    while (
      this.taskQueue.length > 0 &&
      this.runningTasks.size < this.metrics.maxConcurrent &&
      tasksProcessed < initialQueueSize // Prevent infinite loop
    ) {
      const task = this.taskQueue.shift()!;
      this.metrics.queuedTasks--;
      tasksProcessed++;

      // Check if any dependency has failed
      if (this.hasFailedDependency(task)) {
        // Fail this task immediately - don't wait for failed dependencies
        this.handleTaskFailure(
          task.id,
          new Error(
            `Task ${task.id} failed: one or more dependencies failed`
          )
        );
        continue; // Process next task
      }

      // Check if all dependencies are met
      if (!this.areDependenciesMet(task)) {
        // Re-queue at end - dependencies not yet completed
        this.taskQueue.push(task);
        this.metrics.queuedTasks++;
        continue; // Try next task in queue
      }

      // Track task as running and update capacity
      this.trackTaskStart(task);

      // Start execution
      this.executeTask(task).catch((error) => {
        this.handleTaskFailure(task.id, error);
      });
    }
  }

  /**
   * Check if all task dependencies are met
   *
   * @param task - Task to check
   * @returns True if all dependencies completed successfully
   * @private
   */
  private areDependenciesMet(task: ExecutionTask): boolean {
    // No dependencies means dependencies are met
    if (task.dependencies.length === 0) {
      return true;
    }

    // Check each dependency
    for (const depId of task.dependencies) {
      const result = this.completedResults.get(depId);

      // Dependency not completed yet
      if (!result) {
        return false;
      }

      // Dependency completed but failed
      if (!result.success) {
        return false;
      }
    }

    // All dependencies completed successfully
    return true;
  }

  /**
   * Check if any task dependency has failed
   *
   * @param task - Task to check
   * @returns True if any dependency failed
   * @private
   */
  private hasFailedDependency(task: ExecutionTask): boolean {
    for (const depId of task.dependencies) {
      const result = this.completedResults.get(depId);

      // If dependency completed but failed, return true
      if (result && !result.success) {
        return true;
      }
    }

    return false;
  }

  /**
   * Track task as running and update capacity metrics
   *
   * @param task - Task to start tracking
   * @private
   */
  private trackTaskStart(task: ExecutionTask): void {
    // Get attempt from metadata if this is a retry
    const attempt = (task.metadata?._retryAttempt as number) || 1;

    // Add to running tasks
    const runningTask: RunningTask = {
      task,
      process: null as any, // Will be set in ISSUE-053 when we spawn process
      startedAt: new Date(),
      attempt,
    };
    this.runningTasks.set(task.id, runningTask);

    // Update metrics
    this.metrics.currentlyRunning = this.runningTasks.size;
    this.metrics.availableSlots = this.metrics.maxConcurrent - this.runningTasks.size;
  }

  /**
   * Track task completion and release capacity
   *
   * @param taskId - ID of completed task
   * @private
   */
  private trackTaskComplete(taskId: string): void {
    // Remove from running tasks
    this.runningTasks.delete(taskId);

    // Update metrics
    this.metrics.currentlyRunning = this.runningTasks.size;
    this.metrics.availableSlots = this.metrics.maxConcurrent - this.runningTasks.size;

    // Try to process more tasks now that capacity is available
    this.processQueue();
  }

  /**
   * Execute a task
   *
   * Acquires a process, sends the prompt, collects output, and builds the result.
   *
   * @param task - Task to execute
   * @private
   */
  private async executeTask(task: ExecutionTask): Promise<void> {
    const startTime = new Date();
    let managedProcess: ManagedProcess | null = null;
    let output = '';
    let errorOutput = '';

    try {
      // Build process configuration
      const processConfig = buildClaudeConfig({
        claudePath: this._config.claudePath,
        workDir: task.workDir,
        print: true,
        outputFormat: 'stream-json',
        dangerouslySkipPermissions: true,
        env: task.config.env,
        timeout: task.config.timeout,
      });

      // Acquire process from manager
      managedProcess = await this._processManager.acquireProcess(processConfig);

      // Update running task with process reference
      const runningTask = this.runningTasks.get(task.id);
      if (runningTask) {
        runningTask.process = managedProcess;
      }

      // Set up output collection
      this._processManager.onOutput(managedProcess.id, (data, type) => {
        if (type === 'stdout') {
          output += data.toString();
        } else {
          errorOutput += data.toString();
        }
      });

      // Set up error handler
      this._processManager.onError(managedProcess.id, (error) => {
        errorOutput += `Process error: ${error.message}\n`;
      });

      // Send the prompt to the process
      await this._processManager.sendInput(managedProcess.id, task.prompt);

      // Wait for process to complete
      await this.waitForProcessExit(managedProcess, task.config.timeout);

      // Build execution result
      const endTime = new Date();
      const result: ExecutionResult = {
        taskId: task.id,
        executionId: managedProcess.id,
        success: managedProcess.exitCode === 0,
        exitCode: managedProcess.exitCode ?? -1,
        output,
        error: errorOutput || undefined,
        startedAt: startTime,
        completedAt: endTime,
        duration: endTime.getTime() - startTime.getTime(),
        metadata: this.parseMetadata(output),
      };

      // Store result
      this.completedResults.set(task.id, result);

      // Update metrics
      this.metrics.completedTasks++;

      // Resolve promise for waiters
      const resolver = this.taskResolvers.get(task.id);
      if (resolver) {
        resolver.resolve(result);
        this.taskResolvers.delete(task.id);
      }

      // Emit completion event
      for (const handler of this.completeHandlers) {
        handler(result);
      }

      // Release capacity
      this.trackTaskComplete(task.id);
    } catch (error) {
      // Handle execution failure
      this.handleTaskFailure(task.id, error as Error);
    } finally {
      // Clean up process
      if (managedProcess) {
        try {
          await this._processManager.releaseProcess(managedProcess.id);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Wait for a process to exit
   *
   * @param process - The managed process to wait for
   * @param timeoutMs - Optional timeout in milliseconds
   * @private
   */
  private async waitForProcessExit(
    process: ManagedProcess,
    timeoutMs?: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Check if already exited
      if (process.exitCode !== null) {
        resolve();
        return;
      }

      // Set up exit listener
      const checkInterval = setInterval(() => {
        if (process.exitCode !== null) {
          clearInterval(checkInterval);
          if (process.status === 'crashed') {
            reject(new Error(`Process crashed with exit code ${process.exitCode}`));
          } else {
            resolve();
          }
        }
      }, 10); // Poll every 10ms for responsive detection

      // Set timeout if configured
      if (timeoutMs) {
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('Process execution timeout'));
        }, timeoutMs);
      }
    });
  }

  /**
   * Parse metadata from stream-json output
   *
   * Extracts tools used, files changed, tokens, etc. from the output.
   *
   * @param output - Raw output from Claude Code
   * @returns Parsed metadata
   * @private
   */
  private parseMetadata(_output: string): ExecutionResult['metadata'] {
    // Stub for now - will enhance in future issues
    // TODO: Parse stream-json output for metadata
    return {
      toolsUsed: [],
      filesChanged: [],
      tokensUsed: 0,
      cost: 0,
    };
  }

  /**
   * Handle task failure
   *
   * Implements automatic retry logic if maxRetries is configured.
   * Re-queues failed tasks at front of queue for priority retry.
   *
   * @param taskId - ID of failed task
   * @param error - Error that occurred
   * @private
   */
  private handleTaskFailure(_taskId: string, _error: Error): void {
    // Get running task to check retry eligibility
    const runningTask = this.runningTasks.get(_taskId);

    if (runningTask) {
      const task = runningTask.task;
      const maxRetries = task.config.maxRetries;
      const currentAttempt = runningTask.attempt;

      // Check if we should retry
      if (maxRetries !== undefined && currentAttempt <= maxRetries) {
        // Create retry task with incremented attempt
        const retryTask: ExecutionTask = {
          ...task,
          metadata: {
            ...task.metadata,
            _retryAttempt: currentAttempt + 1,
          },
        };

        // Re-queue at front for priority retry
        this.taskQueue.unshift(retryTask);
        this.metrics.queuedTasks++;

        // Release capacity so retry can start
        this.trackTaskComplete(_taskId);

        // Don't emit failure or store result yet - will retry
        // Note: Don't call processQueue() here, it will be called by trackTaskComplete
        return;
      }
    }

    // No retries left or maxRetries not configured - proceed with final failure

    // Create a failed execution result
    const now = new Date();
    const failedResult: ExecutionResult = {
      taskId: _taskId,
      executionId: `failed-${_taskId}`,
      success: false,
      exitCode: -1,
      output: '',
      error: _error.message,
      startedAt: now,
      completedAt: now,
      duration: 0,
      metadata: {
        toolsUsed: [],
        filesChanged: [],
        tokensUsed: 0,
        cost: 0,
      },
    };

    // Store the failed result so dependent tasks can check it
    this.completedResults.set(_taskId, failedResult);

    // Update metrics
    this.metrics.failedTasks++;

    // Release capacity
    this.trackTaskComplete(_taskId);

    // Resolve promise with error
    const resolver = this.taskResolvers.get(_taskId);
    if (resolver) {
      resolver.reject(_error);
      this.taskResolvers.delete(_taskId);
    }

    // Emit event
    for (const handler of this.failedHandlers) {
      handler(_taskId, _error);
    }
  }

  /**
   * Cancel a queued or running task
   *
   * Stub for now - will implement in ISSUE-059
   */
  async cancelTask(_taskId: string): Promise<void> {
    // TODO: Implement in ISSUE-059
    throw new Error('cancelTask not yet implemented');
  }

  /**
   * Get current status of a task
   *
   * Stub for now - will implement in ISSUE-057
   */
  getTaskStatus(taskId: string): TaskStatus | null {
    // TODO: Implement in ISSUE-057
    // Check completed
    const result = this.completedResults.get(taskId);
    if (result) {
      return { state: 'completed', result };
    }

    // Check running
    const running = this.runningTasks.get(taskId);
    if (running) {
      return {
        state: 'running',
        processId: running.process.id,
        startedAt: running.startedAt,
      };
    }

    // Check queued
    const queuePos = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queuePos >= 0) {
      return { state: 'queued', position: queuePos };
    }

    return null;
  }

  /**
   * Wait for a task to complete
   *
   * Stub for now - will implement in ISSUE-060
   */
  async waitForTask(taskId: string): Promise<ExecutionResult> {
    // TODO: Implement in ISSUE-060
    // Check if already completed
    const existing = this.completedResults.get(taskId);
    if (existing) return existing;

    // Wait for completion
    return new Promise((resolve, reject) => {
      this.taskResolvers.set(taskId, { resolve, reject });
    });
  }

  /**
   * Wait for multiple tasks to complete
   *
   * Stub for now - will implement in ISSUE-060
   */
  async waitForTasks(taskIds: string[]): Promise<ExecutionResult[]> {
    // TODO: Implement in ISSUE-060
    return Promise.all(taskIds.map((id) => this.waitForTask(id)));
  }

  /**
   * Get current engine metrics
   *
   * Returns defensive copy of current metrics.
   *
   * @returns Current engine metrics
   */
  getMetrics(): EngineMetrics {
    // Return defensive copy
    return { ...this.metrics };
  }

  /**
   * Register handler for task completion events
   */
  onTaskComplete(handler: TaskCompleteHandler): void {
    this.completeHandlers.push(handler);
  }

  /**
   * Register handler for task failure events
   */
  onTaskFailed(handler: TaskFailedHandler): void {
    this.failedHandlers.push(handler);
  }

  /**
   * Gracefully shutdown the engine
   *
   * Stub for now - will implement in ISSUE-061
   */
  async shutdown(): Promise<void> {
    // TODO: Implement in ISSUE-061
    throw new Error('shutdown not yet implemented');
  }
}
