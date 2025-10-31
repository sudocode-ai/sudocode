/**
 * Tests for AgUiEventAdapter
 *
 * Tests the transformation of SPEC-007 output processing events into AG-UI protocol events.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { AgUiEventAdapter } from '../../../../src/execution/output/ag-ui-adapter.js';
import { EventType } from '@ag-ui/core';
import type {
  IOutputProcessor,
  ToolCall,
  FileChange,
  ProcessingMetrics,
  ToolCallHandler,
  FileChangeHandler,
  ProgressHandler,
  ErrorHandler,
} from '../../../../src/execution/output/types.js';

describe('AgUiEventAdapter', () => {
  describe('constructor', () => {
    it('should create adapter with runId', () => {
      const adapter = new AgUiEventAdapter('run-123');
      assert.strictEqual(adapter.getRunId(), 'run-123');
    });

    it('should use runId as threadId when threadId not provided', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      adapter.emitRunStarted();

      const call = listener.mock.calls[0];
      const event = call.arguments[0];
      assert.strictEqual(event.runId, 'run-123');
      assert.strictEqual(event.threadId, 'run-123');
    });

    it('should use provided threadId when specified', () => {
      const adapter = new AgUiEventAdapter('run-123', 'thread-456');
      const listener = mock.fn();
      adapter.onEvent(listener);

      adapter.emitRunStarted();

      const call = listener.mock.calls[0];
      const event = call.arguments[0];
      assert.strictEqual(event.runId, 'run-123');
      assert.strictEqual(event.threadId, 'thread-456');
    });
  });

  describe('event listener registration', () => {
    it('should register event listeners', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();

      adapter.onEvent(listener);
      adapter.emitRunStarted();

      assert.strictEqual(listener.mock.calls.length, 2); // RUN_STARTED + STATE_SNAPSHOT
    });

    it('should support multiple listeners', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener1 = mock.fn();
      const listener2 = mock.fn();

      adapter.onEvent(listener1);
      adapter.onEvent(listener2);
      adapter.emitRunStarted();

      assert.strictEqual(listener1.mock.calls.length, 2);
      assert.strictEqual(listener2.mock.calls.length, 2);
    });

    it('should remove event listeners', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();

      adapter.onEvent(listener);
      adapter.offEvent(listener);
      adapter.emitRunStarted();

      assert.strictEqual(listener.mock.calls.length, 0);
    });

    it('should handle listener errors gracefully', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const errorListener = mock.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = mock.fn();

      adapter.onEvent(errorListener);
      adapter.onEvent(normalListener);

      // Should not throw
      assert.doesNotThrow(() => {
        adapter.emitRunStarted();
      });

      // Normal listener should still be called
      assert.strictEqual(normalListener.mock.calls.length, 2);
    });
  });

  describe('connectToProcessor', () => {
    it('should subscribe to all processor events', () => {
      const adapter = new AgUiEventAdapter('run-123');

      let toolCallHandler: ToolCallHandler | null = null;
      let fileChangeHandler: FileChangeHandler | null = null;
      let progressHandler: ProgressHandler | null = null;
      let errorHandler: ErrorHandler | null = null;

      const mockProcessor: IOutputProcessor = {
        processLine: async () => {},
        getMetrics: () => ({
          totalMessages: 0,
          toolCalls: [],
          fileChanges: [],
          usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 },
          errors: [],
          startedAt: new Date(),
          lastUpdate: new Date(),
        }),
        getToolCalls: () => [],
        getFileChanges: () => [],
        onToolCall: (handler) => { toolCallHandler = handler; },
        onFileChange: (handler) => { fileChangeHandler = handler; },
        onProgress: (handler) => { progressHandler = handler; },
        onError: (handler) => { errorHandler = handler; },
      };

      adapter.connectToProcessor(mockProcessor);

      assert.notStrictEqual(toolCallHandler, null);
      assert.notStrictEqual(fileChangeHandler, null);
      assert.notStrictEqual(progressHandler, null);
      assert.notStrictEqual(errorHandler, null);
    });
  });

  describe('tool call event transformation', () => {
    it('should emit TOOL_CALL_START and TOOL_CALL_ARGS for new tool call', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'Read',
        input: { file_path: '/test.ts' },
        status: 'pending',
        timestamp: new Date(),
      };

      // Trigger tool call handler
      const toolCallHandler = getMockHandler(mockProcessor, 'onToolCall') as ToolCallHandler;
      toolCallHandler(toolCall);

      // Should emit TOOL_CALL_START and TOOL_CALL_ARGS
      assert.strictEqual(listener.mock.calls.length, 2);

      const startEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(startEvent.type, EventType.TOOL_CALL_START);
      assert.strictEqual(startEvent.toolCallId, 'tool-1');
      assert.strictEqual(startEvent.toolCallName, 'Read');

      const argsEvent = listener.mock.calls[1].arguments[0];
      assert.strictEqual(argsEvent.type, EventType.TOOL_CALL_ARGS);
      assert.strictEqual(argsEvent.toolCallId, 'tool-1');
      assert.strictEqual(argsEvent.delta, JSON.stringify({ file_path: '/test.ts' }));
    });

    it('should emit TOOL_CALL_END and TOOL_CALL_RESULT on success', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      const toolCallHandler = getMockHandler(mockProcessor, 'onToolCall') as ToolCallHandler;

      // First call - pending
      const pendingToolCall: ToolCall = {
        id: 'tool-1',
        name: 'Read',
        input: { file_path: '/test.ts' },
        status: 'pending',
        timestamp: new Date(),
      };
      toolCallHandler(pendingToolCall);

      listener.mock.resetCalls();

      // Second call - success
      const successToolCall: ToolCall = {
        ...pendingToolCall,
        status: 'success',
        result: 'file contents',
        completedAt: new Date(),
      };
      toolCallHandler(successToolCall);

      // Should emit TOOL_CALL_END, TOOL_CALL_RESULT, and STATE_DELTA
      assert.strictEqual(listener.mock.calls.length, 3);

      const endEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(endEvent.type, EventType.TOOL_CALL_END);
      assert.strictEqual(endEvent.toolCallId, 'tool-1');

      const resultEvent = listener.mock.calls[1].arguments[0];
      assert.strictEqual(resultEvent.type, EventType.TOOL_CALL_RESULT);
      assert.strictEqual(resultEvent.toolCallId, 'tool-1');
      assert.strictEqual(resultEvent.content, 'file contents');
    });

    it('should emit TOOL_CALL_RESULT with error on failure', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      const toolCallHandler = getMockHandler(mockProcessor, 'onToolCall') as ToolCallHandler;

      // Pending call
      toolCallHandler({
        id: 'tool-1',
        name: 'Read',
        input: { file_path: '/test.ts' },
        status: 'pending',
        timestamp: new Date(),
      });

      listener.mock.resetCalls();

      // Error call
      const errorToolCall: ToolCall = {
        id: 'tool-1',
        name: 'Read',
        input: { file_path: '/test.ts' },
        status: 'error',
        error: 'File not found',
        timestamp: new Date(),
        completedAt: new Date(),
      };
      toolCallHandler(errorToolCall);

      const resultEvent = listener.mock.calls[1].arguments[0];
      assert.strictEqual(resultEvent.type, EventType.TOOL_CALL_RESULT);
      assert.strictEqual(resultEvent.content, 'File not found');
    });
  });

  describe('file change event transformation', () => {
    it('should emit CUSTOM event for file changes', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      const fileChange: FileChange = {
        path: '/src/test.ts',
        operation: 'write',
        timestamp: new Date(),
        toolCallId: 'tool-1',
        changes: {
          linesAdded: 10,
          linesDeleted: 5,
        },
      };

      const fileChangeHandler = getMockHandler(mockProcessor, 'onFileChange') as FileChangeHandler;
      fileChangeHandler(fileChange);

      // Should emit CUSTOM event and STATE_DELTA
      assert.strictEqual(listener.mock.calls.length, 2);

      const customEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(customEvent.type, EventType.CUSTOM);
      assert.strictEqual(customEvent.name, 'file_change');
      assert.deepStrictEqual(customEvent.value, {
        path: '/src/test.ts',
        operation: 'write',
        toolCallId: 'tool-1',
        changes: {
          linesAdded: 10,
          linesDeleted: 5,
        },
      });
    });
  });

  describe('progress event transformation', () => {
    it('should emit STATE_DELTA for progress updates', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      const metrics: ProcessingMetrics = {
        totalMessages: 10,
        toolCalls: [],
        fileChanges: [],
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheTokens: 20,
          totalTokens: 150,
        },
        errors: [],
        startedAt: new Date(),
        lastUpdate: new Date(),
      };

      const progressHandler = getMockHandler(mockProcessor, 'onProgress') as ProgressHandler;
      progressHandler(metrics);

      assert.strictEqual(listener.mock.calls.length, 1);

      const deltaEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(deltaEvent.type, EventType.STATE_DELTA);
      assert.ok(Array.isArray(deltaEvent.delta));

      // Check JSON Patch format
      const totalMessagesOp = deltaEvent.delta.find((op: any) => op.path === '/totalMessages');
      assert.ok(totalMessagesOp);
      assert.strictEqual(totalMessagesOp.op, 'replace');
      assert.strictEqual(totalMessagesOp.value, 10);
    });
  });

  describe('error event transformation', () => {
    it('should emit RUN_ERROR for errors', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      const error = {
        message: 'Test error',
        timestamp: new Date(),
        details: { code: 'ERR_TEST' },
      };

      const errorHandler = getMockHandler(mockProcessor, 'onError') as ErrorHandler;
      errorHandler(error);

      // Should emit RUN_ERROR and STATE_DELTA
      assert.strictEqual(listener.mock.calls.length, 2);

      const errorEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(errorEvent.type, EventType.RUN_ERROR);
      assert.strictEqual(errorEvent.message, 'Test error');
      assert.ok(errorEvent.rawEvent);
      assert.deepStrictEqual(errorEvent.rawEvent.details, { code: 'ERR_TEST' });
    });
  });

  describe('lifecycle methods', () => {
    it('should emit RUN_STARTED and STATE_SNAPSHOT', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      adapter.emitRunStarted({ model: 'claude-sonnet-4' });

      assert.strictEqual(listener.mock.calls.length, 2);

      const runStartedEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(runStartedEvent.type, EventType.RUN_STARTED);
      assert.strictEqual(runStartedEvent.runId, 'run-123');
      assert.ok(runStartedEvent.rawEvent);

      const snapshotEvent = listener.mock.calls[1].arguments[0];
      assert.strictEqual(snapshotEvent.type, EventType.STATE_SNAPSHOT);
      assert.ok(snapshotEvent.snapshot);
    });

    it('should emit RUN_FINISHED with result', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const result = { success: true, summary: 'Task completed' };
      adapter.emitRunFinished(result);

      assert.strictEqual(listener.mock.calls.length, 1);

      const runFinishedEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(runFinishedEvent.type, EventType.RUN_FINISHED);
      assert.strictEqual(runFinishedEvent.runId, 'run-123');
      assert.deepStrictEqual(runFinishedEvent.result, result);
    });

    it('should emit STATE_SNAPSHOT with metrics', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      mockProcessor.getMetrics = () => ({
        totalMessages: 5,
        toolCalls: [{} as ToolCall, {} as ToolCall],
        fileChanges: [{} as FileChange],
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheTokens: 20,
          totalTokens: 150,
        },
        errors: [],
        startedAt: new Date(),
        lastUpdate: new Date(),
      });

      adapter.connectToProcessor(mockProcessor);
      adapter.emitStateSnapshot();

      assert.strictEqual(listener.mock.calls.length, 1);

      const snapshotEvent = listener.mock.calls[0].arguments[0];
      assert.strictEqual(snapshotEvent.type, EventType.STATE_SNAPSHOT);
      assert.strictEqual(snapshotEvent.snapshot.totalMessages, 5);
      assert.strictEqual(snapshotEvent.snapshot.toolCallCount, 2);
      assert.strictEqual(snapshotEvent.snapshot.fileChangeCount, 1);
      assert.deepStrictEqual(snapshotEvent.snapshot.usage, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });
  });

  describe('state management', () => {
    it('should track state across events', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      const mockProcessor = createMockProcessor();
      adapter.connectToProcessor(mockProcessor);

      // Emit progress update
      const progressHandler = getMockHandler(mockProcessor, 'onProgress') as ProgressHandler;
      progressHandler({
        totalMessages: 5,
        toolCalls: [],
        fileChanges: [],
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheTokens: 20,
          totalTokens: 150,
        },
        errors: [],
        startedAt: new Date(),
        lastUpdate: new Date(),
      });

      const state = adapter.getState();
      assert.strictEqual(state.totalMessages, 5);
      assert.strictEqual(state.toolCallCount, 0);
    });

    it('should return copy of state', () => {
      const adapter = new AgUiEventAdapter('run-123');

      const state1 = adapter.getState();
      state1.customField = 'modified';

      const state2 = adapter.getState();
      assert.strictEqual(state2.customField, undefined);
    });
  });

  describe('event timestamps', () => {
    it('should use numeric timestamps', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const listener = mock.fn();
      adapter.onEvent(listener);

      adapter.emitRunStarted();

      const event = listener.mock.calls[0].arguments[0];
      assert.strictEqual(typeof event.timestamp, 'number');
      assert.ok(event.timestamp > 0);
    });
  });
});

// Helper functions

function createMockProcessor(): IOutputProcessor {
  const handlers: Record<string, any> = {};

  return {
    processLine: async () => {},
    getMetrics: () => ({
      totalMessages: 0,
      toolCalls: [],
      fileChanges: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 },
      errors: [],
      startedAt: new Date(),
      lastUpdate: new Date(),
    }),
    getToolCalls: () => [],
    getFileChanges: () => [],
    onToolCall: (handler: ToolCallHandler) => { handlers.onToolCall = handler; },
    onFileChange: (handler: FileChangeHandler) => { handlers.onFileChange = handler; },
    onProgress: (handler: ProgressHandler) => { handlers.onProgress = handler; },
    onError: (handler: ErrorHandler) => { handlers.onError = handler; },
    _handlers: handlers, // Internal access for testing
  } as any;
}

function getMockHandler(processor: any, handlerName: string): any {
  return processor._handlers[handlerName];
}
