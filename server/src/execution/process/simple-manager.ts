/**
 * Simple Process Manager Implementation
 *
 * A straightforward implementation of IProcessManager that spawns a fresh
 * process for each task. This is the "simple first" approach that will later
 * be upgraded to support process pooling.
 *
 * Supports any CLI tool/agent (Claude Code, Codex, Gemini CLI, etc.)
 *
 * Key features:
 * - One process per task (no pooling)
 * - Event-based I/O streaming
 * - Graceful termination (SIGTERM → SIGKILL)
 * - Automatic cleanup
 * - Metrics tracking
 * - Agent-agnostic design
 *
 * @module execution/process/simple-manager
 */

import { spawn } from 'child_process';
import type {
  ManagedProcess,
  ProcessConfig,
  ProcessMetrics,
  OutputHandler,
  ErrorHandler,
} from './types.js';
import type { IProcessManager } from './manager.js';
import { generateId } from './utils.js';

/**
 * Simple process manager that spawns one process per task
 *
 * This implementation follows the "simple first" principle - it provides
 * a production-ready process manager without the complexity of pooling.
 *
 * Works with any CLI tool/agent by accepting executable path and args.
 *
 * @example
 * ```typescript
 * // Claude Code example
 * const manager = new SimpleProcessManager({
 *   executablePath: 'claude',
 *   args: ['--print', '--output-format', 'stream-json'],
 * });
 *
 * const process = await manager.acquireProcess({
 *   executablePath: 'claude',
 *   args: ['--print', '--output-format', 'stream-json'],
 *   workDir: '/path/to/project',
 *   timeout: 300000,
 * });
 *
 * // Codex example
 * const codexProcess = await manager.acquireProcess({
 *   executablePath: 'codex',
 *   args: ['--mode', 'agent', '--json'],
 *   workDir: '/path/to/project',
 * });
 * ```
 */
export class SimpleProcessManager implements IProcessManager {
  private _activeProcesses = new Map<string, ManagedProcess>();
  private _cleanupTimers = new Map<string, NodeJS.Timeout>();
  private _metrics: ProcessMetrics = {
    totalSpawned: 0,
    currentlyActive: 0,
    totalCompleted: 0,
    totalFailed: 0,
    averageDuration: 0,
  };

  /**
   * Create a new SimpleProcessManager
   *
   * @param defaultConfig - Default configuration to merge with per-process config
   */
  constructor(private readonly _defaultConfig: Partial<ProcessConfig> = {}) {}

  async acquireProcess(config: ProcessConfig): Promise<ManagedProcess> {
    // Merge with default config
    const mergedConfig = { ...this._defaultConfig, ...config };

    // Spawn the process
    const childProcess = this.spawnProcess(mergedConfig);

    // Validate process spawned successfully
    if (!childProcess.pid) {
      // Suppress error event to prevent uncaughtException
      childProcess.once('error', () => {
        // Error is expected when process fails to spawn
      });
      throw new Error('Failed to spawn process: no PID assigned');
    }

    // Generate unique ID for this process
    const id = generateId('process');

    // Create managed process object
    const managedProcess: ManagedProcess = {
      id,
      pid: childProcess.pid,
      status: 'busy',
      spawnedAt: new Date(),
      lastActivity: new Date(),
      exitCode: null,
      signal: null,
      process: childProcess,
      streams: {
        stdout: childProcess.stdout!,
        stderr: childProcess.stderr!,
        stdin: childProcess.stdin!,
      },
      metrics: {
        totalDuration: 0,
        tasksCompleted: 0,
        successRate: 1.0,
      },
    };

    // Track the process
    this._activeProcesses.set(id, managedProcess);

    // Update metrics
    this._metrics.totalSpawned++;
    this._metrics.currentlyActive++;

    // Set up event handlers for lifecycle management
    this.setupProcessHandlers(managedProcess, mergedConfig);

    return managedProcess;
  }

  /**
   * Spawn a process with the given configuration
   *
   * @param config - Process configuration
   * @returns ChildProcess instance
   */
  private spawnProcess(config: ProcessConfig): ReturnType<typeof spawn> {
    const childProcess = spawn(config.executablePath, config.args, {
      cwd: config.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...config.env,
      },
    });

    return childProcess;
  }

  /**
   * Set up event handlers for a managed process
   *
   * Handles lifecycle events:
   * - exit: Process terminated normally or abnormally
   * - error: Process encountered an error
   * - stdout/stderr data: Track activity for idle detection
   *
   * @param managedProcess - The managed process to set up handlers for
   * @param config - Process configuration (for timeout)
   */
  private setupProcessHandlers(
    managedProcess: ManagedProcess,
    config: ProcessConfig
  ): void {
    const { process: childProcess, id } = managedProcess;
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Set up timeout if configured
    if (config.timeout) {
      timeoutHandle = setTimeout(() => {
        // Terminate process on timeout using graceful termination
        if (managedProcess.status === 'busy') {
          this.terminateProcess(id).catch(() => {
            // Ignore errors during timeout termination
          });
        }
      }, config.timeout);
    }

    // Exit event handler
    childProcess.once('exit', (code, signal) => {
      // Clear timeout
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Update process state
      managedProcess.exitCode = code;
      managedProcess.signal = signal;
      managedProcess.status = code === 0 ? 'completed' : 'crashed';

      // Calculate duration
      const duration = Date.now() - managedProcess.spawnedAt.getTime();
      managedProcess.metrics.totalDuration = duration;

      // Update global metrics
      this._metrics.currentlyActive--;
      if (code === 0) {
        this._metrics.totalCompleted++;
      } else {
        this._metrics.totalFailed++;
      }

      // Calculate average duration
      const totalProcesses =
        this._metrics.totalCompleted + this._metrics.totalFailed;
      if (totalProcesses > 0) {
        const currentTotal = this._metrics.averageDuration * (totalProcesses - 1);
        this._metrics.averageDuration = (currentTotal + duration) / totalProcesses;
      }

      // Schedule cleanup (delete from activeProcesses after 5s delay)
      const cleanupTimer = setTimeout(() => {
        this._activeProcesses.delete(id);
        this._cleanupTimers.delete(id);
      }, 5000);
      this._cleanupTimers.set(id, cleanupTimer);
    });

    // Error event handler
    childProcess.once('error', (error) => {
      void error; // Error is logged but not used here

      // Clear timeout
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Update process state
      managedProcess.status = 'crashed';

      // Update global metrics
      this._metrics.currentlyActive--;
      this._metrics.totalFailed++;
    });

    // stdout data handler - track activity
    childProcess.stdout?.on('data', () => {
      managedProcess.lastActivity = new Date();
    });

    // stderr data handler - track activity
    childProcess.stderr?.on('data', () => {
      managedProcess.lastActivity = new Date();
    });
  }

  async releaseProcess(processId: string): Promise<void> {
    await this.terminateProcess(processId);
  }

  async terminateProcess(
    processId: string,
    signal: NodeJS.Signals = 'SIGTERM'
  ): Promise<void> {
    const managed = this._activeProcesses.get(processId);
    if (!managed) {
      return; // Process not found, nothing to terminate
    }

    // If already terminated, do nothing (idempotent)
    if (managed.exitCode !== null) {
      return;
    }

    // Update status to terminating
    managed.status = 'terminating';

    // Try graceful shutdown first
    managed.process.kill(signal);

    // Wait for process to exit (with 2 second timeout)
    const exitPromise = new Promise<void>((resolve) => {
      if (managed.exitCode !== null) {
        resolve();
      } else {
        managed.process.once('exit', () => resolve());
      }
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    });

    await Promise.race([exitPromise, timeoutPromise]);

    // Force kill if still running
    if (managed.exitCode === null) {
      managed.process.kill('SIGKILL');

      // Wait for SIGKILL to take effect (with timeout)
      await Promise.race([
        new Promise<void>((resolve) => {
          if (managed.exitCode !== null) {
            resolve();
          } else {
            managed.process.once('exit', () => resolve());
          }
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
  }

  async sendInput(processId: string, input: string): Promise<void> {
    const managed = this._activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    return new Promise((resolve, reject) => {
      managed.streams.stdin.write(input, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  onOutput(processId: string, handler: OutputHandler): void {
    const managed = this._activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    managed.streams.stdout.on('data', (data: Buffer) => {
      handler(data, 'stdout');
    });

    managed.streams.stderr.on('data', (data: Buffer) => {
      handler(data, 'stderr');
    });
  }

  onError(processId: string, handler: ErrorHandler): void {
    const managed = this._activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    managed.process.on('error', (error: Error) => {
      handler(error);
    });
  }

  getProcess(processId: string): ManagedProcess | null {
    return this._activeProcesses.get(processId) || null;
  }

  getActiveProcesses(): ManagedProcess[] {
    return Array.from(this._activeProcesses.values());
  }

  getMetrics(): ProcessMetrics {
    // Return a copy to prevent external mutation
    return { ...this._metrics };
  }

  async shutdown(): Promise<void> {
    // Terminate all active processes first
    const processIds = Array.from(this._activeProcesses.keys());
    await Promise.all(
      processIds.map((id) => this.terminateProcess(id, 'SIGTERM'))
    );

    // Clear all pending cleanup timers (including ones scheduled by exit handlers)
    for (const [id, timer] of this._cleanupTimers.entries()) {
      clearTimeout(timer);
      this._cleanupTimers.delete(id);
    }
  }
}
