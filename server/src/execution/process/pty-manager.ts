/**
 * PTY Process Manager
 *
 * Manages processes with pseudo-terminal (PTY) for interactive execution.
 * Enables full terminal interactivity with ANSI support and real-time I/O.
 *
 * @module execution/process/pty-manager
 */

import * as pty from 'node-pty';
import type { IProcessManager } from './manager.js';
import type {
  ProcessConfig,
  ManagedPtyProcess,
  ProcessMetrics,
  OutputHandler,
  ErrorHandler,
} from './types.js';
import { generateId } from './utils.js';

/**
 * PTY Process Manager
 *
 * Implements IProcessManager using PTY for interactive terminal execution.
 * Each process gets a pseudo-terminal with full ANSI support, enabling
 * interactive prompts, colored output, and real-time user input.
 *
 * @example
 * ```typescript
 * const manager = new PtyProcessManager();
 *
 * const process = await manager.acquireProcess({
 *   executablePath: 'claude',
 *   args: [],
 *   workDir: '/path/to/project',
 *   mode: 'interactive',
 *   terminal: {
 *     cols: 80,
 *     rows: 24,
 *   },
 * });
 *
 * process.onData((data) => {
 *   console.log('Terminal output:', data);
 * });
 *
 * process.write('help\n');
 * ```
 */
export class PtyProcessManager implements IProcessManager {
  private activeProcesses = new Map<string, ManagedPtyProcess>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();
  private metrics: ProcessMetrics = {
    totalSpawned: 0,
    currentlyActive: 0,
    totalCompleted: 0,
    totalFailed: 0,
    averageDuration: 0,
  };

  /**
   * Acquire a new PTY process
   *
   * Spawns a process with pseudo-terminal for interactive execution.
   *
   * @param config - Process configuration
   * @returns Managed PTY process
   */
  async acquireProcess(config: ProcessConfig): Promise<ManagedPtyProcess> {
    const id = generateId('pty');

    // Default terminal config
    const terminalConfig = {
      cols: config.terminal?.cols || 80,
      rows: config.terminal?.rows || 24,
      name: config.terminal?.name || 'xterm-256color',
      cwd: config.terminal?.cwd || config.workDir,
      env: {
        ...process.env,
        ...config.env,
      },
    };

    // Spawn PTY process
    const ptyProcess = pty.spawn(
      config.executablePath,
      config.args,
      terminalConfig
    );

    // Validate spawn
    if (!ptyProcess.pid) {
      throw new Error('Failed to spawn PTY process: no PID assigned');
    }

    // Create managed process
    const managedProcess: ManagedPtyProcess = {
      id,
      pid: ptyProcess.pid,
      status: 'busy',
      spawnedAt: new Date(),
      lastActivity: new Date(),
      exitCode: null,
      signal: null,
      ptyProcess,
      // PTY processes don't have ChildProcess/streams - use PTY API instead
      process: undefined,
      streams: undefined,
      metrics: {
        totalDuration: 0,
        tasksCompleted: 0,
        successRate: 1.0,
      },

      // PTY-specific methods
      write: (data: string) => {
        ptyProcess.write(data);
        managedProcess.lastActivity = new Date();
      },

      resize: (cols: number, rows: number) => {
        ptyProcess.resize(cols, rows);
      },

      onData: (callback: (data: string) => void) => {
        ptyProcess.onData(callback);
      },

      onExit: (callback: (exitCode: number, signal?: number) => void) => {
        ptyProcess.onExit((e) => callback(e.exitCode, e.signal));
      },
    };

    // Track process
    this.activeProcesses.set(id, managedProcess);

    // Update metrics
    this.metrics.totalSpawned++;
    this.metrics.currentlyActive++;

    // Set up lifecycle handlers
    this.setupProcessHandlers(managedProcess, config);

    return managedProcess;
  }

  /**
   * Set up lifecycle event handlers for a PTY process
   *
   * @param managedProcess - The managed PTY process
   * @param config - Process configuration
   */
  private setupProcessHandlers(
    managedProcess: ManagedPtyProcess,
    config: ProcessConfig
  ): void {
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Set up timeout if configured
    if (config.timeout) {
      timeoutHandle = setTimeout(() => {
        if (managedProcess.status === 'busy') {
          this.terminateProcess(managedProcess.id).catch(() => {
            // Ignore timeout termination errors
          });
        }
      }, config.timeout);
    }

    // Track data for activity
    managedProcess.ptyProcess.onData(() => {
      managedProcess.lastActivity = new Date();
    });

    // Handle exit
    managedProcess.ptyProcess.onExit((e) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      managedProcess.exitCode = e.exitCode;
      managedProcess.signal = e.signal ? String(e.signal) : null;
      managedProcess.status = e.exitCode === 0 ? 'completed' : 'crashed';

      // Calculate duration
      const duration = Date.now() - managedProcess.spawnedAt.getTime();
      managedProcess.metrics.totalDuration = duration;

      // Update metrics
      this.metrics.currentlyActive--;
      if (e.exitCode === 0) {
        this.metrics.totalCompleted++;
      } else {
        this.metrics.totalFailed++;
      }

      // Calculate average duration
      const totalProcesses =
        this.metrics.totalCompleted + this.metrics.totalFailed;
      if (totalProcesses > 0) {
        const currentTotal =
          this.metrics.averageDuration * (totalProcesses - 1);
        this.metrics.averageDuration = (currentTotal + duration) / totalProcesses;
      }

      // Schedule cleanup
      const cleanupTimer = setTimeout(() => {
        this.activeProcesses.delete(managedProcess.id);
        this.cleanupTimers.delete(managedProcess.id);
      }, 5000);
      this.cleanupTimers.set(managedProcess.id, cleanupTimer);
    });
  }

  /**
   * Release a PTY process
   *
   * @param processId - ID of the process to release
   */
  async releaseProcess(processId: string): Promise<void> {
    await this.terminateProcess(processId);
  }

  /**
   * Terminate a PTY process
   *
   * @param processId - ID of the process to terminate
   */
  async terminateProcess(processId: string): Promise<void> {
    const managed = this.activeProcesses.get(processId);
    if (!managed || managed.exitCode !== null) {
      return;
    }

    managed.status = 'terminating';

    // PTY doesn't have graceful shutdown like regular processes
    // Just kill immediately
    managed.ptyProcess.kill();

    // Wait for exit with timeout
    await Promise.race([
      new Promise<void>((resolve) => {
        if (managed.exitCode !== null) {
          resolve();
        } else {
          managed.ptyProcess.onExit(() => resolve());
        }
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  /**
   * Send input to a PTY process
   *
   * @param processId - ID of the process
   * @param input - Input string to send
   */
  async sendInput(processId: string, input: string): Promise<void> {
    const managed = this.activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }
    managed.write(input);
  }

  /**
   * Close input stream (no-op for PTY)
   *
   * PTY input is closed when process terminates.
   *
   * @param _processId - ID of the process (unused - no-op for PTY)
   */
  closeInput(_processId: string): void {
    // PTY input is closed when process terminates
    // This is a no-op to maintain interface compatibility
  }

  /**
   * Register output handler for a PTY process
   *
   * Note: PTY combines stdout/stderr, so all output is emitted as stdout.
   *
   * @param processId - ID of the process
   * @param handler - Output handler function
   */
  onOutput(processId: string, handler: OutputHandler): void {
    const managed = this.activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    // PTY combines stdout/stderr, so we only emit stdout
    managed.onData((data) => {
      handler(Buffer.from(data), 'stdout');
    });
  }

  /**
   * Register error handler for a PTY process
   *
   * Note: PTY doesn't have separate error events like ChildProcess.
   * Errors are typically communicated through exit codes.
   *
   * @param processId - ID of the process
   * @param handler - Error handler function
   */
  onError(processId: string, handler: ErrorHandler): void {
    const managed = this.activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    managed.onExit((exitCode) => {
      if (exitCode !== 0) {
        handler(new Error(`Process exited with code ${exitCode}`));
      }
    });
  }

  /**
   * Get a PTY process by ID
   *
   * @param processId - ID of the process
   * @returns Managed PTY process or null if not found
   */
  getProcess(processId: string): ManagedPtyProcess | null {
    return this.activeProcesses.get(processId) || null;
  }

  /**
   * Get all active PTY processes
   *
   * @returns Array of all active PTY processes
   */
  getActiveProcesses(): ManagedPtyProcess[] {
    return Array.from(this.activeProcesses.values());
  }

  /**
   * Get aggregate metrics
   *
   * @returns Process metrics
   */
  getMetrics(): ProcessMetrics {
    return { ...this.metrics };
  }

  /**
   * Shutdown the PTY manager
   *
   * Terminates all active processes and cleans up resources.
   */
  async shutdown(): Promise<void> {
    // Terminate all active processes
    const processIds = Array.from(this.activeProcesses.keys());
    await Promise.all(processIds.map((id) => this.terminateProcess(id)));

    // Clear all cleanup timers
    for (const [id, timer] of this.cleanupTimers.entries()) {
      clearTimeout(timer);
      this.cleanupTimers.delete(id);
    }
  }
}
