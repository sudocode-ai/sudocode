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
  OutputEvent,
  ExecutionResult,
} from "./worker-ipc.js";
import { isMainMessage } from "./worker-ipc.js";
import {
  SimpleProcessManager,
  SimpleExecutionEngine,
  ResilientExecutor,
  LinearOrchestrator,
  type WorkflowDefinition,
} from "agent-execution-engine";
import { createAgUiSystem } from "../execution/output/ag-ui-integration.js";
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
 */
function sendLog(data: OutputEvent): void {
  sendToMain({
    type: "log",
    executionId: EXECUTION_ID!,
    data,
  });
}

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
  let orchestrator: LinearOrchestrator | null = null;

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

    // 6. Build workflow definition
    const workflow: WorkflowDefinition = {
      id: `workflow-${execution.id}`,
      steps: [
        {
          id: "execute-issue",
          taskType: "issue",
          prompt,
          taskConfig: {
            model: config.model || "claude-sonnet-4",
            timeout: config.timeout,
            captureFileChanges: config.captureFileChanges ?? true,
            captureToolCalls: config.captureToolCalls ?? true,
          },
        },
      ],
      config: {
        checkpointInterval: config.checkpointInterval ?? 1,
        continueOnStepFailure: config.continueOnStepFailure ?? false,
        timeout: config.timeout,
      },
      metadata: {
        workDir,
        issueId: execution.issue_id,
        executionId: execution.id,
      },
    };

    // 7. Create execution engine stack
    const processManager = new SimpleProcessManager();

    // Create AG-UI system for output processing
    const agUiSystem = createAgUiSystem(execution.id);

    // Bridge AG-UI events to IPC - forward all events from adapter to main process
    agUiSystem.adapter.onEvent((event) => {
      console.log(`[Worker:${WORKER_ID}] AG-UI event: ${event.type}`);
      sendToMain({
        type: "agui-event",
        executionId: EXECUTION_ID!,
        event,
      });
    });

    // Buffer for incomplete lines (stream-json can split mid-line)
    let lineBuffer = "";

    const claudeArgs = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    console.log(`[Worker:${WORKER_ID}] Claude CLI args:`, claudeArgs);

    // NOTE: The orchestrator is supposed to handle converting workflow steps to tasks
    // and passing the prompt to the process. The issue is that the generic engine
    // doesn't know how to pass Claude-specific prompts. We need to add the prompt
    // as the last CLI argument, which requires modifying the args per task.
    // For now, we'll add the prompt to defaultProcessConfig args.
    const argsWithPrompt = [...claudeArgs, prompt];
    console.log(
      `[Worker:${WORKER_ID}] Final Claude args (with prompt):`,
      argsWithPrompt.length,
      "args"
    );

    const engine = new SimpleExecutionEngine(processManager, {
      maxConcurrent: 1,
      defaultProcessConfig: {
        executablePath: "claude",
        args: argsWithPrompt,
        workDir: workDir,
      },
      onOutput: (data, type) => {
        if (type === "stdout") {
          const chunk = data.toString();
          // Append new data to buffer
          lineBuffer += chunk;

          // Process complete lines (ending with \n)
          let newlineIndex;
          while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
            const line = lineBuffer.slice(0, newlineIndex);
            lineBuffer = lineBuffer.slice(newlineIndex + 1);

            if (line.trim()) {
              // Send raw log to main process
              sendLog({
                type: "log",
                data: line,
                timestamp: new Date().toISOString(),
              });

              // Process through AG-UI pipeline
              agUiSystem.processor.processLine(line).catch((err) => {
                console.error("[Worker] Error processing output line:", err);
              });
            }
          }
        } else if (type === "stderr") {
          const stderrData = data.toString();
          // Send stderr directly
          sendLog({
            type: "stderr",
            data: stderrData,
            timestamp: new Date().toISOString(),
          });
        }
      },
    });

    const executor = new ResilientExecutor(engine);

    // 8. Create orchestrator
    orchestrator = new LinearOrchestrator(
      executor,
      undefined, // No storage/checkpointing
      agUiSystem.adapter,
      undefined // No lifecycle service in worker
    );

    // 9. Set up event handlers
    orchestrator.onWorkflowStart(() => {
      console.log(`[Worker:${WORKER_ID}] Workflow started`);
      updateExecution(db!, execution.id, { status: "running" });
      sendStatus("running");

      // Emit RUN_STARTED event
      agUiSystem.adapter.emitRunStarted({
        model: config.model || "claude-sonnet-4",
        executionId: execution.id,
      });
    });

    orchestrator.onWorkflowComplete(() => {
      console.log(`[Worker:${WORKER_ID}] Workflow completed successfully`);

      // Emit RUN_FINISHED event
      agUiSystem.adapter.emitRunFinished();

      updateExecution(db!, execution.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      sendComplete({
        status: "completed",
        exitCode: 0,
        completedAt: new Date().toISOString(),
      });
    });

    orchestrator.onWorkflowFailed((_executionId, error) => {
      console.error(`[Worker:${WORKER_ID}] Workflow failed:`, error);
      updateExecution(db!, execution.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error.message,
      });

      sendComplete({
        status: "failed",
        exitCode: 1,
        error: error.message,
        completedAt: new Date().toISOString(),
      });
    });

    // 10. Start workflow execution (blocking)
    console.log(`[Worker:${WORKER_ID}] Starting workflow execution...`);
    console.log(`[Worker:${WORKER_ID}] Work directory: ${workDir}`);
    console.log(
      `[Worker:${WORKER_ID}] Workflow config:`,
      JSON.stringify(workflow.config)
    );

    const startTime = Date.now();
    await orchestrator.startWorkflow(workflow, workDir, {
      checkpointInterval: config.checkpointInterval,
      executionId: execution.id,
    });
    const duration = Date.now() - startTime;
    console.log(`[Worker:${WORKER_ID}] Workflow completed in ${duration}ms`);

    // 11. Check if cancellation was requested
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
    }

    console.log(`[Worker:${WORKER_ID}] Execution completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Worker:${WORKER_ID}] Execution failed:`, errorMessage);

    // Try to update database if connection exists
    if (db) {
      try {
        updateExecution(db, EXECUTION_ID!, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        });
      } catch (dbError) {
        console.error(
          `[Worker:${WORKER_ID}] Failed to update database:`,
          dbError
        );
      }
    }

    // Send error to main process
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
