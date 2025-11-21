/**
 * Execution Worker Pool
 *
 * Manages isolated worker processes for Claude Code executions.
 * Each execution runs in a separate Node.js process with:
 * - Independent memory space
 * - Resource limits (CPU/memory)
 * - Crash isolation (worker crash doesn't affect main server)
 * - IPC-based communication
 *
 * @module services/execution-worker-pool
 */

import { fork, type ChildProcess } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { Execution } from "@sudocode-ai/types";
import type {
  WorkerToMainMessage,
  MainToWorkerMessage,
  WorkerEnv,
  OutputEvent,
} from "../workers/worker-ipc.js";
import { isWorkerMessage } from "../workers/worker-ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Worker process info tracked by pool
 */
interface WorkerProcess {
  workerId: string;
  executionId: string;
  process: ChildProcess;
  startedAt: Date;
  status: "starting" | "running" | "completing" | "completed" | "failed";
}

/**
 * Configuration for worker pool
 */
export interface WorkerPoolConfig {
  /** Maximum concurrent workers (default: 3) */
  maxConcurrentWorkers?: number;

  /** Memory limit per worker in MB (default: 512) */
  maxMemoryMB?: number;

  /** Worker idle timeout in ms (default: 30000) */
  workerIdleTimeout?: number;

  /** Enable verbose worker logging (default: false) */
  verbose?: boolean;
}

/**
 * Event handlers for worker pool events
 */
export interface WorkerPoolEventHandlers {
  /** Called when worker emits log output */
  onLog?: (executionId: string, event: OutputEvent) => void;

  // TODO: Generalize this beyond AG-UI events.
  /** Called when worker emits AG-UI event */
  onAgUiEvent?: (executionId: string, event: any) => void;

  /** Called when worker status changes */
  onStatusChange?: (executionId: string, status: string) => void;

  /** Called when worker completes successfully */
  onComplete?: (executionId: string, result: any) => void;

  /** Called when worker encounters error */
  onError?: (executionId: string, error: string, fatal: boolean) => void;

  /** Called when worker crashes */
  onCrash?: (
    executionId: string,
    exitCode: number | null,
    signal: string | null
  ) => void;
}

/**
 * ExecutionWorkerPool
 *
 * Spawns and manages isolated worker processes for executions.
 * Enforces concurrency limits, handles crashes, and forwards IPC messages.
 */
export class ExecutionWorkerPool {
  private projectId: string;
  private config: Required<WorkerPoolConfig>;
  private workers = new Map<string, WorkerProcess>();
  private eventHandlers: WorkerPoolEventHandlers;
  private shutdownInProgress = false;

  constructor(
    projectId: string,
    config: WorkerPoolConfig = {},
    eventHandlers: WorkerPoolEventHandlers = {}
  ) {
    this.projectId = projectId;
    this.config = {
      maxConcurrentWorkers: config.maxConcurrentWorkers ?? 3,
      maxMemoryMB: config.maxMemoryMB ?? 512,
      workerIdleTimeout: config.workerIdleTimeout ?? 30000,
      verbose: config.verbose ?? false,
    };
    this.eventHandlers = eventHandlers;
  }

  /**
   * Start execution in isolated worker process
   *
   * @param execution - Execution record
   * @param repoPath - Path to git repository
   * @param dbPath - Path to SQLite database
   * @returns Worker ID
   */
  async startExecution(
    execution: Execution,
    repoPath: string,
    dbPath: string
  ): Promise<string> {
    // Check concurrency limit
    if (this.workers.size >= this.config.maxConcurrentWorkers) {
      throw new Error(
        `Maximum concurrent workers (${this.config.maxConcurrentWorkers}) reached. Please wait for an execution to complete.`
      );
    }

    const workerId = `worker-${execution.id.slice(0, 8)}-${Date.now()}`;

    if (this.config.verbose) {
      console.log(
        `[WorkerPool:${this.projectId}] Starting worker ${workerId} for execution ${execution.id}`
      );
    }

    // Prepare worker environment
    const workerEnv: WorkerEnv = {
      EXECUTION_ID: execution.id,
      PROJECT_ID: this.projectId,
      REPO_PATH: repoPath,
      DB_PATH: dbPath,
      MAX_MEMORY_MB: this.config.maxMemoryMB.toString(),
      WORKER_ID: workerId,
    };

    // Determine worker script path
    // In development: src/workers/execution-worker.ts (via tsx)
    // In production: dist/workers/execution-worker.js
    const isDev = process.env.NODE_ENV !== "production";
    const workerScript = isDev
      ? join(__dirname, "../workers/execution-worker.ts")
      : join(__dirname, "../workers/execution-worker.js");

    // Spawn worker process
    // In dev: Use tsx to run TypeScript directly via --import (Node.js 20.6+)
    // In prod: Use node to run compiled JavaScript
    const workerProcess = fork(workerScript, [], {
      env: {
        ...process.env,
        ...workerEnv,
        NODE_OPTIONS: `--max-old-space-size=${this.config.maxMemoryMB}`,
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: false,
      execArgv: isDev ? ["--import", "tsx"] : [],
    });

    const worker: WorkerProcess = {
      workerId,
      executionId: execution.id,
      process: workerProcess,
      startedAt: new Date(),
      status: "starting",
    };

    this.workers.set(execution.id, worker);

    // Set up IPC message handling
    this.setupWorkerHandlers(worker);

    return workerId;
  }

  /**
   * Set up event handlers for worker process
   */
  private setupWorkerHandlers(worker: WorkerProcess): void {
    const { process: workerProcess, executionId, workerId } = worker;

    // Handle IPC messages from worker
    workerProcess.on("message", (message: any) => {
      if (!isWorkerMessage(message)) {
        console.warn(
          `[WorkerPool:${this.projectId}] Invalid message from worker ${workerId}:`,
          message
        );
        return;
      }

      this.handleWorkerMessage(worker, message);
    });

    // Handle worker exit
    workerProcess.on("exit", (code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });

    // Handle worker errors
    workerProcess.on("error", (error) => {
      console.error(
        `[WorkerPool:${this.projectId}] Worker ${workerId} error:`,
        error
      );
      this.eventHandlers.onError?.(executionId, error.message, true);
    });

    // Forward stdout/stderr if verbose
    if (this.config.verbose) {
      workerProcess.stdout?.on("data", (data) => {
        console.log(`[Worker:${workerId}:stdout]`, data.toString());
      });
      workerProcess.stderr?.on("data", (data) => {
        console.error(`[Worker:${workerId}:stderr]`, data.toString());
      });
    }
  }

  /**
   * Handle IPC message from worker
   */
  private handleWorkerMessage(
    worker: WorkerProcess,
    message: WorkerToMainMessage
  ): void {
    const { executionId, workerId } = worker;

    switch (message.type) {
      case "ready":
        if (this.config.verbose) {
          console.log(
            `[WorkerPool:${this.projectId}] Worker ${workerId} ready`
          );
        }
        worker.status = "running";
        break;

      case "log":
        this.eventHandlers.onLog?.(executionId, message.data);
        break;

      case "agui-event":
        // Forward AG-UI event to transport manager for SSE streaming
        if (this.config.verbose) {
          console.log(
            `[WorkerPool:${this.projectId}] AG-UI event from ${workerId}: ${message.event.type}`
          );
        }
        this.eventHandlers.onAgUiEvent?.(executionId, message.event);
        break;

      case "status":
        if (this.config.verbose) {
          console.log(
            `[WorkerPool:${this.projectId}] Worker ${workerId} status: ${message.status}`
          );
        }
        worker.status = "running";
        this.eventHandlers.onStatusChange?.(executionId, message.status);
        break;

      case "complete":
        if (this.config.verbose) {
          console.log(
            `[WorkerPool:${this.projectId}] Worker ${workerId} completed`
          );
        }
        worker.status = "completing";
        this.eventHandlers.onComplete?.(executionId, message.result);
        break;

      case "error":
        console.error(
          `[WorkerPool:${this.projectId}] Worker ${workerId} error:`,
          message.error
        );
        if (message.fatal) {
          worker.status = "failed";
        }
        this.eventHandlers.onError?.(
          executionId,
          message.error,
          message.fatal ?? false
        );
        break;
    }
  }

  /**
   * Handle worker process exit
   */
  private handleWorkerExit(
    worker: WorkerProcess,
    exitCode: number | null,
    signal: string | null
  ): void {
    const { executionId, workerId } = worker;

    // Remove worker from pool
    this.workers.delete(executionId);

    if (this.config.verbose) {
      console.log(`[WorkerPool:${this.projectId}] Worker ${workerId} exited:`, {
        exitCode,
        signal,
        status: worker.status,
      });
    }

    // Handle different exit scenarios
    if (exitCode === 0) {
      // Normal completion
      worker.status = "completed";
    } else if (exitCode === 1) {
      // Expected failure (execution failed)
      worker.status = "failed";
      this.eventHandlers.onError?.(executionId, "Execution failed", false);
    } else if (exitCode === 137 || signal === "SIGKILL") {
      // OOM killed or force killed
      worker.status = "failed";
      const error =
        exitCode === 137
          ? "Worker killed due to out-of-memory (OOM)"
          : `Worker killed with signal ${signal}`;
      console.warn(`[WorkerPool:${this.projectId}] ${error}`);
      this.eventHandlers.onCrash?.(executionId, exitCode, signal);
      this.eventHandlers.onError?.(executionId, error, true);
    } else if (signal) {
      // Signal termination (SIGTERM, SIGINT, etc.)
      worker.status = "failed";
      const error = `Worker terminated with signal ${signal}`;
      console.warn(`[WorkerPool:${this.projectId}] ${error}`);
      this.eventHandlers.onCrash?.(executionId, exitCode, signal);
      this.eventHandlers.onError?.(executionId, error, true);
    } else {
      // Unexpected exit code
      worker.status = "failed";
      const error = `Worker exited unexpectedly with code ${exitCode}`;
      console.error(`[WorkerPool:${this.projectId}] ${error}`);
      this.eventHandlers.onCrash?.(executionId, exitCode, signal);
      this.eventHandlers.onError?.(executionId, error, true);
    }
  }

  /**
   * Cancel execution (kill worker process)
   *
   * @param executionId - Execution ID to cancel
   */
  async cancelExecution(executionId: string): Promise<void> {
    const worker = this.workers.get(executionId);
    if (!worker) {
      throw new Error(`Worker for execution ${executionId} not found`);
    }

    if (this.config.verbose) {
      console.log(
        `[WorkerPool:${this.projectId}] Canceling execution ${executionId}`
      );
    }

    // Send cancel message to worker
    const cancelMessage: MainToWorkerMessage = {
      type: "cancel",
      executionId,
    };

    try {
      worker.process.send(cancelMessage);
    } catch (error) {
      console.warn(
        `[WorkerPool:${this.projectId}] Failed to send cancel message:`,
        error
      );
    }

    // Give worker 5 seconds to gracefully shut down
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (worker.process.pid) {
          if (this.config.verbose) {
            console.log(
              `[WorkerPool:${this.projectId}] Force killing worker ${worker.workerId}`
            );
          }
          worker.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      worker.process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      // Try graceful termination first
      if (worker.process.pid) {
        worker.process.kill("SIGTERM");
      }
    });
  }

  /**
   * Get active worker count
   */
  getActiveWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Get worker info for execution
   */
  getWorker(executionId: string): WorkerProcess | undefined {
    return this.workers.get(executionId);
  }

  /**
   * Check if execution is running in a worker
   */
  hasWorker(executionId: string): boolean {
    return this.workers.has(executionId);
  }

  /**
   * Shutdown pool - kill all workers
   */
  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;

    if (this.config.verbose) {
      console.log(
        `[WorkerPool:${this.projectId}] Shutting down pool with ${this.workers.size} active workers`
      );
    }

    // Kill all workers
    const killPromises = Array.from(this.workers.keys()).map((executionId) =>
      this.cancelExecution(executionId).catch((error) => {
        console.error(
          `[WorkerPool:${this.projectId}] Error killing worker:`,
          error
        );
      })
    );

    await Promise.all(killPromises);

    this.workers.clear();

    if (this.config.verbose) {
      console.log(`[WorkerPool:${this.projectId}] Pool shutdown complete`);
    }
  }
}
