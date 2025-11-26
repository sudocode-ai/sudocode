/**
 * Execution Worker Process Entry Point
 *
 * Standalone Node.js process that runs Claude Code executions in isolation.
 * Communicates with main process via IPC (Inter-Process Communication).
 *
 * Environment Variables:
 * - EXECUTION_ID: Execution record ID
 * - PROJECT_ID: Project identifier
 * - REPO_PATH: Path to git repository
 * - DB_PATH: Path to SQLite database
 * - WORKER_ID: Unique worker identifier
 * - MAX_MEMORY_MB: Memory limit (for logging)
 *
 * @module workers/execution-worker
 */

import Database from "better-sqlite3";
import type { Execution } from "@sudocode-ai/types";
import type {
  WorkerToMainMessage,
  ExecutionResult,
} from "./worker-ipc.js";
import { isMainMessage } from "./worker-ipc.js";
import type { ExecutionTask } from "agent-execution-engine/engine";
import { createExecutorForAgent } from "../execution/executors/executor-factory.js";
import { ExecutionLifecycleService } from "../services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../services/execution-logs-store.js";
import { IpcTransportManager } from "../execution/transport/ipc-transport-manager.js";
import { getExecution, updateExecution } from "../services/executions.js";

// Validate required environment variables
const EXECUTION_ID = process.env.EXECUTION_ID;
const PROJECT_ID = process.env.PROJECT_ID;
const REPO_PATH = process.env.REPO_PATH;
const DB_PATH = process.env.DB_PATH;
const WORKER_ID = process.env.WORKER_ID;
const MAX_MEMORY_MB = process.env.MAX_MEMORY_MB;

if (!EXECUTION_ID || !PROJECT_ID || !REPO_PATH || !DB_PATH || !WORKER_ID) {
  console.error("[Worker] Missing required environment variables");
  process.exit(1);
}

console.log(
  `[Worker:${WORKER_ID}] Starting execution worker for ${EXECUTION_ID}`
);

/**
 * Send IPC message to main process
 */
function sendToMain(message: WorkerToMainMessage): void {
  if (!process.send) {
    console.error("[Worker] IPC not available (process.send is undefined)");
    return;
  }

  try {
    process.send(message);
  } catch (error) {
    console.error("[Worker] Failed to send IPC message:", error);
  }
}

/**
 * Send log event to main process
 * Note: Currently unused as AgentExecutorWrapper handles log storage directly.
 * Kept for backward compatibility with IPC protocol.
 */
// function sendLog(data: OutputEvent): void {
//   sendToMain({
//     type: "log",
//     executionId: EXECUTION_ID!,
//     data,
//   });
// }

/**
 * Send status update to main process
 */
function sendStatus(status: string): void {
  sendToMain({
    type: "status",
    executionId: EXECUTION_ID!,
    status: status as any,
  });
}

/**
 * Send completion result to main process
 */
function sendComplete(result: ExecutionResult): void {
  sendToMain({
    type: "complete",
    executionId: EXECUTION_ID!,
    result,
  });
}

/**
 * Send error to main process
 */
function sendError(error: string, fatal: boolean = false): void {
  sendToMain({
    type: "error",
    executionId: EXECUTION_ID!,
    error,
    fatal,
  });
}

/**
 * Flag to track if execution should be canceled
 */
let cancelRequested = false;

/**
 * Listen for messages from main process
 */
process.on("message", (message: any) => {
  if (!isMainMessage(message)) {
    console.warn("[Worker] Received invalid message from main:", message);
    return;
  }

  switch (message.type) {
    case "cancel":
      console.log(`[Worker:${WORKER_ID}] Cancel requested`);
      cancelRequested = true;
      // Orchestrator will handle graceful cancellation
      break;

    case "ping":
      // Health check - just acknowledge
      console.log(`[Worker:${WORKER_ID}] Ping received`);
      break;
  }
});

/**
 * Main execution function
 */
async function runExecution(): Promise<void> {
  let db: Database.Database | null = null;

  try {
    // 1. Initialize database connection
    console.log(`[Worker:${WORKER_ID}] Connecting to database: ${DB_PATH}`);
    db = new Database(DB_PATH!);

    // 2. Load execution record
    const execution = getExecution(db, EXECUTION_ID!) as Execution | null;
    if (!execution) {
      throw new Error(`Execution ${EXECUTION_ID} not found in database`);
    }

    console.log(`[Worker:${WORKER_ID}] Loaded execution:`, {
      id: execution.id,
      issueId: execution.issue_id,
      mode: execution.mode,
      status: execution.status,
    });

    // 3. Parse execution config
    const config = execution.config ? JSON.parse(execution.config) : {};
    const prompt = execution.prompt || "";

    if (!prompt.trim()) {
      throw new Error("Execution prompt is empty");
    }

    // 4. Determine work directory
    const workDir =
      execution.mode === "worktree"
        ? execution.worktree_path || REPO_PATH!
        : REPO_PATH!;

    console.log(`[Worker:${WORKER_ID}] Work directory: ${workDir}`);

    // 5. Send ready signal
    sendToMain({
      type: "ready",
      executionId: EXECUTION_ID!,
      workerId: WORKER_ID!,
    });

    // 6. Create services for AgentExecutorWrapper
    const lifecycleService = new ExecutionLifecycleService(db, REPO_PATH!);
    const logsStore = new ExecutionLogsStore(db);

    // 7. Create IPC transport manager to forward AG-UI events
    const ipcTransport = new IpcTransportManager(EXECUTION_ID!);

    // 8. Determine agent type (default to claude-code for backwards compatibility)
    const agentType = config.agentType || "claude-code";

    // 9. Create executor using factory
    const wrapper = createExecutorForAgent(
      agentType,
      { workDir: REPO_PATH!, ...config },
      {
        workDir: REPO_PATH!,
        lifecycleService,
        logsStore,
        projectId: PROJECT_ID!,
        db,
        transportManager: ipcTransport as any, // IpcTransportManager matches interface
      }
    );

    // 10. Build execution task
    const task: ExecutionTask = {
      id: execution.id,
      type: "issue",
      entityId: execution.issue_id || undefined,
      prompt: prompt,
      workDir: workDir,
      config: {
        timeout: config.timeout,
      },
      metadata: {
        model: config.model || "claude-sonnet-4",
        captureFileChanges: config.captureFileChanges ?? true,
        captureToolCalls: config.captureToolCalls ?? true,
        issueId: execution.issue_id,
        executionId: execution.id,
      },
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
    };

    // 11. Update status to running
    console.log(`[Worker:${WORKER_ID}] Starting execution with AgentExecutorWrapper (${agentType})`);
    sendStatus("running");

    // 12. Execute with lifecycle management (blocking)
    const startTime = Date.now();
    await wrapper.executeWithLifecycle(execution.id, task, workDir);
    const duration = Date.now() - startTime;
    console.log(`[Worker:${WORKER_ID}] Execution completed in ${duration}ms`);

    // 13. Check if cancellation was requested
    if (cancelRequested) {
      console.log(`[Worker:${WORKER_ID}] Execution was cancelled`);
      updateExecution(db, execution.id, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
      });

      sendComplete({
        status: "cancelled",
        exitCode: 0,
        completedAt: new Date().toISOString(),
      });
    } else {
      // Send completion (wrapper already updated DB and broadcast)
      sendComplete({
        status: "completed",
        exitCode: 0,
        completedAt: new Date().toISOString(),
      });
    }

    console.log(`[Worker:${WORKER_ID}] Execution completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Worker:${WORKER_ID}] Execution failed:`, errorMessage);

    // Wrapper already updated DB and broadcast, just send IPC message
    sendError(errorMessage, true);

    // Exit with failure code
    process.exit(1);
  } finally {
    // Clean up database connection
    if (db) {
      try {
        db.close();
        console.log(`[Worker:${WORKER_ID}] Database connection closed`);
      } catch (error) {
        console.error(`[Worker:${WORKER_ID}] Error closing database:`, error);
      }
    }
  }
}

/**
 * Global error handlers
 */
process.on("uncaughtException", (error) => {
  console.error(`[Worker:${WORKER_ID}] Uncaught exception:`, error);
  sendError(`Uncaught exception: ${error.message}`, true);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[Worker:${WORKER_ID}] Unhandled rejection:`, reason);
  sendError(`Unhandled rejection: ${String(reason)}`, true);
  process.exit(1);
});

/**
 * Graceful shutdown handlers
 */
process.on("SIGTERM", () => {
  console.log(
    `[Worker:${WORKER_ID}] Received SIGTERM, shutting down gracefully`
  );
  cancelRequested = true;
  // Let the orchestrator handle graceful shutdown
  setTimeout(() => {
    console.log(`[Worker:${WORKER_ID}] Force exit after grace period`);
    process.exit(0);
  }, 5000);
});

process.on("SIGINT", () => {
  console.log(
    `[Worker:${WORKER_ID}] Received SIGINT, shutting down gracefully`
  );
  cancelRequested = true;
  setTimeout(() => {
    process.exit(0);
  }, 5000);
});

// Start execution
console.log(`[Worker:${WORKER_ID}] Worker process initialized`);
console.log(
  `[Worker:${WORKER_ID}] Memory limit: ${MAX_MEMORY_MB || "default"} MB`
);
console.log(`[Worker:${WORKER_ID}] PID: ${process.pid}`);

runExecution()
  .then(() => {
    console.log(`[Worker:${WORKER_ID}] Worker exiting normally`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`[Worker:${WORKER_ID}] Worker exiting with error:`, error);
    process.exit(1);
  });
