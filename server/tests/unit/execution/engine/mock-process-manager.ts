/**
 * Mock Process Manager for Engine Testing
 *
 * Simulates process execution without actually spawning processes.
 */

import type { IProcessManager } from '../../../../src/execution/process/manager.js';
import type {
  ManagedProcess,
  ProcessConfig,
  ProcessMetrics,
  OutputHandler,
  ErrorHandler,
} from '../../../../src/execution/process/types.js';
import { generateId } from '../../../../src/execution/process/utils.js';

export class MockProcessManager implements IProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private outputHandlers = new Map<string, OutputHandler[]>();
  private errorHandlers = new Map<string, ErrorHandler[]>();

  // Configuration for mock behavior
  public mockDelay = 10; // ms to simulate process execution
  public shouldFail = false; // whether to simulate process failures
  public onAcquire?: () => void; // callback for when process is acquired

  async acquireProcess(config: ProcessConfig): Promise<ManagedProcess> {
    // Call onAcquire callback if configured
    if (this.onAcquire) {
      this.onAcquire();
    }
    const processId = generateId('mock-proc');

    const managedProcess: ManagedProcess = {
      id: processId,
      pid: Math.floor(Math.random() * 100000), // Random mock PID
      process: {} as any, // Mock ChildProcess
      status: 'busy',
      exitCode: null,
      signal: null,
      spawnedAt: new Date(),
      lastActivity: new Date(),
      streams: {
        stdin: {} as any,
        stdout: {} as any,
        stderr: {} as any,
      },
      metrics: {
        totalDuration: 0,
        tasksCompleted: 0,
        successRate: 1.0,
      },
    };

    // Suppress unused param warning
    void config;

    this.processes.set(processId, managedProcess);

    // Simulate process completion after a delay
    setTimeout(() => {
      if (this.processes.has(processId)) {
        const proc = this.processes.get(processId)!;
        proc.exitCode = this.shouldFail ? 1 : 0;
        proc.status = this.shouldFail ? 'crashed' : 'completed';

        // Call output handlers with mock output
        const handlers = this.outputHandlers.get(processId) || [];
        for (const handler of handlers) {
          handler(Buffer.from('Mock output\n'), 'stdout');
        }
      }
    }, this.mockDelay);

    return managedProcess;
  }

  async releaseProcess(processId: string): Promise<void> {
    this.processes.delete(processId);
    this.outputHandlers.delete(processId);
    this.errorHandlers.delete(processId);
  }

  async terminateProcess(processId: string, _signal?: NodeJS.Signals): Promise<void> {
    const proc = this.processes.get(processId);
    if (proc) {
      proc.exitCode = 143; // SIGTERM exit code
      proc.status = 'crashed';
      this.processes.delete(processId);
    }
  }

  async sendInput(_processId: string, _input: string): Promise<void> {
    // Mock implementation - does nothing
  }

  closeInput(_processId: string): void {
    // Mock implementation - does nothing
  }

  onOutput(processId: string, handler: OutputHandler): void {
    if (!this.outputHandlers.has(processId)) {
      this.outputHandlers.set(processId, []);
    }
    this.outputHandlers.get(processId)!.push(handler);
  }

  onError(processId: string, handler: ErrorHandler): void {
    if (!this.errorHandlers.has(processId)) {
      this.errorHandlers.set(processId, []);
    }
    this.errorHandlers.get(processId)!.push(handler);
  }

  getProcess(processId: string): ManagedProcess | null {
    return this.processes.get(processId) || null;
  }

  getActiveProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values());
  }

  getMetrics(): ProcessMetrics {
    return {
      totalSpawned: this.processes.size,
      currentlyActive: this.processes.size,
      totalCompleted: 0,
      totalFailed: 0,
      averageDuration: 0,
    };
  }

  async shutdown(): Promise<void> {
    this.processes.clear();
    this.outputHandlers.clear();
    this.errorHandlers.clear();
  }
}
