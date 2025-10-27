/**
 * ExecutionManager - Manages agent process lifecycle
 *
 * Responsibilities:
 * - Spawn and track agent processes
 * - Monitor process lifecycle events
 * - Write logs to temp files
 * - Update database with status changes
 * - Handle cleanup and termination
 */

import type Database from "better-sqlite3";
import type { AgentType, Execution } from "@sudocode/types";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  createExecution,
  getExecution,
  updateExecution,
} from "../services/executions.js";
import { spawnClaudeCode } from "./spawn-claude-code.js";

/**
 * Represents a running execution with its process and log files
 */
interface RunningExecution {
  process: ChildProcess;
  logFile: string;
  startTime: number;
}

/**
 * Input for starting a new execution
 */
export interface StartExecutionInput {
  issue_id: string;
  agent_type: AgentType;
  work_dir?: string;
  prompt?: string;
  before_commit?: string;
  target_branch?: string;
  worktree_path?: string;
}

/**
 * ExecutionManager class
 */
export class ExecutionManager {
  private db: Database.Database;
  private runningExecutions: Map<string, RunningExecution>;
  private logsDir: string;
  private testMode: boolean;

  constructor(db: Database.Database, logsDir?: string, testMode?: boolean) {
    this.db = db;
    this.runningExecutions = new Map();
    this.logsDir = logsDir || path.join(os.tmpdir(), "sudocode-executions");
    this.testMode = testMode || false;

    // Ensure logs directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Start a new execution
   */
  async startExecution(input: StartExecutionInput): Promise<Execution> {
    // Create execution record in database
    const execution = createExecution(this.db, {
      issue_id: input.issue_id,
      agent_type: input.agent_type,
      before_commit: input.before_commit,
      target_branch: input.target_branch,
      worktree_path: input.worktree_path,
    });

    try {
      // Spawn the agent process
      const workDir = input.work_dir || process.cwd();
      const prompt = input.prompt || `Work on issue ${input.issue_id}`;
      const proc = this.spawnAgent(execution.agent_type, workDir, prompt);

      // Create log file for this execution
      const logFile = path.join(this.logsDir, `${execution.id}.log`);
      const logStream = fs.createWriteStream(logFile, { flags: "a" });

      // Pipe stdout and stderr to log file
      proc.stdout?.pipe(logStream);
      proc.stderr?.pipe(logStream);

      // Track the running execution
      this.runningExecutions.set(execution.id, {
        process: proc,
        logFile,
        startTime: Date.now(),
      });

      // Set up process lifecycle handlers
      this.setupProcessHandlers(execution.id, proc);

      return execution;
    } catch (error) {
      // If spawning failed, mark execution as failed
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      updateExecution(this.db, execution.id, {
        status: "failed",
        completed_at: Math.floor(Date.now() / 1000),
        error_message: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Stop a running execution
   */
  async stopExecution(executionId: string): Promise<Execution> {
    const running = this.runningExecutions.get(executionId);

    if (!running) {
      throw new Error(`Execution ${executionId} is not running`);
    }

    // Kill the process
    running.process.kill("SIGTERM");

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill if still alive
    if (!running.process.killed) {
      running.process.kill("SIGKILL");
    }

    // Update database
    const execution = updateExecution(this.db, executionId, {
      status: "stopped",
      completed_at: Math.floor(Date.now() / 1000),
    });

    // Clean up
    this.runningExecutions.delete(executionId);

    return execution;
  }

  /**
   * Get execution status
   */
  getExecutionStatus(executionId: string): Execution | null {
    return getExecution(this.db, executionId);
  }

  /**
   * Get log file path for an execution
   */
  getLogFilePath(executionId: string): string {
    const running = this.runningExecutions.get(executionId);
    if (running) {
      return running.logFile;
    }

    // Return expected path even if not running
    return path.join(this.logsDir, `${executionId}.log`);
  }

  /**
   * Check if an execution is currently running
   */
  isRunning(executionId: string): boolean {
    return this.runningExecutions.has(executionId);
  }

  /**
   * Get all currently running execution IDs
   */
  getRunningExecutionIds(): string[] {
    return Array.from(this.runningExecutions.keys());
  }

  /**
   * Cleanup all running executions (e.g., on server shutdown)
   */
  async cleanup(): Promise<void> {
    const executionIds = this.getRunningExecutionIds();
    await Promise.all(
      executionIds.map((id) => this.stopExecution(id).catch(() => {}))
    );
  }

  /**
   * Spawn an agent process based on agent type
   */
  private spawnAgent(
    agentType: AgentType,
    workDir: string,
    prompt: string
  ): ChildProcess {
    // In test mode, use fast placeholder commands instead of real processes
    if (this.testMode) {
      switch (agentType) {
        case "claude-code":
          return spawn("echo", ["Claude Code agent running"], { cwd: workDir });
        case "codex":
          return spawn("echo", ["Codex agent running"], { cwd: workDir });
        default:
          throw new Error(`Unsupported agent type: ${agentType}`);
      }
    }

    // Production mode: use real agent implementations
    switch (agentType) {
      case "claude-code":
        // Use the spawnClaudeCode utility for real Claude Code spawning
        return spawnClaudeCode({
          workDir,
          prompt,
          verbose: true,
        });

      case "codex":
        // Placeholder for codex (not implemented yet)
        return spawn("echo", ["Codex agent running"], { cwd: workDir });

      default:
        throw new Error(`Unsupported agent type: ${agentType}`);
    }
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(
    executionId: string,
    proc: ChildProcess
  ): void {
    proc.on("exit", (code, signal) => {
      const running = this.runningExecutions.get(executionId);
      if (!running) return;

      // Determine final status
      const status = code === 0 ? "completed" : "failed";
      const errorMessage =
        code !== 0
          ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`
          : null;

      // Update database
      updateExecution(this.db, executionId, {
        status,
        completed_at: Math.floor(Date.now() / 1000),
        exit_code: code,
        error_message: errorMessage,
      });

      // Clean up
      this.runningExecutions.delete(executionId);
    });

    proc.on("error", (error) => {
      const running = this.runningExecutions.get(executionId);
      if (!running) return;

      // Update database with error
      updateExecution(this.db, executionId, {
        status: "failed",
        completed_at: Math.floor(Date.now() / 1000),
        error_message: error.message,
      });

      // Clean up
      this.runningExecutions.delete(executionId);
    });
  }
}
