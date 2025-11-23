/**
 * ClaudeExecutorWrapper - Integration wrapper for ClaudeCodeExecutor
 *
 * Handles full execution lifecycle using ClaudeCodeExecutor from agent-execution-engine,
 * integrating with ExecutionLifecycleService, ExecutionLogsStore, TransportManager,
 * and WebSocket broadcasts.
 *
 * @module execution/executors/claude-executor-wrapper
 */

import { ClaudeCodeExecutor } from "agent-execution-engine/agents/claude";
import type { NormalizedEntry } from "agent-execution-engine/agents";
import type { ExecutionTask } from "agent-execution-engine/engine";
import type Database from "better-sqlite3";
import type { ExecutionLifecycleService } from "../../services/execution-lifecycle.js";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import type { TransportManager } from "../transport/transport-manager.js";
import { NormalizedEntryToAgUiAdapter } from "../output/normalized-to-ag-ui-adapter.js";
import { AgUiEventAdapter } from "../output/ag-ui-adapter.js";
import {
  updateExecution,
  getExecution,
} from "../../services/executions.js";
import { broadcastExecutionUpdate } from "../../services/websocket.js";

/**
 * Configuration for ClaudeExecutorWrapper
 */
export interface ClaudeExecutorWrapperConfig {
  workDir: string;
  lifecycleService: ExecutionLifecycleService;
  logsStore: ExecutionLogsStore;
  projectId: string;
  db: Database.Database;
  transportManager?: TransportManager;
}

/**
 * Wrapper for ClaudeCodeExecutor that integrates with sudocode infrastructure
 *
 * @example
 * ```typescript
 * const wrapper = new ClaudeExecutorWrapper({
 *   workDir: '/path/to/repo',
 *   lifecycleService,
 *   logsStore,
 *   projectId: 'my-project',
 *   db,
 *   transportManager,
 * });
 *
 * await wrapper.executeWithLifecycle(executionId, task, workDir);
 * ```
 */
export class ClaudeExecutorWrapper {
  private executor: ClaudeCodeExecutor;
  private logsStore: ExecutionLogsStore;
  private transportManager?: TransportManager;
  private projectId: string;
  private db: Database.Database;
  private activeExecutions: Map<string, { cancel: () => void }>;

  constructor(config: ClaudeExecutorWrapperConfig) {
    // IMPORTANT: ClaudeCodeExecutor has a bug where it uses --input-format=stream-json
    // but sends SDK protocol messages (sdk_control_request), which are incompatible.
    //
    // We need to use the executor WITHOUT the protocol layer to avoid this issue.
    // The executor should just send the user's prompt directly to Claude CLI.
    this.executor = new ClaudeCodeExecutor({
      workDir: config.workDir,
      print: true, // Required for stream-json output format
      outputFormat: "stream-json",
      verbose: true, // Required when using --print with stream-json
      dangerouslySkipPermissions: true, // Skip permission prompts for automated execution
    });
    // Note: lifecycleService not stored as we use direct DB calls (updateExecution/getExecution)
    this.logsStore = config.logsStore;
    this.transportManager = config.transportManager;
    this.projectId = config.projectId;
    this.db = config.db;
    this.activeExecutions = new Map();

    console.log("[ClaudeExecutorWrapper] Initialized", {
      projectId: this.projectId,
      workDir: config.workDir,
      hasTransport: !!this.transportManager,
    });
  }

  /**
   * Execute a task with full lifecycle management
   *
   * @param executionId - Unique execution identifier
   * @param task - Task to execute
   * @param workDir - Working directory for execution
   *
   * @example
   * ```typescript
   * const task: ExecutionTask = {
   *   id: 'task-1',
   *   type: 'issue',
   *   prompt: 'Fix the bug',
   *   workDir: '/path/to/repo',
   *   config: {},
   *   priority: 0,
   *   dependencies: [],
   *   createdAt: new Date(),
   * };
   *
   * await wrapper.executeWithLifecycle(executionId, task, '/path/to/repo');
   * ```
   */
  async executeWithLifecycle(
    executionId: string,
    task: ExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(`[ClaudeExecutorWrapper] Starting execution ${executionId}`, {
      taskId: task.id,
      workDir,
    });

    // 1. Setup AG-UI system
    const { agUiAdapter, normalizedAdapter } =
      this.setupAgUiSystem(executionId);

    // 2. Connect to transport
    if (this.transportManager) {
      this.transportManager.connectAdapter(agUiAdapter, executionId);
      console.log(
        `[ClaudeExecutorWrapper] Connected AG-UI adapter to transport for ${executionId}`
      );
    }

    try {
      // 3. Emit run started event
      agUiAdapter.emitRunStarted({
        model: (task.config as any)?.model || "claude-sonnet-4",
        timestamp: new Date().toISOString(),
      });

      // 4. Update execution status to running
      updateExecution(this.db, executionId, { status: "running" });
      const execution = getExecution(this.db, executionId);
      if (execution) {
        broadcastExecutionUpdate(
          this.projectId,
          executionId,
          "status_changed",
          execution,
          execution.issue_id || undefined
        );
      }

      // 5. Execute task with ClaudeCodeExecutor
      console.log(
        `[ClaudeExecutorWrapper] Spawning Claude process for ${executionId}`,
        {
          taskId: task.id,
          workDir,
          promptLength: task.prompt.length,
          metadata: task.metadata,
        }
      );
      const spawned = await this.executor.executeTask(task);
      console.log(
        `[ClaudeExecutorWrapper] Claude process spawned for ${executionId}`,
        {
          pid: spawned.process.process?.pid,
          spawnfile: spawned.process.process?.spawnfile,
          spawnargs: spawned.process.process?.spawnargs,
        }
      );

      // 6. Store cancellation handle
      this.activeExecutions.set(executionId, {
        cancel: () => {
          if (spawned.process.process) {
            spawned.process.process.kill("SIGTERM");
          }
        },
      });

      // 7. Create output stream from peer messages
      // When using the protocol peer, we need to consume messages from the peer,
      // not from stdout directly (the peer consumes stdout internally)
      const peer = (spawned.process as any).peer;
      if (!peer) {
        throw new Error('No peer attached to spawned process');
      }

      // Track completion state
      let executionCompleted = false;
      let completionExitCode = 0;

      // Create async generator that converts peer messages to output chunks
      async function* peerMessagesToOutputChunks() {
        const messageQueue: any[] = [];
        let streamEnded = false;
        let exitDetected = false;

        // Register message handler
        peer.onMessage((message: any) => {
          messageQueue.push(message);
          // Detect completion
          if (message.type === 'result' && (message.subtype === 'success' || message.subtype === 'failure')) {
            exitDetected = true;
            executionCompleted = true;
            completionExitCode = message.subtype === 'success' ? 0 : 1;
          }
        });

        // Process messages until completion
        while (!streamEnded || messageQueue.length > 0) {
          if (messageQueue.length === 0) {
            if (exitDetected) {
              streamEnded = true;
              break;
            }
            // Wait for more messages
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }

          // Convert message to stream-json line format
          const message = messageQueue.shift();
          const line = JSON.stringify(message) + '\n';
          yield {
            type: 'stdout' as const,
            data: Buffer.from(line, 'utf-8'),
            timestamp: new Date(),
          };
        }
      }

      const normalized = this.executor.normalizeOutput(peerMessagesToOutputChunks(), workDir);

      // 8. Process normalized output (runs concurrently with process)
      const processOutputPromise = this.processNormalizedOutput(
        executionId,
        normalized,
        normalizedAdapter
      );

      // 9. Capture stderr for debugging
      const childProcess = spawned.process.process;
      if (childProcess && childProcess.stderr) {
        let stderrOutput = '';
        childProcess.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderrOutput += chunk;
          console.error(`[ClaudeExecutorWrapper] Claude stderr for ${executionId}:`, chunk);
        });
      }

      // 10. Wait for output processing to complete
      // This will finish when we receive the result message from the peer
      await processOutputPromise;

      console.log(
        `[ClaudeExecutorWrapper] Output processing completed for ${executionId}`,
        { executionCompleted, completionExitCode }
      );

      // 11. Close stdin to signal the process to exit
      if (childProcess && childProcess.stdin) {
        try {
          childProcess.stdin.end();
        } catch (error) {
          console.error(`[ClaudeExecutorWrapper] Error closing stdin:`, error);
        }
      }

      // 12. Wait for process to exit (with timeout)
      const exitCode = await Promise.race([
        new Promise<number>((resolve) => {
          if (!childProcess) {
            resolve(completionExitCode);
            return;
          }

          childProcess.on("exit", (code: number | null) => {
            console.log(
              `[ClaudeExecutorWrapper] Process exited with code ${code} for ${executionId}`
            );
            resolve(code ?? completionExitCode);
          });

          childProcess.on("error", (error: Error) => {
            console.error(
              `[ClaudeExecutorWrapper] Process error for ${executionId}:`,
              error
            );
            resolve(1);
          });
        }),
        // Timeout after 5 seconds if process doesn't exit
        new Promise<number>((resolve) => {
          setTimeout(() => {
            console.log(
              `[ClaudeExecutorWrapper] Process exit timeout for ${executionId}, using completion code`
            );
            // Kill the process if it hasn't exited
            if (childProcess && !childProcess.killed) {
              childProcess.kill('SIGTERM');
            }
            resolve(completionExitCode);
          }, 5000);
        }),
      ]);

      // 13. Handle completion
      if (exitCode === 0) {
        await this.handleSuccess(executionId);
        agUiAdapter.emitRunFinished({ exitCode });
      } else {
        throw new Error(`Process exited with code ${exitCode}`);
      }
    } catch (error) {
      console.error(
        `[ClaudeExecutorWrapper] Execution failed for ${executionId}:`,
        error
      );
      await this.handleError(executionId, error as Error);
      agUiAdapter.emitRunError(
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      // Cleanup
      this.activeExecutions.delete(executionId);
      if (this.transportManager) {
        this.transportManager.disconnectAdapter(agUiAdapter);
        console.log(
          `[ClaudeExecutorWrapper] Disconnected AG-UI adapter for ${executionId}`
        );
      }
    }
  }

  /**
   * Resume a task from a previous session
   *
   * @param executionId - Unique execution identifier
   * @param sessionId - Session ID to resume from
   * @param task - Task to resume
   * @param workDir - Working directory for execution
   *
   * @example
   * ```typescript
   * await wrapper.resumeWithLifecycle(executionId, sessionId, task, workDir);
   * ```
   */
  async resumeWithLifecycle(
    executionId: string,
    sessionId: string,
    task: ExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(
      `[ClaudeExecutorWrapper] Resuming session ${sessionId} for ${executionId}`
    );

    // Similar to executeWithLifecycle but use resumeTask()
    const { agUiAdapter, normalizedAdapter } =
      this.setupAgUiSystem(executionId);

    if (this.transportManager) {
      this.transportManager.connectAdapter(agUiAdapter, executionId);
    }

    try {
      agUiAdapter.emitRunStarted({
        model: (task.config as any)?.model || "claude-sonnet-4",
        sessionId,
        resumed: true,
      } as any);

      updateExecution(this.db, executionId, { status: "running" });
      const execution = getExecution(this.db, executionId);
      if (execution) {
        broadcastExecutionUpdate(
          this.projectId,
          executionId,
          "status_changed",
          execution,
          execution.issue_id || undefined
        );
      }

      // Use resumeTask instead of executeTask
      const spawned = await this.executor.resumeTask(task, sessionId);

      this.activeExecutions.set(executionId, {
        cancel: () => {
          if (spawned.process.process) {
            spawned.process.process.kill("SIGTERM");
          }
        },
      });

      // Create output streams (same as executeWithLifecycle)
      const outputChunks = (this.executor as any).createOutputChunks(spawned.process);
      const normalized = this.executor.normalizeOutput(outputChunks, workDir);

      const processOutputPromise = this.processNormalizedOutput(
        executionId,
        normalized,
        normalizedAdapter
      );

      const exitCode = await new Promise<number>((resolve, reject) => {
        const childProcess = spawned.process.process;
        if (!childProcess) {
          reject(new Error("No child process available"));
          return;
        }

        childProcess.on("exit", (code: number | null) => resolve(code || 0));
        childProcess.on("error", (error: Error) => reject(error));
      });

      await processOutputPromise;

      if (exitCode === 0) {
        await this.handleSuccess(executionId);
        agUiAdapter.emitRunFinished({ exitCode });
      } else {
        throw new Error(`Process exited with code ${exitCode}`);
      }
    } catch (error) {
      await this.handleError(executionId, error as Error);
      agUiAdapter.emitRunError(
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
      if (this.transportManager) {
        this.transportManager.disconnectAdapter(agUiAdapter);
      }
    }
  }

  /**
   * Cancel a running execution
   *
   * @param executionId - Execution ID to cancel
   *
   * @example
   * ```typescript
   * await wrapper.cancel(executionId);
   * ```
   */
  async cancel(executionId: string): Promise<void> {
    console.log(`[ClaudeExecutorWrapper] Cancelling execution ${executionId}`);

    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      console.warn(
        `[ClaudeExecutorWrapper] No active execution found for ${executionId}`
      );
      return;
    }

    // Kill the process
    execution.cancel();

    // Update database
    updateExecution(this.db, executionId, {
      status: "stopped",
      completed_at: new Date().toISOString(),
    });

    // Broadcast update
    const updatedExecution = getExecution(this.db, executionId);
    if (updatedExecution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        updatedExecution,
        updatedExecution.issue_id || undefined
      );
    }

    this.activeExecutions.delete(executionId);
  }

  /**
   * Process normalized output stream
   *
   * Persists entries to ExecutionLogsStore and converts to AG-UI events
   * for broadcasting via TransportManager.
   *
   * @private
   */
  private async processNormalizedOutput(
    executionId: string,
    outputStream: AsyncIterable<NormalizedEntry>,
    normalizedAdapter: NormalizedEntryToAgUiAdapter
  ): Promise<void> {
    console.log(
      `[ClaudeExecutorWrapper] Processing normalized output for ${executionId}`
    );

    let entryCount = 0;

    for await (const entry of outputStream) {
      entryCount++;

      // Log first 10 entries and every 100th entry for debugging
      if (entryCount <= 10 || entryCount % 100 === 0) {
        console.log(
          `[ClaudeExecutorWrapper] Entry ${entryCount} for ${executionId}:`,
          {
            index: entry.index,
            kind: entry.type.kind,
            timestamp: entry.timestamp,
          }
        );
      }

      try {
        // 1. Store normalized entry for historical replay
        this.logsStore.appendNormalizedEntry(executionId, entry);

        // 2. Convert to AG-UI and broadcast for real-time streaming
        await normalizedAdapter.processEntry(entry);
      } catch (error) {
        console.error(
          `[ClaudeExecutorWrapper] Error processing entry for ${executionId}:`,
          {
            entryIndex: entry.index,
            entryType: entry.type.kind,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Continue processing (don't fail entire execution for one entry)
      }
    }

    console.log(
      `[ClaudeExecutorWrapper] Finished processing ${entryCount} entries for ${executionId}`
    );
  }

  /**
   * Setup AG-UI adapter system
   *
   * Creates and wires together AgUiEventAdapter and NormalizedEntryToAgUiAdapter.
   *
   * @private
   */
  private setupAgUiSystem(executionId: string): {
    agUiAdapter: AgUiEventAdapter;
    normalizedAdapter: NormalizedEntryToAgUiAdapter;
  } {
    const agUiAdapter = new AgUiEventAdapter(executionId);
    const normalizedAdapter = new NormalizedEntryToAgUiAdapter(agUiAdapter);

    console.log(
      `[ClaudeExecutorWrapper] Setup AG-UI system for ${executionId}`
    );

    return { agUiAdapter, normalizedAdapter };
  }

  /**
   * Handle successful execution completion
   *
   * @private
   */
  private async handleSuccess(executionId: string): Promise<void> {
    console.log(
      `[ClaudeExecutorWrapper] Execution ${executionId} completed successfully`
    );

    updateExecution(this.db, executionId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      exit_code: 0,
    });

    const execution = getExecution(this.db, executionId);
    if (execution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        execution,
        execution.issue_id || undefined
      );
    }
  }

  /**
   * Handle execution error
   *
   * @private
   */
  private async handleError(
    executionId: string,
    error: Error
  ): Promise<void> {
    console.error(
      `[ClaudeExecutorWrapper] Execution ${executionId} failed:`,
      error
    );

    updateExecution(this.db, executionId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: error.message,
    });

    const execution = getExecution(this.db, executionId);
    if (execution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        execution,
        execution.issue_id || undefined
      );
    }
  }
}
