/**
 * DirectRunnerAdapter - Wraps IAgentExecutor for integration with execution service
 *
 * Part of Phase 1 - Direct Runner Pattern Migration.
 * Handles task execution, output streaming, event transformation, and log persistence.
 *
 * @module execution/adapters/direct-runner-adapter
 */

import type {
  IAgentExecutor,
  AgentCapabilities,
  NormalizedEntry,
} from "agent-execution-engine/agents";
import type { ExecutionTask } from "agent-execution-engine/engine";
import type { AgUiEventAdapter } from "../output/ag-ui-adapter.js";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import { normalizedEntryToAgUiEvents } from "../output/normalized-to-ag-ui.js";

/**
 * DirectRunnerAdapter - Wraps IAgentExecutor for integration with execution service
 *
 * Responsibilities:
 * - Execute tasks via agent executor
 * - Stream and normalize agent output
 * - Transform normalized entries to AG-UI events
 * - Emit events through AG-UI adapter
 * - Persist normalized logs to database
 * - Handle errors gracefully without crashing execution
 *
 * @example
 * ```typescript
 * const executor = new ClaudeCodeExecutor();
 * const adapter = new DirectRunnerAdapter(
 *   executor,
 *   agUiAdapter,
 *   logsStore
 * );
 *
 * await adapter.executeAndStream(task, executionId, workDir);
 * ```
 */
export class DirectRunnerAdapter {
  private executor: IAgentExecutor;
  private agUiAdapter?: AgUiEventAdapter;
  private logsStore?: ExecutionLogsStore;

  /**
   * Create a new DirectRunnerAdapter
   *
   * @param executor - Agent executor to wrap (ClaudeCodeExecutor, CursorExecutor, etc.)
   * @param agUiAdapter - Optional AG-UI adapter for event streaming
   * @param logsStore - Optional logs store for persistence
   */
  constructor(
    executor: IAgentExecutor,
    agUiAdapter?: AgUiEventAdapter,
    logsStore?: ExecutionLogsStore
  ) {
    this.executor = executor;
    this.agUiAdapter = agUiAdapter;
    this.logsStore = logsStore;
  }

  /**
   * Execute a task and stream normalized output
   *
   * Spawns the executor, creates output chunks, normalizes them,
   * transforms to AG-UI events, and persists logs.
   *
   * @param task - Execution task to run
   * @param executionId - Execution ID for log storage
   * @param workDir - Working directory for the task
   *
   * @throws Error if execution fails
   *
   * @example
   * ```typescript
   * const task: ExecutionTask = {
   *   id: 'task-1',
   *   type: 'issue',
   *   prompt: 'Fix the bug',
   *   workDir: '/project',
   *   priority: 0,
   *   dependencies: [],
   *   createdAt: new Date(),
   *   config: {},
   * };
   *
   * await adapter.executeAndStream(task, 'exec-123', '/project');
   * ```
   */
  async executeAndStream(
    task: ExecutionTask,
    executionId: string,
    workDir: string
  ): Promise<void> {
    try {
      // 1. Execute task with agent executor
      const spawned = await this.executor.executeTask(task);

      // 2. Create output stream from spawned process
      const outputStream = this.createOutputChunks(spawned.process);

      // 3. Normalize and stream output
      await this.streamNormalizedOutput(outputStream, executionId, workDir);

      // 4. Wait for process to exit
      await this.waitForExit(spawned.process);
    } catch (error) {
      this.handleExecutionError(error, executionId);
      throw error;
    }
  }

  /**
   * Resume a previous session and stream output
   *
   * @param task - Execution task (follow-up prompt)
   * @param executionId - Execution ID for log storage
   * @param sessionId - Previous session ID to resume
   * @param workDir - Working directory for the task
   *
   * @throws Error if executor doesn't support session resume or execution fails
   *
   * @example
   * ```typescript
   * await adapter.resumeAndStream(
   *   followUpTask,
   *   'exec-123',
   *   'session-456',
   *   '/project'
   * );
   * ```
   */
  async resumeAndStream(
    task: ExecutionTask,
    executionId: string,
    sessionId: string,
    workDir: string
  ): Promise<void> {
    try {
      // Check if executor supports session resume
      const capabilities = this.executor.getCapabilities();
      if (!capabilities.supportsSessionResume) {
        throw new Error(`Executor does not support session resume`);
      }

      // Resume task with session ID
      const spawned = await this.executor.resumeTask(task, sessionId);

      // Stream output (same as executeAndStream)
      const outputStream = this.createOutputChunks(spawned.process);
      await this.streamNormalizedOutput(outputStream, executionId, workDir);
      await this.waitForExit(spawned.process);
    } catch (error) {
      this.handleExecutionError(error, executionId);
      throw error;
    }
  }

  /**
   * Get agent capabilities
   *
   * @returns Capabilities declared by the underlying executor
   *
   * @example
   * ```typescript
   * const caps = adapter.getCapabilities();
   * if (caps.supportsSessionResume) {
   *   console.log('Can resume sessions');
   * }
   * ```
   */
  getCapabilities(): AgentCapabilities {
    return this.executor.getCapabilities();
  }

  /**
   * Check if agent is available
   *
   * @returns Promise resolving to true if agent is ready
   *
   * @example
   * ```typescript
   * const isReady = await adapter.checkAvailability();
   * if (!isReady) {
   *   throw new Error('Agent not available');
   * }
   * ```
   */
  async checkAvailability(): Promise<boolean> {
    return this.executor.checkAvailability();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Create output chunk stream from managed process
   *
   * Reads from stdout/stderr and creates OutputChunk objects with timestamps.
   * Uses executor's createOutputChunks if available, otherwise creates manually.
   *
   * @param process - Managed process from executor
   * @returns Async iterable of output chunks
   */
  private createOutputChunks(process: any): AsyncIterable<any> {
    // Use executor's createOutputChunks if available, otherwise implement
    if ("createOutputChunks" in this.executor) {
      return (this.executor as any).createOutputChunks(process);
    }

    // Fallback: manually create chunks from stdout
    return this.manuallyCreateChunks(process);
  }

  /**
   * Manually create output chunks from process streams
   *
   * Used as fallback if executor doesn't provide createOutputChunks.
   * Creates chunks from stdout with timestamps.
   *
   * @param process - Process with stdout stream
   * @returns Async generator of output chunks
   */
  private async *manuallyCreateChunks(process: any): AsyncIterable<any> {
    if (!process.streams?.stdout) {
      return;
    }

    for await (const chunk of process.streams.stdout) {
      yield {
        type: "stdout",
        data: chunk,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Stream normalized output through the pipeline
   *
   * Normalizes output chunks, transforms to AG-UI events,
   * emits via adapter, and persists to logs store.
   *
   * @param outputStream - Stream of output chunks from process
   * @param executionId - Execution ID for log storage
   * @param workDir - Working directory for normalization context
   */
  private async streamNormalizedOutput(
    outputStream: AsyncIterable<any>,
    executionId: string,
    workDir: string
  ): Promise<void> {
    // Normalize output using executor
    const normalizedStream = this.executor.normalizeOutput(
      outputStream,
      workDir
    );

    // Process each normalized entry
    for await (const entry of normalizedStream) {
      await this.processNormalizedEntry(entry, executionId);
    }
  }

  /**
   * Process a single normalized entry
   *
   * Pipeline:
   * 1. Persist to logs store (non-critical)
   * 2. Transform to AG-UI events
   * 3. Emit through adapter
   *
   * Errors in log persistence or event emission are logged but don't crash execution.
   *
   * @param entry - Normalized entry from executor
   * @param executionId - Execution ID for log storage
   */
  private async processNormalizedEntry(
    entry: NormalizedEntry,
    executionId: string
  ): Promise<void> {
    // 1. Persist normalized log (non-critical, don't fail execution)
    if (this.logsStore) {
      try {
        this.logsStore.appendNormalizedLog(executionId, entry);
      } catch (error) {
        console.error("[DirectRunnerAdapter] Failed to persist log:", {
          executionId,
          entryIndex: entry.index,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't throw - logs are nice-to-have
      }
    }

    // 2. Transform to AG-UI events
    const agUiEvents = normalizedEntryToAgUiEvents(entry);

    // 3. Emit events through adapter
    if (this.agUiAdapter) {
      for (const event of agUiEvents) {
        try {
          (this.agUiAdapter as any).emit(event);
        } catch (error) {
          console.error("[DirectRunnerAdapter] Failed to emit event:", {
            executionId,
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
          // Don't throw - continue processing other events
        }
      }
    }
  }

  /**
   * Wait for process to exit
   *
   * Returns when process exits successfully or times out after 5 minutes.
   *
   * @param process - Process to wait for
   * @throws Error if process exits with non-zero code or times out
   */
  private async waitForExit(process: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!process.pid) {
        // Process already exited
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Process exit timeout"));
      }, 300000); // 5 minute timeout

      process.on("exit", (code: number) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      process.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Handle execution errors
   *
   * Logs error with structured context and emits RUN_ERROR event if adapter is available.
   *
   * @param error - Error that occurred during execution
   * @param executionId - Execution ID for context
   */
  private handleExecutionError(error: unknown, executionId: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error("[DirectRunnerAdapter] Execution error:", {
      executionId,
      error: errorMessage,
      stack: errorStack,
    });

    // Emit RUN_ERROR event
    if (this.agUiAdapter) {
      this.agUiAdapter.emitRunError(errorMessage, errorStack);
    }
  }
}
