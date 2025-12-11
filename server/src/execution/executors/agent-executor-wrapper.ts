/**
 * AgentExecutorWrapper - Generic wrapper for any agent adapter
 *
 * Provides a unified execution interface that works with any IAgentAdapter.
 * Supports Claude Code, Codex, Cursor, Copilot, and any future agents.
 *
 * @module execution/executors/agent-executor-wrapper
 */

import type {
  IAgentAdapter,
  NormalizedEntry,
} from "agent-execution-engine/agents";
import type { FileChangeStat } from "@sudocode-ai/types";
import {
  ClaudeCodeExecutor,
  CodexExecutor,
  CursorExecutor,
  CopilotExecutor,
} from "agent-execution-engine/agents";
import type { AgentType, BaseAgentConfig } from "@sudocode-ai/types/agents";
import type { ProcessConfig } from "agent-execution-engine/process";
import type Database from "better-sqlite3";
import type { ExecutionTask } from "agent-execution-engine/engine";
import type { ExecutionLifecycleService } from "../../services/execution-lifecycle.js";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import type { TransportManager } from "../transport/transport-manager.js";
import { NormalizedEntryToAgUiAdapter } from "../output/normalized-to-ag-ui-adapter.js";
import { AgUiEventAdapter } from "../output/ag-ui-adapter.js";
import { updateExecution, getExecution } from "../../services/executions.js";
import { broadcastExecutionUpdate } from "../../services/websocket.js";
import { execSync } from "child_process";
import { ExecutionChangesService } from "../../services/execution-changes-service.js";
import { notifyExecutionEvent } from "../../services/execution-event-callbacks.js";

/**
 * Base executor interface that all agent executors implement
 */
interface IAgentExecutor {
  executeTask(task: ExecutionTask): Promise<{ process: any }>;
  resumeTask?(
    task: ExecutionTask,
    sessionId: string
  ): Promise<{ process: any }>;
  normalizeOutput(
    outputStream: AsyncIterable<any>,
    workDir: string
  ): AsyncIterable<NormalizedEntry>;
  getCapabilities?(): {
    supportsSessionResume?: boolean;
    requiresSetup?: boolean;
    supportsApprovals?: boolean;
    supportsMcp?: boolean;
    protocol?: string;
  };
}

/**
 * Configuration for AgentExecutorWrapper
 */
export interface AgentExecutorWrapperConfig<TConfig extends BaseAgentConfig> {
  adapter: IAgentAdapter<TConfig>;
  agentConfig: TConfig;
  /** Agent type for executor selection */
  agentType: AgentType;
  lifecycleService: ExecutionLifecycleService;
  logsStore: ExecutionLogsStore;
  projectId: string;
  db: Database.Database;
  transportManager?: TransportManager;
}

/**
 * Generic wrapper for any agent adapter
 *
 * Provides basic execution lifecycle management for any agent that implements
 * IAgentAdapter. This is a simplified version compared to ClaudeExecutorWrapper,
 * which has specialized logic for Claude Code's protocol peer.
 *
 * @example
 * ```typescript
 * const wrapper = new AgentExecutorWrapper({
 *   adapter: codexAdapter,
 *   agentConfig: {
 *     workDir: '/path/to/repo',
 *     apiKey: 'sk-...',
 *     model: 'code-davinci-002',
 *   },
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
export class AgentExecutorWrapper<TConfig extends BaseAgentConfig> {
  private adapter: IAgentAdapter<TConfig>;
  private executor: IAgentExecutor;
  /** Agent type used for executor selection and logging */
  private readonly agentType: AgentType;
  private _agentConfig: TConfig;
  private logsStore: ExecutionLogsStore;
  private transportManager?: TransportManager;
  private projectId: string;
  private db: Database.Database;
  private processConfig: ProcessConfig;
  private activeExecutions: Map<string, { cancel: () => void }>;
  /** Track completion state for Claude Code executions (from protocol peer) */
  private completionState: Map<
    string,
    { completed: boolean; exitCode: number }
  >;

  constructor(config: AgentExecutorWrapperConfig<TConfig>) {
    this.adapter = config.adapter;
    this.agentType = config.agentType;
    this._agentConfig = config.agentConfig;
    this.logsStore = config.logsStore;
    this.transportManager = config.transportManager;
    this.projectId = config.projectId;
    this.db = config.db;
    this.activeExecutions = new Map();
    this.completionState = new Map();

    // Build process configuration from agent-specific config
    this.processConfig = this.adapter.buildProcessConfig(this._agentConfig);

    // Create executor instance based on agent type
    this.executor = this.createExecutor(config.agentType, this._agentConfig);

    console.log("[AgentExecutorWrapper] Initialized", {
      agentType: this.agentType,
      adapterName: this.adapter.metadata.name,
      projectId: this.projectId,
      workDir: this.processConfig.workDir,
      hasTransport: !!this.transportManager,
      hasLogsStore: !!this.logsStore,
    });
  }

  /**
   * Create the appropriate executor for the given agent type
   *
   * @param agentType - Type of agent
   * @param agentConfig - Agent configuration
   * @returns Executor instance
   */
  private createExecutor(
    agentType: AgentType,
    agentConfig: TConfig
  ): IAgentExecutor {
    switch (agentType) {
      case "claude-code":
        return new ClaudeCodeExecutor({
          workDir: agentConfig.workDir,
          executablePath: (agentConfig as any).claudePath,
          print: (agentConfig as any).print ?? true,
          outputFormat: (agentConfig as any).outputFormat ?? "stream-json",
          verbose: (agentConfig as any).verbose ?? true,
          dangerouslySkipPermissions:
            (agentConfig as any).dangerouslySkipPermissions ?? false,
          restrictToWorkDir: (agentConfig as any).restrictToWorkDir ?? true,
          directoryGuardHookPath: (agentConfig as any).directoryGuardHookPath,
          mcpServers: (agentConfig as any).mcpServers,
          appendSystemPrompt: (agentConfig as any).appendSystemPrompt,
        }) as IAgentExecutor;

      case "codex":
        return new CodexExecutor(agentConfig as any) as IAgentExecutor;

      case "cursor":
        return new CursorExecutor(agentConfig as any) as IAgentExecutor;

      case "copilot":
        return new CopilotExecutor(agentConfig as any) as IAgentExecutor;

      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  }

  /**
   * Execute a task with full lifecycle management
   *
   * @param executionId - Unique execution identifier
   * @param task - Task to execute
   * @param workDir - Working directory for execution
   */
  async executeWithLifecycle(
    executionId: string,
    task: ExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(`[AgentExecutorWrapper] Starting execution ${executionId}`, {
      agentType: this.adapter.metadata.name,
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
        `[AgentExecutorWrapper] Connected AG-UI adapter to transport for ${executionId}`
      );
    }

    try {
      // 3. Emit run started event
      agUiAdapter.emitRunStarted({
        model: (task.config as any)?.model || this.adapter.metadata.name,
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

      // 5. Execute task with agent executor
      // Check if task has MCP servers or other runtime config that requires a fresh executor
      let executor = this.executor;
      const taskMcpServers = (task.metadata as any)?.mcpServers;
      const taskAppendSystemPrompt = (task.metadata as any)?.appendSystemPrompt;
      const taskDangerouslySkipPermissions = (task.metadata as any)
        ?.dangerouslySkipPermissions;
      const taskResume = (task.metadata as any)?.resume;

      // Debug: Log what we received in task metadata
      console.log(
        `[AgentExecutorWrapper] Task metadata for ${executionId}:`,
        {
          agentType: this.agentType,
          hasMcpServers: !!taskMcpServers,
          mcpServerNames: taskMcpServers
            ? Object.keys(taskMcpServers)
            : "none",
          hasAppendSystemPrompt: !!taskAppendSystemPrompt,
          dangerouslySkipPermissions: taskDangerouslySkipPermissions,
          resume: taskResume,
        }
      );

      if (
        this.agentType === "claude-code" &&
        (taskMcpServers ||
          taskAppendSystemPrompt ||
          taskDangerouslySkipPermissions ||
          taskResume)
      ) {
        // Create a task-specific executor with merged config
        console.log(
          `[AgentExecutorWrapper] Creating task-specific executor for ${executionId}`,
          {
            mcpServers: taskMcpServers ? Object.keys(taskMcpServers) : "none",
            dangerouslySkipPermissions: taskDangerouslySkipPermissions,
            resume: taskResume,
          }
        );
        executor = this.createExecutor(this.agentType, {
          ...this._agentConfig,
          mcpServers: taskMcpServers,
          appendSystemPrompt: taskAppendSystemPrompt,
          dangerouslySkipPermissions: taskDangerouslySkipPermissions,
          resume: taskResume,
        } as TConfig);
      }

      console.log(
        `[AgentExecutorWrapper] Spawning ${this.adapter.metadata.name} process for ${executionId}`,
        {
          taskId: task.id,
          workDir,
          promptLength: task.prompt.length,
        }
      );
      const spawned = await executor.executeTask(task);
      console.log(
        `[AgentExecutorWrapper] ${this.adapter.metadata.name} process spawned for ${executionId}`,
        {
          pid: spawned.process.process?.pid,
          spawnfile: spawned.process.process?.spawnfile,
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

      // 7. Initialize completion state for Claude Code
      if (this.agentType === "claude-code") {
        this.completionState.set(executionId, {
          completed: false,
          exitCode: 0,
        });
      }

      // 8. Create output stream from process stdout/stderr
      const outputStream = this.createOutputChunks(
        spawned.process,
        executionId
      );
      const normalized = this.executor.normalizeOutput(outputStream, workDir);

      // 9. Process normalized output (runs concurrently with process)
      const processOutputPromise = this.processNormalizedOutput(
        executionId,
        normalized,
        normalizedAdapter
      );

      // 10. Capture stderr for debugging
      const childProcess = spawned.process.process;
      if (childProcess && childProcess.stderr) {
        let stderrOutput = "";
        childProcess.stderr.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stderrOutput += chunk;
          console.error(
            `[AgentExecutorWrapper] ${this.adapter.metadata.name} stderr for ${executionId}:`,
            chunk
          );
        });
      }

      // 11. Wait for output processing to complete
      await processOutputPromise;

      console.log(
        `[AgentExecutorWrapper] Output processing completed for ${executionId}`
      );

      // 12. Close stdin to signal the process to exit (for Claude Code with peer)
      if (
        this.agentType === "claude-code" &&
        childProcess &&
        childProcess.stdin
      ) {
        try {
          childProcess.stdin.end();
          console.log(
            `[AgentExecutorWrapper] Closed stdin for Claude Code process ${executionId}`
          );
        } catch (error) {
          console.error(
            `[AgentExecutorWrapper] Error closing stdin for ${executionId}:`,
            error
          );
        }
      }

      // 13. Wait for process to exit (with timeout for Claude Code)
      const exitCode = await Promise.race([
        new Promise<number>((resolve) => {
          if (!childProcess) {
            // Use completion state for Claude Code if available
            if (this.agentType === "claude-code") {
              const state = this.completionState.get(executionId);
              resolve(state?.exitCode ?? 0);
            } else {
              resolve(0);
            }
            return;
          }

          childProcess.on("exit", (code: number | null) => {
            console.log(
              `[AgentExecutorWrapper] Process exited with code ${code} for ${executionId}`
            );
            // For Claude Code, use completion state exit code if available (more reliable)
            if (this.agentType === "claude-code") {
              const state = this.completionState.get(executionId);
              if (state?.completed) {
                console.log(
                  `[AgentExecutorWrapper] Using completion state exit code ${state.exitCode} for ${executionId}`
                );
                resolve(state.exitCode);
                return;
              }
            }
            resolve(code ?? 0);
          });

          childProcess.on("error", (error: Error) => {
            console.error(
              `[AgentExecutorWrapper] Process error for ${executionId}:`,
              error
            );
            resolve(1);
          });
        }),
        // Timeout for Claude Code processes that may not exit cleanly
        this.agentType === "claude-code"
          ? new Promise<number>((resolve) => {
              setTimeout(() => {
                console.log(
                  `[AgentExecutorWrapper] Process exit timeout for ${executionId}, using completion state`
                );
                if (childProcess && !childProcess.killed) {
                  childProcess.kill("SIGTERM");
                }
                // Use completion state exit code
                const state = this.completionState.get(executionId);
                resolve(state?.exitCode ?? 0);
              }, 5000);
            })
          : new Promise<number>(() => {}), // Never resolves for non-Claude agents
      ]);

      // 14. Handle completion
      if (exitCode === 0) {
        await this.handleSuccess(executionId);
        agUiAdapter.emitRunFinished({ exitCode });
      } else {
        throw new Error(`Process exited with code ${exitCode}`);
      }
    } catch (error) {
      console.error(
        `[AgentExecutorWrapper] Execution failed for ${executionId}:`,
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
      this.completionState.delete(executionId);
      if (this.transportManager) {
        this.transportManager.disconnectAdapter(agUiAdapter);
        console.log(
          `[AgentExecutorWrapper] Disconnected AG-UI adapter for ${executionId}`
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
   */
  async resumeWithLifecycle(
    executionId: string,
    sessionId: string,
    task: ExecutionTask,
    workDir: string
  ): Promise<void> {
    // Check if executor supports resume
    const capabilities = this.executor.getCapabilities?.();
    if (!capabilities?.supportsSessionResume || !this.executor.resumeTask) {
      console.log(
        `[AgentExecutorWrapper] Resume not supported for agent '${this.adapter.metadata.name}'`
      );
      throw new Error(
        `Resume functionality not supported for agent '${this.adapter.metadata.name}'`
      );
    }

    console.log(
      `[AgentExecutorWrapper] Resuming session ${sessionId} for ${executionId}`
    );

    // Setup AG-UI system
    const { agUiAdapter, normalizedAdapter } =
      this.setupAgUiSystem(executionId);

    if (this.transportManager) {
      this.transportManager.connectAdapter(agUiAdapter, executionId);
    }

    try {
      agUiAdapter.emitRunStarted({
        model: (task.config as any)?.model || this.adapter.metadata.name,
        sessionId,
        resumed: true,
      } as any);

      // Update status and session_id (sessionId is the path used for resumption)
      updateExecution(this.db, executionId, {
        status: "running",
        session_id: sessionId,
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

      // Use resumeTask instead of executeTask
      const spawned = await this.executor.resumeTask(task, sessionId);

      this.activeExecutions.set(executionId, {
        cancel: () => {
          if (spawned.process.process) {
            spawned.process.process.kill("SIGTERM");
          }
        },
      });

      // Initialize completion state for Claude Code
      if (this.agentType === "claude-code") {
        this.completionState.set(executionId, {
          completed: false,
          exitCode: 0,
        });
      }

      // Create output streams
      const outputChunks = this.createOutputChunks(
        spawned.process,
        executionId
      );
      const normalized = this.executor.normalizeOutput(outputChunks, workDir);

      const processOutputPromise = this.processNormalizedOutput(
        executionId,
        normalized,
        normalizedAdapter
      );

      await processOutputPromise;

      // For Claude Code, use completion state; for others, wait for process exit
      let exitCode = 0;
      if (this.agentType === "claude-code") {
        const state = this.completionState.get(executionId);
        exitCode = state?.exitCode ?? 0;
        console.log(
          `[AgentExecutorWrapper] Using completion state exit code ${exitCode} for resumed ${executionId}`
        );
      } else {
        exitCode = await new Promise<number>((resolve, reject) => {
          const childProcess = spawned.process.process;
          if (!childProcess) {
            reject(new Error("No child process available"));
            return;
          }

          childProcess.on("exit", (code: number | null) => resolve(code || 0));
          childProcess.on("error", (error: Error) => reject(error));
        });
      }

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
      this.completionState.delete(executionId);
      if (this.transportManager) {
        this.transportManager.disconnectAdapter(agUiAdapter);
      }
    }
  }

  /**
   * Cancel a running execution
   *
   * @param executionId - Execution ID to cancel
   */
  async cancel(executionId: string): Promise<void> {
    console.log(`[AgentExecutorWrapper] Cancel execution ${executionId}`);

    // Kill the process if active
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.cancel();
      this.activeExecutions.delete(executionId);
    } else {
      console.warn(
        `[AgentExecutorWrapper] No active execution found for ${executionId}`
      );
    }

    // Capture final commit before marking stopped
    const dbExecution = getExecution(this.db, executionId);
    const repoPath = dbExecution?.worktree_path || this.processConfig.workDir;

    let afterCommit: string | undefined;
    try {
      afterCommit = execSync("git rev-parse HEAD", {
        cwd: repoPath,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      console.warn(
        `[AgentExecutorWrapper] Failed to capture after_commit for cancelled execution ${executionId}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue - this is supplementary data
    }

    // Update database status
    updateExecution(this.db, executionId, {
      after_commit: afterCommit,
      status: "stopped",
      completed_at: new Date().toISOString(),
    });

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
  }

  /**
   * Setup AG-UI system for execution
   *
   * @private
   */
  private setupAgUiSystem(executionId: string): {
    agUiAdapter: AgUiEventAdapter;
    normalizedAdapter: NormalizedEntryToAgUiAdapter;
  } {
    const agUiAdapter = new AgUiEventAdapter(executionId);
    const normalizedAdapter = new NormalizedEntryToAgUiAdapter(agUiAdapter);

    console.log(`[AgentExecutorWrapper] Setup AG-UI system for ${executionId}`);

    return { agUiAdapter, normalizedAdapter };
  }

  /**
   * Process normalized output from agent
   *
   * For Claude Code: Also captures session ID from metadata for session resumption
   *
   * @private
   */
  private async processNormalizedOutput(
    executionId: string,
    normalized: AsyncIterable<NormalizedEntry>,
    normalizedAdapter: NormalizedEntryToAgUiAdapter
  ): Promise<void> {
    console.log(
      `[AgentExecutorWrapper] Processing normalized output for ${executionId}`
    );

    let entryCount = 0;
    let sessionIdCaptured = false;

    for await (const entry of normalized) {
      entryCount++;

      // Log first 10 entries and every 100th entry for debugging
      if (entryCount <= 10 || entryCount % 100 === 0) {
        console.log(
          `[AgentExecutorWrapper] Entry ${entryCount} for ${executionId}:`,
          {
            index: entry.index,
            kind: entry.type.kind,
            timestamp: entry.timestamp,
            hasMetadata: !!entry.metadata,
            sessionId: entry.metadata?.sessionId,
          }
        );
      }

      try {
        // Capture session ID from metadata for Claude Code (populated by normalizer from SystemMessage)
        if (
          this.agentType === "claude-code" &&
          !sessionIdCaptured &&
          entry.metadata?.sessionId
        ) {
          const sessionId = entry.metadata.sessionId;
          updateExecution(this.db, executionId, { session_id: sessionId });
          console.log(
            `[AgentExecutorWrapper] Captured session ID from metadata: ${sessionId} for ${executionId}`
          );
          sessionIdCaptured = true;
        }

        // 1. Store normalized entry for historical replay
        this.logsStore.appendNormalizedEntry(executionId, entry);

        // 2. Convert to AG-UI and broadcast for real-time streaming
        await normalizedAdapter.processEntry(entry);
      } catch (error) {
        console.error(
          `[AgentExecutorWrapper] Error processing entry for ${executionId}:`,
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
      `[AgentExecutorWrapper] Finished processing ${entryCount} entries for ${executionId}`
    );
  }

  /**
   * Handle successful execution
   *
   * @private
   */
  private async handleSuccess(executionId: string): Promise<void> {
    console.log(
      `[AgentExecutorWrapper] Execution ${executionId} completed successfully`
    );

    // Capture final commit before marking complete
    const execution = getExecution(this.db, executionId);
    const repoPath = execution?.worktree_path || this.processConfig.workDir;

    let afterCommit: string | undefined;
    try {
      afterCommit = execSync("git rev-parse HEAD", {
        cwd: repoPath,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      console.warn(
        `[AgentExecutorWrapper] Failed to capture after_commit for execution ${executionId}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue - this is supplementary data
    }

    // Calculate file changes using ExecutionChangesService
    let filesChangedJson: string | null = null;
    try {
      // Import and instantiate ExecutionChangesService
      const changesService = new ExecutionChangesService(
        this.db,
        this.processConfig.workDir
      );

      // Get changes for this execution
      const changesResult = await changesService.getChanges(executionId);

      if (changesResult.available && changesResult.captured) {
        // Extract just the file paths from the changes
        const filePaths = changesResult.captured.files.map((f: FileChangeStat) => f.path);
        filesChangedJson = JSON.stringify(filePaths);
        console.log(
          `[AgentExecutorWrapper] Captured ${filePaths.length} file changes for execution ${executionId}`
        );
      } else {
        console.log(
          `[AgentExecutorWrapper] No file changes detected for execution ${executionId}:`,
          changesResult.reason
        );
      }
    } catch (error) {
      console.warn(
        `[AgentExecutorWrapper] Failed to calculate files_changed for execution ${executionId}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue - this is supplementary data
    }

    updateExecution(this.db, executionId, {
      after_commit: afterCommit,
      files_changed: filesChangedJson,
      status: "completed",
      completed_at: new Date().toISOString(),
      exit_code: 0,
    });

    const updatedExecution = getExecution(this.db, executionId);
    if (updatedExecution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        updatedExecution,
        updatedExecution.issue_id || undefined
      );

      // Notify callbacks for workflow integration
      await notifyExecutionEvent("completed", {
        executionId,
        workflowId: updatedExecution.workflow_execution_id ?? undefined,
        issueId: updatedExecution.issue_id ?? undefined,
      });
    }
  }

  /**
   * Handle execution error
   *
   * @private
   */
  private async handleError(executionId: string, error: Error): Promise<void> {
    console.error(
      `[AgentExecutorWrapper] Execution ${executionId} failed:`,
      error
    );

    // Calculate file changes even for failed executions
    // (user may want to commit partial work)
    let filesChangedJson: string | null = null;
    try {
      const changesService = new ExecutionChangesService(
        this.db,
        this.processConfig.workDir
      );
      const changesResult = await changesService.getChanges(executionId);

      if (changesResult.available && changesResult.captured) {
        const filePaths = changesResult.captured.files.map((f: FileChangeStat) => f.path);
        filesChangedJson = JSON.stringify(filePaths);
        console.log(
          `[AgentExecutorWrapper] Captured ${filePaths.length} file changes for failed execution ${executionId}`
        );
      }
    } catch (calcError) {
      console.warn(
        `[AgentExecutorWrapper] Failed to calculate files_changed for failed execution ${executionId}:`,
        calcError instanceof Error ? calcError.message : String(calcError)
      );
    }

    updateExecution(this.db, executionId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: error.message,
      files_changed: filesChangedJson,
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

      // Notify callbacks for workflow integration
      await notifyExecutionEvent("failed", {
        executionId,
        workflowId: execution.workflow_execution_id ?? undefined,
        issueId: execution.issue_id ?? undefined,
        error: error.message,
      });
    }
  }

  /**
   * Create output chunk stream from ManagedProcess
   *
   * For Claude Code: Uses protocol peer to receive messages
   * For other agents: Reads directly from stdout/stderr streams
   *
   * @private
   */
  private async *createOutputChunks(
    process: any,
    executionId: string
  ): AsyncIterable<{
    type: "stdout" | "stderr";
    data: Buffer;
    timestamp: Date;
  }> {
    // Check if this is a Claude Code process with a protocol peer
    const peer = process.peer;

    if (this.agentType === "claude-code") {
      // Claude Code REQUIRES a protocol peer
      if (!peer) {
        throw new Error(
          "No peer attached to Claude Code process - cannot read output"
        );
      }
      // Claude Code: Use protocol peer messages
      console.log(
        "[AgentExecutorWrapper] Using protocol peer for Claude Code output"
      );
      yield* this.peerMessagesToOutputChunks(peer, executionId);
      return;
    }

    // Other agents: Use stdout/stderr streams
    if (!process.streams) {
      throw new Error("Process does not have streams available");
    }

    const { stdout, stderr } = process.streams;

    // Merge stdout and stderr
    const streams = [];
    if (stdout) {
      streams.push(this.streamToChunks(stdout, "stdout"));
    }
    if (stderr) {
      streams.push(this.streamToChunks(stderr, "stderr"));
    }

    // Yield chunks from all streams
    for (const stream of streams) {
      for await (const chunk of stream) {
        yield chunk;
      }
    }
  }

  /**
   * Convert protocol peer messages to output chunks
   *
   * Used for Claude Code which uses a protocol peer that consumes stdout
   * Updates completion state when result message is received
   *
   * @private
   */
  private async *peerMessagesToOutputChunks(
    peer: any,
    executionId: string
  ): AsyncIterable<{
    type: "stdout" | "stderr";
    data: Buffer;
    timestamp: Date;
  }> {
    const messageQueue: any[] = [];
    let streamEnded = false;
    let exitDetected = false;

    // Register message handler
    peer.onMessage((message: any) => {
      messageQueue.push(message);

      // Detect completion and update completion state
      if (
        message.type === "result" &&
        (message.subtype === "success" || message.subtype === "failure")
      ) {
        exitDetected = true;
        const exitCode = message.subtype === "success" ? 0 : 1;
        this.completionState.set(executionId, { completed: true, exitCode });
        console.log(
          `[AgentExecutorWrapper] Detected completion from peer for ${executionId}:`,
          { subtype: message.subtype, exitCode }
        );
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
      const line = JSON.stringify(message) + "\n";
      yield {
        type: "stdout" as const,
        data: Buffer.from(line, "utf-8"),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Convert a readable stream to output chunks
   *
   * @private
   */
  private async *streamToChunks(
    stream: any,
    type: "stdout" | "stderr"
  ): AsyncIterable<{
    type: "stdout" | "stderr";
    data: Buffer;
    timestamp: Date;
  }> {
    for await (const chunk of stream) {
      yield {
        type,
        data: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        timestamp: new Date(),
      };
    }
  }
}
