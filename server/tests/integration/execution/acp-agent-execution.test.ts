/**
 * Integration Tests for ACP Agent Execution (Claude Code)
 *
 * Tests the integration of AcpExecutorWrapper with real database, services,
 * and ExecutorFactory routing. Uses mocked acp-factory to avoid spawning
 * real agent processes.
 *
 * This tests the full ACP execution path:
 * createExecutorForAgent('claude-code') → AcpExecutorWrapper → acp-factory (mocked)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createExecutorForAgent } from '../../../src/execution/executors/executor-factory.js';
import { AcpExecutorWrapper } from '../../../src/execution/executors/acp-executor-wrapper.js';
import {
  createTestDatabase,
  createTestServices,
  createTestTask,
  createExecution,
  getExecution,
  cleanup,
} from './helpers/test-setup.js';

// Mock acp-factory to prevent spawning real agents
vi.mock('acp-factory', () => {
  const createMockSession = (overrides: any = {}) => ({
    id: 'test-session-123',
    cwd: '/test/workdir',
    modes: ['code'],
    models: ['claude-sonnet'],
    prompt: vi.fn().mockImplementation(async function* () {
      // Default: yield nothing
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const createMockAgent = (sessionOverrides: any = {}) => ({
    capabilities: { loadSession: true },
    createSession: vi.fn().mockResolvedValue(createMockSession(sessionOverrides)),
    loadSession: vi.fn().mockResolvedValue(createMockSession(sessionOverrides)),
    close: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
  });

  return {
    AgentFactory: {
      spawn: vi.fn().mockImplementation(() => Promise.resolve(createMockAgent())),
      listAgents: vi.fn().mockReturnValue(['claude-code', 'codex', 'gemini', 'opencode']),
      getConfig: vi.fn(),
    },
    // Export helpers for tests to customize behavior
    __createMockSession: createMockSession,
    __createMockAgent: createMockAgent,
  };
});

// Mock WebSocket broadcasts
vi.mock('../../../src/services/websocket.js', () => ({
  broadcastExecutionUpdate: vi.fn(),
  broadcastVoiceNarration: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
  },
}));

// Mock execution event callbacks
vi.mock('../../../src/services/execution-event-callbacks.js', () => ({
  notifyExecutionEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock execution changes service
vi.mock('../../../src/services/execution-changes-service.js', () => ({
  ExecutionChangesService: vi.fn().mockImplementation(() => ({
    getChanges: vi.fn().mockResolvedValue({
      available: true,
      captured: { files: [{ path: 'test.ts' }] },
    }),
  })),
}));

// Mock child_process for git commit capture (partial mock)
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn().mockReturnValue('abc123\n'),
  };
});

describe('ACP Agent Integration Tests - Claude Code Execution', () => {
  let db: Database.Database;
  let lifecycleService: any;
  let logsStore: any;
  let wrapper: AcpExecutorWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create fresh database and services for each test
    db = createTestDatabase();
    const services = createTestServices(db);
    lifecycleService = services.lifecycleService;
    logsStore = services.logsStore;

    // Create wrapper using factory - should return AcpExecutorWrapper for claude-code
    wrapper = createExecutorForAgent(
      'claude-code',
      { workDir: '/tmp/test' },
      {
        workDir: '/tmp/test',
        lifecycleService,
        logsStore,
        projectId: 'test-project',
        db,
      }
    ) as AcpExecutorWrapper;
  });

  afterEach(() => {
    cleanup(db);
    vi.clearAllMocks();
  });

  describe('Factory Routing', () => {
    it('should create AcpExecutorWrapper for claude-code', () => {
      expect(wrapper).toBeInstanceOf(AcpExecutorWrapper);
    });

    it('should detect claude-code as ACP-native agent', () => {
      expect(AcpExecutorWrapper.isAcpSupported('claude-code')).toBe(true);
    });
  });

  describe('Full Execution Flow - Success Path', () => {
    it('should execute full ACP flow successfully', async () => {
      const { AgentFactory } = await import('acp-factory');

      // Create execution record
      createExecution(db, {
        id: 'exec-acp-1',
        agent_type: 'claude-code',
        mode: 'worktree',
        prompt: 'Test ACP prompt',
      });

      // Configure mock to yield session updates
      const mockUpdates = [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'from ACP!' } },
      ];

      const mockSession = {
        id: 'session-acp-123',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        loadSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      // Execute
      const task = createTestTask({ id: 'task-acp-1', prompt: 'Test ACP execution' });
      await wrapper.executeWithLifecycle('exec-acp-1', task, '/tmp/test');

      // Verify agent was spawned
      expect(AgentFactory.spawn).toHaveBeenCalledWith('claude-code', expect.any(Object));

      // Verify session was created
      expect(mockAgent.createSession).toHaveBeenCalledWith('/tmp/test', expect.any(Object));

      // Verify execution completed
      const execution = getExecution(db, 'exec-acp-1');
      expect(execution?.status).toBe('completed');
      expect(execution?.exit_code).toBe(0);
    });

    it('should coalesce streaming chunks and store logs', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-coalesce',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      // Multiple chunks that should be coalesced
      const mockUpdates = [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Part 1 ' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Part 2 ' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Part 3' } },
      ];

      const mockSession = {
        id: 'session-coalesce',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      // Spy on logsStore to verify coalesced messages are stored
      const appendRawLogSpy = vi.spyOn(logsStore, 'appendRawLog');

      const task = createTestTask();
      await wrapper.executeWithLifecycle('exec-acp-coalesce', task, '/tmp/test');

      // Verify appendRawLog was called
      expect(appendRawLogSpy).toHaveBeenCalled();

      // Find the coalesced message in the calls
      const calls = appendRawLogSpy.mock.calls;
      const coalescedCall = calls.find(([execId, logStr]) => {
        try {
          const parsed = JSON.parse(logStr as string);
          return parsed.sessionUpdate === 'agent_message_complete';
        } catch {
          return false;
        }
      });
      expect(coalescedCall).toBeDefined();

      const parsed = JSON.parse(coalescedCall![1] as string);
      expect(parsed.content.text).toBe('Part 1 Part 2 Part 3');
    });

    it('should handle tool_call session updates', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-tool',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      // Use correct SessionUpdate format as expected by acp-factory
      const mockUpdates = [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Let me run a command' } },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Bash',
          status: 'in_progress',
          rawInput: { command: 'echo hello' },
        },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          status: 'completed',
          rawOutput: 'hello\n',
        },
      ];

      const mockSession = {
        id: 'session-tool',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      // Spy on logsStore to verify tool calls are stored
      const appendRawLogSpy = vi.spyOn(logsStore, 'appendRawLog');

      const task = createTestTask();
      await wrapper.executeWithLifecycle('exec-acp-tool', task, '/tmp/test');

      // Verify execution completed
      const execution = getExecution(db, 'exec-acp-tool');
      expect(execution?.status).toBe('completed');

      // Verify tool updates were stored via spy (coalesced as tool_call_complete)
      const calls = appendRawLogSpy.mock.calls;
      const toolCallLog = calls.find(([execId, logStr]) => {
        try {
          const parsed = JSON.parse(logStr as string);
          return parsed.sessionUpdate === 'tool_call_complete';
        } catch {
          return false;
        }
      });
      expect(toolCallLog).toBeDefined();

      // Verify the coalesced tool call has the expected content
      const parsed = JSON.parse(toolCallLog![1] as string);
      expect(parsed.toolCallId).toBe('tool-1');
      expect(parsed.title).toBe('Bash');
      expect(parsed.status).toBe('completed');
    });
  });

  describe('WebSocket Broadcasting', () => {
    it('should broadcast session updates via WebSocket', async () => {
      const { AgentFactory } = await import('acp-factory');
      const { websocketManager } = await import('../../../src/services/websocket.js');

      createExecution(db, {
        id: 'exec-acp-ws',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      const mockUpdates = [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Broadcasting test' } },
      ];

      const mockSession = {
        id: 'session-ws',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      const task = createTestTask();
      await wrapper.executeWithLifecycle('exec-acp-ws', task, '/tmp/test');

      // Verify WebSocket broadcast was called
      expect(websocketManager.broadcast).toHaveBeenCalledWith(
        'test-project',
        'execution',
        'exec-acp-ws',
        expect.objectContaining({
          type: 'session_update',
          data: expect.objectContaining({
            executionId: 'exec-acp-ws',
          }),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle agent spawn errors', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-spawn-error',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      (AgentFactory.spawn as any).mockRejectedValueOnce(new Error('Failed to spawn agent'));

      const task = createTestTask();
      await expect(
        wrapper.executeWithLifecycle('exec-acp-spawn-error', task, '/tmp/test')
      ).rejects.toThrow('Failed to spawn agent');

      // Verify execution marked as failed
      const execution = getExecution(db, 'exec-acp-spawn-error');
      expect(execution?.status).toBe('failed');
      expect(execution?.error_message).toContain('Failed to spawn agent');
    });

    it('should handle session creation errors', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-session-error',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockRejectedValue(new Error('Session creation failed')),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      const task = createTestTask();
      await expect(
        wrapper.executeWithLifecycle('exec-acp-session-error', task, '/tmp/test')
      ).rejects.toThrow('Session creation failed');

      // Verify execution marked as failed
      const execution = getExecution(db, 'exec-acp-session-error');
      expect(execution?.status).toBe('failed');
    });

    it('should handle prompt iteration errors', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-prompt-error',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      const mockSession = {
        id: 'session-error',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Starting...' } };
          throw new Error('Prompt iteration failed');
        }),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      const task = createTestTask();
      await expect(
        wrapper.executeWithLifecycle('exec-acp-prompt-error', task, '/tmp/test')
      ).rejects.toThrow('Prompt iteration failed');

      // Verify execution marked as failed
      const execution = getExecution(db, 'exec-acp-prompt-error');
      expect(execution?.status).toBe('failed');
    });
  });

  describe('Cancellation', () => {
    it('should cancel active ACP session', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-cancel',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      const mockSession = {
        id: 'session-cancel',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          // Simulate long-running execution
          await new Promise(resolve => setTimeout(resolve, 10000));
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      const task = createTestTask();

      // Start execution in background
      const execPromise = wrapper
        .executeWithLifecycle('exec-acp-cancel', task, '/tmp/test')
        .catch(() => {}); // Ignore cancellation error

      // Wait for execution to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cancel
      await wrapper.cancel('exec-acp-cancel');

      // Verify session.cancel was called
      expect(mockSession.cancel).toHaveBeenCalled();

      // Verify agent was closed
      expect(mockAgent.close).toHaveBeenCalled();
    });
  });

  describe('Session Resume', () => {
    it('should resume existing ACP session', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-resume',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      const mockUpdates = [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Resumed successfully' } },
      ];

      const mockSession = {
        id: 'existing-session-456',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn(),
        loadSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      const task = createTestTask({ prompt: 'Continue previous work' });
      await wrapper.resumeWithLifecycle(
        'exec-acp-resume',
        'existing-session-456',
        task,
        '/tmp/test'
      );

      // Verify loadSession was called instead of createSession
      expect(mockAgent.loadSession).toHaveBeenCalledWith('existing-session-456', '/tmp/test');
      expect(mockAgent.createSession).not.toHaveBeenCalled();

      // Verify execution completed
      const execution = getExecution(db, 'exec-acp-resume');
      expect(execution?.status).toBe('completed');
    });
  });

  describe('MCP Server Configuration', () => {
    it('should pass MCP servers to session creation', async () => {
      const { AgentFactory } = await import('acp-factory');

      createExecution(db, {
        id: 'exec-acp-mcp',
        agent_type: 'claude-code',
        mode: 'worktree',
      });

      const mockSession = {
        id: 'session-mcp',
        cwd: '/tmp/test',
        modes: ['code'],
        models: ['claude-sonnet'],
        prompt: vi.fn().mockImplementation(async function* () {}),
        cancel: vi.fn(),
      };

      const mockAgent = {
        capabilities: { loadSession: true },
        createSession: vi.fn().mockResolvedValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true),
      };

      (AgentFactory.spawn as any).mockResolvedValueOnce(mockAgent);

      // Create wrapper with MCP servers configured (array format as expected by ACP)
      const wrapperWithMcp = createExecutorForAgent(
        'claude-code',
        {
          workDir: '/tmp/test',
          mcpServers: [
            { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
          ],
        },
        {
          workDir: '/tmp/test',
          lifecycleService,
          logsStore,
          projectId: 'test-project',
          db,
        }
      ) as AcpExecutorWrapper;

      const task = createTestTask();
      await wrapperWithMcp.executeWithLifecycle('exec-acp-mcp', task, '/tmp/test');

      // Verify MCP servers were passed to createSession
      expect(mockAgent.createSession).toHaveBeenCalledWith(
        '/tmp/test',
        expect.objectContaining({
          mcpServers: expect.any(Array),
        })
      );
    });
  });
});
