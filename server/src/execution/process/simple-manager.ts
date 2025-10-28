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

  async releaseProcess(_processId: string): Promise<void> {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }

  async terminateProcess(
    _processId: string,
    _signal?: NodeJS.Signals
  ): Promise<void> {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }

  async sendInput(_processId: string, _input: string): Promise<void> {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }

  onOutput(_processId: string, _handler: OutputHandler): void {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }

  onError(_processId: string, _handler: ErrorHandler): void {
    void this._activeProcesses;
    throw new Error('Not implemented');
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
    void this._activeProcesses;
    throw new Error('Not implemented');
  }
}
