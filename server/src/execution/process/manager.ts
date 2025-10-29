/**
 * Process Manager Interface
 *
 * Defines the contract for all process managers in the Process Layer.
 * Process managers handle spawning, monitoring, and terminating Claude Code processes.
 *
 * @module execution/process/manager
 */

import type {
  ManagedProcess,
  ProcessConfig,
  ProcessMetrics,
  OutputHandler,
  ErrorHandler,
} from './types.js';

/**
 * Core abstraction for managing Claude Code CLI processes
 *
 * This interface defines the contract that all process manager implementations
 * must follow. It provides methods for:
 * - Process lifecycle management (acquire, release, terminate)
 * - Process communication (I/O)
 * - Monitoring and metrics
 *
 * @example
 * ```typescript
 * const manager: IProcessManager = new SimpleProcessManager();
 * const process = await manager.acquireProcess({
 *   claudePath: 'claude',
 *   workDir: '/path/to/project',
 *   args: {
 *     print: true,
 *     outputFormat: 'stream-json',
 *     dangerouslySkipPermissions: true,
 *   },
 * });
 * ```
 */
export interface IProcessManager {
  // ========================================
  // Process Lifecycle
  // ========================================

  /**
   * Acquire a new Claude Code process
   *
   * Spawns a new process with the given configuration and returns a managed
   * process handle. The process will be tracked until it exits or is terminated.
   *
   * @param config - Configuration for the process
   * @returns Promise resolving to the managed process
   * @throws Error if process fails to spawn
   */
  acquireProcess(config: ProcessConfig): Promise<ManagedProcess>;

  /**
   * Release a process (terminate it gracefully)
   *
   * Sends SIGTERM to the process and waits for it to exit. If it doesn't exit
   * within a grace period, SIGKILL is sent.
   *
   * @param processId - ID of the process to release
   * @returns Promise that resolves when process is terminated
   */
  releaseProcess(processId: string): Promise<void>;

  /**
   * Terminate a process with a specific signal
   *
   * Sends the specified signal to the process. Uses graceful shutdown with
   * SIGTERM by default, followed by SIGKILL if needed.
   *
   * @param processId - ID of the process to terminate
   * @param signal - Signal to send (defaults to SIGTERM)
   * @returns Promise that resolves when process is terminated
   */
  terminateProcess(processId: string, signal?: NodeJS.Signals): Promise<void>;

  // ========================================
  // Process Communication
  // ========================================

  /**
   * Send input to a process's stdin
   *
   * @param processId - ID of the process
   * @param input - Input string to send
   * @returns Promise that resolves when input is written
   * @throws Error if process is not found
   */
  sendInput(processId: string, input: string): Promise<void>;

  /**
   * Register a handler for process output (stdout/stderr)
   *
   * The handler will be called whenever the process produces output.
   * Multiple handlers can be registered for the same process.
   *
   * @param processId - ID of the process
   * @param handler - Handler function to call on output
   */
  onOutput(processId: string, handler: OutputHandler): void;

  /**
   * Register a handler for process errors
   *
   * The handler will be called when the process encounters an error.
   *
   * @param processId - ID of the process
   * @param handler - Handler function to call on error
   */
  onError(processId: string, handler: ErrorHandler): void;

  // ========================================
  // Monitoring
  // ========================================

  /**
   * Get a managed process by ID
   *
   * @param processId - ID of the process
   * @returns The managed process or null if not found
   */
  getProcess(processId: string): ManagedProcess | null;

  /**
   * Get all currently active processes
   *
   * @returns Array of all active managed processes
   */
  getActiveProcesses(): ManagedProcess[];

  /**
   * Get aggregate metrics for all processes
   *
   * @returns Process metrics summary
   */
  getMetrics(): ProcessMetrics;

  // ========================================
  // Cleanup
  // ========================================

  /**
   * Shutdown the process manager
   *
   * Terminates all active processes and cleans up resources.
   * This should be called before the application exits.
   *
   * @returns Promise that resolves when all processes are terminated
   */
  shutdown(): Promise<void>;
}
