/**
 * Integration Tests for Phase 1: Direct Execution Pattern
 *
 * Tests the integration of ClaudeExecutorWrapper, NormalizedEntryToAgUiAdapter,
 * and ExecutionLogsStore with real components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { NormalizedEntry } from 'agent-execution-engine/agents';
import { ClaudeExecutorWrapper } from '../../../src/execution/executors/claude-executor-wrapper.js';
import {
  createTestDatabase,
  createTestServices,
  createMockExecutor,
  createMockChildProcess,
  createMockManagedProcess,
  createTestTask,
  createExecution,
  getExecution,
  cleanup,
} from './helpers/test-setup.js';

// Mock WebSocket broadcasts
vi.mock('../../../src/services/websocket.js', () => ({
  broadcastExecutionUpdate: vi.fn(),
}));

describe('Phase 1 Integration Tests - Direct Execution Pattern', () => {
  let db: Database.Database;
  let lifecycleService: any;
  let logsStore: any;
  let transportManager: any;
  let mockExecutor: any;
  let wrapper: ClaudeExecutorWrapper;

  beforeEach(() => {
    // Create fresh database and services for each test
    db = createTestDatabase();
    const services = createTestServices(db);
    lifecycleService = services.lifecycleService;
    logsStore = services.logsStore;
    transportManager = services.transportManager;

    // Create mock executor
    mockExecutor = createMockExecutor();

    // Create wrapper with real services
    wrapper = new ClaudeExecutorWrapper({
      workDir: '/tmp/test',
      lifecycleService,
      logsStore,
      projectId: 'test-project',
      db,
      transportManager,
    });

    // Replace the real executor with our mock
    (wrapper as any).executor = mockExecutor;
  });

  afterEach(() => {
    cleanup(db);
    vi.clearAllMocks();
  });

  describe('Full Execution Flow - Success Path', () => {
    it('should execute full flow successfully', async () => {
      // 1. Create execution record (without issue_id to avoid foreign key constraint)
      createExecution(db, {
        id: 'exec-test-1',
        agent_type: 'claude-code',
        mode: 'worktree',
        prompt: 'Test prompt',
      });

      // 2. Create test task
      const task = createTestTask({ id: 'task-1' });

      // 3. Mock executor to return test entries
      const mockEntries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: 'assistant_message' },
          content: 'Starting task...',
          timestamp: new Date(),
        },
        {
          index: 1,
          type: {
            kind: 'tool_use',
            tool: {
              toolName: 'Bash',
              action: { kind: 'command_run', command: 'echo "test"' },
              status: 'success',
              result: { success: true, data: 'test\n' },
            },
          },
          content: '',
          timestamp: new Date(),
        },
        {
          index: 2,
          type: { kind: 'assistant_message' },
          content: 'Task completed',
          timestamp: new Date(),
        },
      ];

      const mockChildProcess = createMockChildProcess();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {
          for (const entry of mockEntries) {
            yield entry;
          }
        })()
      );

      // 4. Execute
      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-1',
        task,
        '/tmp/test'
      );

      // Emit exit event after a delay
      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 0);
      }, 50);

      await executePromise;

      // 5. Verify logs stored
      const logs = logsStore.getNormalizedEntries('exec-test-1');
      expect(logs).toHaveLength(3);
      expect(logs[0].type.kind).toBe('assistant_message');
      expect(logs[1].type.kind).toBe('tool_use');
      expect(logs[2].type.kind).toBe('assistant_message');

      // 6. Verify execution status updated
      const updated = getExecution(db, 'exec-test-1');
      expect(updated?.status).toBe('completed');
      expect(updated?.completed_at).toBeDefined();
    });

    it('should process all entry types correctly', async () => {
      createExecution(db, {
        id: 'exec-test-all-types',
        mode: 'worktree',
      });

      const task = createTestTask();

      // Test all entry type variants
      const mockEntries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: 'assistant_message' },
          content: 'Assistant message',
          timestamp: new Date(),
        },
        {
          index: 1,
          type: {
            kind: 'thinking',
            reasoning: 'Thinking about the problem',
          },
          content: '',
          timestamp: new Date(),
        },
        {
          index: 2,
          type: { kind: 'system_message' },
          content: 'System notification',
          timestamp: new Date(),
        },
        {
          index: 3,
          type: {
            kind: 'error',
            error: {
              message: 'Test error',
              stack: 'Error stack trace',
            },
          },
          content: '',
          timestamp: new Date(),
        },
        {
          index: 4,
          type: { kind: 'user_message' },
          content: 'User input',
          timestamp: new Date(),
        },
      ];

      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {
          for (const entry of mockEntries) {
            yield entry;
          }
        })()
      );

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-all-types',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 0);
      }, 50);

      await executePromise;

      // Verify all entries were stored
      const logs = logsStore.getNormalizedEntries('exec-test-all-types');
      expect(logs).toHaveLength(5);
      expect(logs.map(l => l.type.kind)).toEqual([
        'assistant_message',
        'thinking',
        'system_message',
        'error',
        'user_message',
      ]);
    });
  });

  describe('Error Handling', () => {
    it('should handle process spawn errors gracefully', async () => {
      createExecution(db, {
        id: 'exec-test-spawn-error',
        mode: 'worktree',
      });

      const task = createTestTask();

      // Mock executor to throw error
      mockExecutor.executeTask.mockRejectedValue(
        new Error('Process spawn failed')
      );

      await expect(
        wrapper.executeWithLifecycle('exec-test-spawn-error', task, '/tmp/test')
      ).rejects.toThrow('Process spawn failed');

      // Verify execution marked as failed
      const execution = getExecution(db, 'exec-test-spawn-error');
      expect(execution?.status).toBe('failed');
      expect(execution?.error_message).toContain('Process spawn failed');
    });

    it('should handle process crash errors gracefully', async () => {
      createExecution(db, {
        id: 'exec-test-crash',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-crash',
        task,
        '/tmp/test'
      );

      // Emit error event followed by exit (actual behavior)
      setTimeout(() => {
        mockManagedProcess.process.emit('error', new Error('Process crashed'));
        // After error, process still exits with non-zero code
        mockManagedProcess.process.emit('exit', 1);
      }, 10);

      // The wrapper throws based on exit code, not the error event
      await expect(executePromise).rejects.toThrow('Process exited with code 1');

      // Verify execution marked as failed
      const execution = getExecution(db, 'exec-test-crash');
      expect(execution?.status).toBe('failed');
    });

    it('should handle non-zero exit codes', async () => {
      createExecution(db, {
        id: 'exec-test-exit-code',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-exit-code',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 1);
      }, 10);

      await expect(executePromise).rejects.toThrow('Process exited with code 1');

      // Verify execution marked as failed
      const execution = getExecution(db, 'exec-test-exit-code');
      expect(execution?.status).toBe('failed');
    });

    it('should continue processing on individual entry errors', async () => {
      createExecution(db, {
        id: 'exec-test-entry-error',
        mode: 'worktree',
      });

      const task = createTestTask();

      const mockEntries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: 'assistant_message' },
          content: 'Entry 1',
          timestamp: new Date(),
        },
        {
          index: 1,
          type: { kind: 'assistant_message' },
          content: 'Entry 2',
          timestamp: new Date(),
        },
        {
          index: 2,
          type: { kind: 'assistant_message' },
          content: 'Entry 3',
          timestamp: new Date(),
        },
      ];

      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {
          for (const entry of mockEntries) {
            yield entry;
          }
        })()
      );

      // Make logsStore.appendNormalizedEntry fail once
      const originalAppend = logsStore.appendNormalizedEntry;
      let callCount = 0;
      logsStore.appendNormalizedEntry = vi.fn((execId: string, entry: NormalizedEntry) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('DB error on entry 2');
        }
        return originalAppend.call(logsStore, execId, entry);
      });

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-entry-error',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 0);
      }, 50);

      // Should complete despite entry processing error
      await executePromise;

      // Verify other entries still processed (entries 1 and 3)
      const logs = logsStore.getNormalizedEntries('exec-test-entry-error');
      expect(logs.length).toBe(2); // Entry 2 failed, but 1 and 3 succeeded

      // Verify execution still completes
      const execution = getExecution(db, 'exec-test-entry-error');
      expect(execution?.status).toBe('completed');

      // Restore original method
      logsStore.appendNormalizedEntry = originalAppend;
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup resources on successful completion', async () => {
      createExecution(db, {
        id: 'exec-test-cleanup-success',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      // Spy on transport manager
      const disconnectSpy = vi.spyOn(transportManager, 'disconnectAdapter');

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-cleanup-success',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 0);
      }, 10);

      await executePromise;

      // Verify adapter disconnected from transport
      expect(disconnectSpy).toHaveBeenCalled();

      // Verify no active executions remain
      expect((wrapper as any).activeExecutions.size).toBe(0);
    });

    it('should cleanup resources on error', async () => {
      createExecution(db, {
        id: 'exec-test-cleanup-error',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      // Spy on transport manager
      const disconnectSpy = vi.spyOn(transportManager, 'disconnectAdapter');

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-cleanup-error',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 1);
      }, 10);

      await expect(executePromise).rejects.toThrow();

      // Verify cleanup happened
      expect(disconnectSpy).toHaveBeenCalled();

      // Verify no active executions remain
      expect((wrapper as any).activeExecutions.size).toBe(0);
    });
  });

  describe('Cancellation', () => {
    it('should handle cancellation correctly', async () => {
      createExecution(db, {
        id: 'exec-test-cancel',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {
          // Keep streaming forever (simulate long-running process)
          while (true) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        })()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      // Start execution (don't await)
      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-cancel',
        task,
        '/tmp/test'
      );

      // Wait a bit for execution to start
      await new Promise(resolve => setTimeout(resolve, 20));

      // Cancel
      await wrapper.cancel('exec-test-cancel');

      // Verify process killed
      expect(mockManagedProcess.process.kill).toHaveBeenCalledWith('SIGTERM');

      // Verify execution status
      const execution = getExecution(db, 'exec-test-cancel');
      expect(execution?.status).toBe('stopped');

      // Emit exit to complete the execution promise
      mockManagedProcess.process.emit('exit', 143); // SIGTERM exit code

      await expect(executePromise).rejects.toThrow();
    });
  });

  describe('Session Resumption', () => {
    it('should support session resumption', async () => {
      createExecution(db, {
        id: 'exec-test-resume',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      // Mock resumeTask instead of executeTask
      mockExecutor.resumeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {
          yield {
            index: 0,
            type: { kind: 'assistant_message' },
            content: 'Resumed session',
            timestamp: new Date(),
          };
        })()
      );

      const resumePromise = wrapper.resumeWithLifecycle(
        'exec-test-resume',
        'session-abc-123',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 0);
      }, 10);

      await resumePromise;

      // Verify resumeTask called with session ID
      expect(mockExecutor.resumeTask).toHaveBeenCalledWith(
        task,
        'session-abc-123'
      );

      // Verify execution completed
      const execution = getExecution(db, 'exec-test-resume');
      expect(execution?.status).toBe('completed');
    });
  });

  describe('Transport Manager Integration', () => {
    it('should connect and disconnect adapters correctly', async () => {
      createExecution(db, {
        id: 'exec-test-transport',
        mode: 'worktree',
      });

      const task = createTestTask();
      const mockManagedProcess = createMockManagedProcess();

      mockExecutor.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      mockExecutor.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      mockExecutor.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      // Spy on transport manager methods
      const connectSpy = vi.spyOn(transportManager, 'connectAdapter');
      const disconnectSpy = vi.spyOn(transportManager, 'disconnectAdapter');

      const executePromise = wrapper.executeWithLifecycle(
        'exec-test-transport',
        task,
        '/tmp/test'
      );

      setTimeout(() => {
        mockManagedProcess.process.emit('exit', 0);
      }, 10);

      await executePromise;

      // Verify adapter connected
      expect(connectSpy).toHaveBeenCalledWith(
        expect.anything(),
        'exec-test-transport'
      );

      // Verify adapter disconnected
      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});
