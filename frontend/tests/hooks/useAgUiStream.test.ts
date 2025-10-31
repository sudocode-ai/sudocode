/**
 * useAgUiStream Hook Tests
 *
 * Tests for the AG-UI event streaming React hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAgUiStream } from '@/hooks/useAgUiStream'
import { EventType } from '@ag-ui/core'

// Mock EventSource
class MockEventSource {
  url: string
  readyState: number = 1 // Immediately connected
  private _onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  private eventListeners: Map<string, Set<(event: MessageEvent) => void>> = new Map()

  constructor(url: string) {
    this.url = url
  }

  // Setter that fires immediately when onopen is assigned
  set onopen(handler: ((event: Event) => void) | null) {
    this._onopen = handler
    if (handler) {
      // Fire onopen immediately in a microtask
      Promise.resolve().then(() => {
        if (this._onopen) {
          this._onopen(new Event('open'))
        }
      })
    }
  }

  get onopen() {
    return this._onopen
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set())
    }
    this.eventListeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.eventListeners.get(type)?.delete(listener)
  }

  close() {
    this.readyState = 2 // CLOSED
  }

  // Helper method to simulate receiving an event
  simulateEvent(type: string, data: any) {
    const listeners = this.eventListeners.get(type)
    if (listeners) {
      const event = new MessageEvent('message', {
        data: JSON.stringify(data),
      })
      listeners.forEach(listener => listener(event))
    }
  }
}

// Replace global EventSource with mock
const originalEventSource = global.EventSource
let mockEventSourceInstance: MockEventSource | null = null

beforeEach(() => {
  mockEventSourceInstance = null
  // @ts-ignore
  global.EventSource = vi.fn((url: string) => {
    mockEventSourceInstance = new MockEventSource(url)
    return mockEventSourceInstance
  }) as any
})

afterEach(() => {
  global.EventSource = originalEventSource
  mockEventSourceInstance = null
})

describe('useAgUiStream', () => {
  describe('Connection Management', () => {
    it('should initialize with idle status', () => {
      const { result } = renderHook(() =>
        useAgUiStream({ executionId: 'test-exec-1', autoConnect: false })
      )

      expect(result.current.connectionStatus).toBe('idle')
      expect(result.current.isConnected).toBe(false)
    })

    it('should auto-connect by default', async () => {
      const { result } = renderHook(() =>
        useAgUiStream({ executionId: 'test-exec-1' })
      )

      expect(result.current.connectionStatus).toBe('connecting')

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
        expect(result.current.isConnected).toBe(true)
      })
    })

    it('should not auto-connect when autoConnect is false', () => {
      const { result } = renderHook(() =>
        useAgUiStream({ executionId: 'test-exec-1', autoConnect: false })
      )

      expect(result.current.connectionStatus).toBe('idle')
      expect(global.EventSource).not.toHaveBeenCalled()
    })

    it('should connect manually', async () => {
      const { result } = renderHook(() =>
        useAgUiStream({ executionId: 'test-exec-1', autoConnect: false })
      )

      expect(result.current.connectionStatus).toBe('idle')

      act(() => {
        result.current.connect()
      })

      expect(result.current.connectionStatus).toBe('connecting')

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })
    })

    it('should disconnect', async () => {
      const { result } = renderHook(() =>
        useAgUiStream({ executionId: 'test-exec-1' })
      )

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      act(() => {
        result.current.disconnect()
      })

      expect(result.current.connectionStatus).toBe('disconnected')
      expect(result.current.isConnected).toBe(false)
      expect(mockEventSourceInstance?.readyState).toBe(2) // CLOSED
    })

    it('should use correct endpoint URL', () => {
      renderHook(() => useAgUiStream({ executionId: 'test-exec-123' }))

      expect(global.EventSource).toHaveBeenCalledWith(
        '/api/executions/test-exec-123/stream'
      )
    })

    it('should use custom endpoint if provided', () => {
      renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          endpoint: '/custom/endpoint',
        })
      )

      expect(global.EventSource).toHaveBeenCalledWith('/custom/endpoint')
    })
  })

  describe('RUN Events', () => {
    it('should handle RUN_STARTED event', async () => {
      const onRunStarted = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onRunStarted },
        })
      )

      // Wait for connection to be established
      await waitFor(
        () => {
          expect(result.current.connectionStatus).toBe('connected')
        },
        { timeout: 2000 }
      )

      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.RUN_STARTED, {
          type: EventType.RUN_STARTED,
          runId: 'run-123',
          threadId: 'thread-456',
          timestamp: 1000,
        })
      })

      expect(result.current.execution.runId).toBe('run-123')
      expect(result.current.execution.threadId).toBe('thread-456')
      expect(result.current.execution.status).toBe('running')
      expect(onRunStarted).toHaveBeenCalledTimes(1)
    })

    it('should handle RUN_FINISHED event', async () => {
      const onRunFinished = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onRunFinished },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      // First send RUN_STARTED
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.RUN_STARTED, {
          type: EventType.RUN_STARTED,
          runId: 'run-123',
          threadId: 'thread-456',
        })
      })

      // Then send RUN_FINISHED
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.RUN_FINISHED, {
          type: EventType.RUN_FINISHED,
          runId: 'run-123',
          threadId: 'thread-456',
          timestamp: 2000,
        })
      })

      expect(result.current.execution.status).toBe('completed')
      expect(result.current.execution.endTime).toBe(2000)
      expect(onRunFinished).toHaveBeenCalledTimes(1)
    })

    it('should handle RUN_ERROR event', async () => {
      const onRunError = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onRunError },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.RUN_ERROR, {
          type: EventType.RUN_ERROR,
          message: 'Test error',
          timestamp: 3000,
        })
      })

      expect(result.current.execution.status).toBe('error')
      expect(result.current.execution.error).toBe('Test error')
      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe('Test error')
      expect(onRunError).toHaveBeenCalledTimes(1)
    })
  })

  describe('STEP Events', () => {
    it('should handle STEP_STARTED event', async () => {
      const onStepStarted = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onStepStarted },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.STEP_STARTED, {
          type: EventType.STEP_STARTED,
          stepName: 'process-data',
        })
      })

      expect(result.current.execution.currentStep).toBe('process-data')
      expect(onStepStarted).toHaveBeenCalledTimes(1)
    })

    it('should handle STEP_FINISHED event', async () => {
      const onStepFinished = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onStepFinished },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.STEP_FINISHED, {
          type: EventType.STEP_FINISHED,
          stepName: 'process-data',
        })
      })

      expect(onStepFinished).toHaveBeenCalledTimes(1)
    })
  })

  describe('TEXT_MESSAGE Events', () => {
    it('should buffer streaming text messages', async () => {
      const onMessage = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onMessage },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      // Start message
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TEXT_MESSAGE_START, {
          type: EventType.TEXT_MESSAGE_START,
          messageId: 'msg-1',
          role: 'assistant',
        })
      })

      expect(result.current.messages.get('msg-1')).toEqual({
        messageId: 'msg-1',
        role: 'assistant',
        content: '',
        complete: false,
      })

      // Add content chunks
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TEXT_MESSAGE_CONTENT, {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'msg-1',
          delta: 'Hello ',
        })
      })

      expect(result.current.messages.get('msg-1')?.content).toBe('Hello ')

      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TEXT_MESSAGE_CONTENT, {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'msg-1',
          delta: 'world!',
        })
      })

      expect(result.current.messages.get('msg-1')?.content).toBe('Hello world!')
      expect(onMessage).toHaveBeenCalledTimes(2)

      // End message
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TEXT_MESSAGE_END, {
          type: EventType.TEXT_MESSAGE_END,
          messageId: 'msg-1',
        })
      })

      expect(result.current.messages.get('msg-1')?.complete).toBe(true)
      expect(onMessage).toHaveBeenCalledTimes(3)
    })
  })

  describe('TOOL_CALL Events', () => {
    it('should track tool calls from start to result', async () => {
      const onToolCallStart = vi.fn()
      const onToolCallEnd = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onToolCallStart, onToolCallEnd },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      // Start tool call
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TOOL_CALL_START, {
          type: EventType.TOOL_CALL_START,
          toolCallId: 'tool-1',
          toolCallName: 'Read',
          timestamp: 1000,
        })
      })

      expect(result.current.toolCalls.get('tool-1')).toMatchObject({
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        status: 'started',
        args: '',
      })
      expect(onToolCallStart).toHaveBeenCalledTimes(1)

      // Add args
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TOOL_CALL_ARGS, {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: 'tool-1',
          delta: '{"file":"test.ts"}',
        })
      })

      expect(result.current.toolCalls.get('tool-1')?.args).toBe('{"file":"test.ts"}')
      expect(result.current.toolCalls.get('tool-1')?.status).toBe('executing')

      // End tool call
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TOOL_CALL_END, {
          type: EventType.TOOL_CALL_END,
          toolCallId: 'tool-1',
          timestamp: 2000,
        })
      })

      expect(result.current.toolCalls.get('tool-1')?.endTime).toBe(2000)
      expect(onToolCallEnd).toHaveBeenCalledTimes(1)

      // Result
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.TOOL_CALL_RESULT, {
          type: EventType.TOOL_CALL_RESULT,
          messageId: 'msg-1',
          toolCallId: 'tool-1',
          content: 'File contents here',
        })
      })

      expect(result.current.toolCalls.get('tool-1')?.result).toBe('File contents here')
      expect(result.current.toolCalls.get('tool-1')?.status).toBe('completed')
    })
  })

  describe('STATE Events', () => {
    it('should handle STATE_SNAPSHOT event', async () => {
      const onStateUpdate = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onStateUpdate },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.STATE_SNAPSHOT, {
          type: EventType.STATE_SNAPSHOT,
          snapshot: {
            progress: 50,
            totalSteps: 100,
          },
        })
      })

      expect(result.current.state).toEqual({
        progress: 50,
        totalSteps: 100,
      })
      expect(onStateUpdate).toHaveBeenCalledWith({
        progress: 50,
        totalSteps: 100,
      })
    })

    it('should handle STATE_DELTA event with replace operation', async () => {
      const onStateUpdate = vi.fn()
      const { result } = renderHook(() =>
        useAgUiStream({
          executionId: 'test-exec-1',
          onEvent: { onStateUpdate },
        })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      // Set initial state
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.STATE_SNAPSHOT, {
          type: EventType.STATE_SNAPSHOT,
          snapshot: { progress: 0 },
        })
      })

      // Apply delta
      act(() => {
        mockEventSourceInstance?.simulateEvent(EventType.STATE_DELTA, {
          type: EventType.STATE_DELTA,
          delta: [
            { op: 'replace', path: '/progress', value: 75 },
          ],
        })
      })

      expect(result.current.state.progress).toBe(75)
      expect(onStateUpdate).toHaveBeenCalledTimes(2)
    })
  })

  describe('Cleanup', () => {
    it('should cleanup on unmount', async () => {
      const { result, unmount } = renderHook(() =>
        useAgUiStream({ executionId: 'test-exec-1' })
      )

      await waitFor(() => expect(result.current.connectionStatus).toBe('connected'), { timeout: 2000 })

      expect(mockEventSourceInstance?.readyState).toBe(1) // OPEN

      unmount()

      expect(mockEventSourceInstance?.readyState).toBe(2) // CLOSED
    })
  })
})
