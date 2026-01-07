/**
 * IPC Message Type Definitions for Worker Pool
 *
 * Defines the message protocol for bidirectional communication between
 * main server process and worker processes.
 *
 * @module workers/worker-ipc
 */

import type { ExecutionStatus } from "@sudocode-ai/types";
// SessionUpdate events from ACP (agent_message_chunk, tool_call, etc.)
// We use `any` here since we're just forwarding them via IPC

/**
 * Output event from worker (logs, status updates)
 */
export interface OutputEvent {
  type: "stdout" | "stderr" | "log";
  data: string;
  timestamp: string;
}

/**
 * Execution result upon completion
 */
export interface ExecutionResult {
  status: ExecutionStatus;
  exitCode?: number;
  error?: string;
  completedAt: string;
}

/**
 * Messages sent from Worker → Main Process
 */
export type WorkerToMainMessage =
  | {
      type: "ready";
      executionId: string;
      workerId: string;
    }
  | {
      type: "log";
      executionId: string;
      data: OutputEvent;
    }
  | {
      type: "session-update";
      executionId: string;
      event: any; // SessionUpdate event from ACP
    }
  | {
      type: "status";
      executionId: string;
      status: ExecutionStatus;
    }
  | {
      type: "complete";
      executionId: string;
      result: ExecutionResult;
    }
  | {
      type: "error";
      executionId: string;
      error: string;
      fatal?: boolean;
    };

/**
 * Messages sent from Main Process → Worker
 */
export type MainToWorkerMessage =
  | {
      type: "cancel";
      executionId: string;
    }
  | {
      type: "ping";
    };

/**
 * Worker environment configuration
 */
export interface WorkerEnv {
  EXECUTION_ID: string;
  PROJECT_ID: string;
  REPO_PATH: string;
  DB_PATH: string;
  MAX_MEMORY_MB?: string;
  WORKER_ID: string;
}

/**
 * Type guard for WorkerToMainMessage
 */
export function isWorkerMessage(msg: any): msg is WorkerToMainMessage {
  return (
    msg &&
    typeof msg === "object" &&
    "type" in msg &&
    typeof msg.type === "string" &&
    ["ready", "log", "session-update", "status", "complete", "error"].includes(
      msg.type
    )
  );
}

/**
 * Type guard for MainToWorkerMessage
 */
export function isMainMessage(msg: any): msg is MainToWorkerMessage {
  return (
    msg &&
    typeof msg === "object" &&
    "type" in msg &&
    typeof msg.type === "string" &&
    ["cancel", "ping"].includes(msg.type)
  );
}
