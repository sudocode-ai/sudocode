/**
 * Terminal Handler for ACP Agent Executions
 *
 * Provides basic passthrough handlers for terminal operations requested by ACP agents.
 * Creates pseudo-terminals, buffers output, and handles cleanup.
 *
 * @module execution/handlers/terminal-handler
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { CreateTerminalRequest, CreateTerminalResponse } from "acp-factory";

/**
 * Active terminal instance
 */
interface TerminalInstance {
  id: string;
  process: ChildProcessWithoutNullStreams;
  outputBuffer: string[];
  workDir: string;
  createdAt: Date;
  exitCode?: number;
  isExited: boolean;
}

/**
 * TerminalHandler
 *
 * Manages pseudo-terminal instances for agent tool calls.
 * Buffers output and tracks terminal lifecycle.
 */
export class TerminalHandler {
  private terminals: Map<string, TerminalInstance> = new Map();
  private idCounter = 0;

  constructor(private readonly workDir: string) {}

  /**
   * Create a new pseudo-terminal
   *
   * Spawns a shell process and sets up output buffering.
   *
   * @param params - Terminal creation parameters from ACP
   * @returns Terminal ID and metadata
   */
  async onCreate(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = `term-${++this.idCounter}-${Date.now()}`;

    // ACP CreateTerminalRequest has: command, args, cwd, env
    const cwd = params.cwd || this.workDir;

    console.log(
      `[TerminalHandler] Creating terminal ${terminalId}`,
      {
        command: params.command,
        args: params.args,
        cwd,
      }
    );

    // Always use shell to properly handle command strings
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c"] : ["-c"];

    // If command is provided, pass it to shell with -c
    // If args are provided, join them with the command
    let command: string;
    let args: string[];
    
    if (params.command) {
      command = shell;
      const fullCommand = params.args && params.args.length > 0
        ? `${params.command} ${params.args.join(" ")}`
        : params.command;
      args = [...shellArgs, fullCommand];
    } else {
      // No command provided, just spawn a shell
      command = shell;
      args = [];
    }

    // Merge environment - only keep string values
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
    if (params.env) {
      for (const [key, value] of Object.entries(params.env)) {
        if (typeof value === "string") {
          env[key] = value;
        }
      }
    }

    // Spawn the process
    const proc = spawn(command, args, {
      cwd,
      env,
      shell: false, // Spawn the binary directly (shell is already /bin/sh with -c args)
    });

    // Create terminal instance
    const terminal: TerminalInstance = {
      id: terminalId,
      process: proc,
      outputBuffer: [],
      workDir: cwd,
      createdAt: new Date(),
      isExited: false,
    };

    // Buffer stdout
    proc.stdout.on("data", (data: Buffer) => {
      terminal.outputBuffer.push(data.toString());
    });

    // Buffer stderr (combined with stdout for simplicity)
    proc.stderr.on("data", (data: Buffer) => {
      terminal.outputBuffer.push(data.toString());
    });

    // Track exit
    proc.on("exit", (code: number | null) => {
      terminal.exitCode = code ?? 1;
      terminal.isExited = true;
      console.log(`[TerminalHandler] Terminal ${terminalId} exited with code ${code}`);
    });

    proc.on("error", (error: Error) => {
      terminal.outputBuffer.push(`Error: ${error.message}\n`);
      terminal.isExited = true;
      console.error(`[TerminalHandler] Terminal ${terminalId} error:`, error);
    });

    this.terminals.set(terminalId, terminal);

    // Return in format matching CreateTerminalResponse
    return {
      terminalId,
    };
  }

  /**
   * Get buffered output from a terminal
   *
   * Returns all buffered output and clears the buffer.
   *
   * @param terminalId - Terminal ID
   * @returns Buffered output text
   */
  async onOutput(terminalId: string): Promise<string> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      console.warn(`[TerminalHandler] Terminal ${terminalId} not found`);
      return "";
    }

    // Drain the buffer
    const output = terminal.outputBuffer.join("");
    terminal.outputBuffer = [];

    return output;
  }

  /**
   * Kill a terminal
   *
   * Terminates the process and cleans up resources.
   *
   * @param terminalId - Terminal ID to kill
   */
  async onKill(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      console.warn(`[TerminalHandler] Terminal ${terminalId} not found for kill`);
      return;
    }

    console.log(`[TerminalHandler] Killing terminal ${terminalId}`);

    if (!terminal.isExited) {
      terminal.process.kill("SIGTERM");

      // Force kill if still running after grace period
      setTimeout(() => {
        if (!terminal.isExited) {
          terminal.process.kill("SIGKILL");
        }
      }, 1000);
    }

    this.terminals.delete(terminalId);
  }

  /**
   * Release a terminal
   *
   * Releases resources without killing the process.
   * Used when the agent no longer needs the terminal but wants it to continue.
   *
   * @param terminalId - Terminal ID to release
   */
  async onRelease(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      console.warn(`[TerminalHandler] Terminal ${terminalId} not found for release`);
      return;
    }

    console.log(`[TerminalHandler] Releasing terminal ${terminalId}`);

    // Don't kill, just remove from tracking
    this.terminals.delete(terminalId);
  }

  /**
   * Wait for a terminal to exit
   *
   * Returns the exit code when the process terminates.
   *
   * @param terminalId - Terminal ID to wait for
   * @returns Exit code
   */
  async onWaitForExit(terminalId: string): Promise<number> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      console.warn(`[TerminalHandler] Terminal ${terminalId} not found for wait`);
      return 1;
    }

    // If already exited, return immediately
    if (terminal.isExited) {
      return terminal.exitCode ?? 1;
    }

    // Wait for exit
    return new Promise((resolve) => {
      terminal.process.on("exit", (code) => {
        resolve(code ?? 1);
      });

      terminal.process.on("error", () => {
        resolve(1);
      });
    });
  }

  /**
   * Clean up all terminals
   *
   * Called when the execution is being cleaned up.
   */
  cleanup(): void {
    console.log(`[TerminalHandler] Cleaning up ${this.terminals.size} terminals`);

    for (const [terminalId, terminal] of this.terminals) {
      if (!terminal.isExited) {
        terminal.process.kill("SIGTERM");
      }
      this.terminals.delete(terminalId);
    }
  }
}
