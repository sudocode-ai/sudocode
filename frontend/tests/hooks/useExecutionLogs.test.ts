/**
 * useExecutionLogs Hook Tests
 *
 * Tests for the execution logs fetching React hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import { AxiosError } from 'axios'

// Mock the api module
vi.mock('@/lib/api', () => {
  const mockApiGet = vi.fn()
  return {
    default: {
      get: mockApiGet,
    },
    mockApiGet, // Export for test access
  }
})

// Get the mocked api.get function
import api from '@/lib/api'
const mockApiGet = (api as any).get

describe('useExecutionLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Functionality', () => {
    it('should fetch logs on mount', async () => {
      // Mock response data - API now returns events directly (already transformed)
      const mockEvents = [{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello world' }]

      const mockData = {
        executionId: 'exec-123',
        events: mockEvents,
        metadata: {
          lineCount: 1,
          byteSize: 100,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      }

      mockApiGet.mockResolvedValueOnce(mockData)

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      // Initially loading
      expect(result.current.loading).toBe(true)
      expect(result.current.events).toEqual([])
      expect(result.current.error).toBeNull()

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Verify api.get was called correctly
      expect(mockApiGet).toHaveBeenCalledWith('/executions/exec-123/logs', {
        signal: expect.any(AbortSignal),
      })

      // Verify state is updated (events come directly from API, no client-side parsing)
      expect(result.current.events).toEqual(mockEvents)
      expect(result.current.metadata).toEqual(mockData.metadata)
      expect(result.current.error).toBeNull()
    })

    it('should receive AG-UI events from API', async () => {
      // API returns pre-transformed AG-UI events
      const mockEvents = [
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello' },
        { type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolName: 'Read' },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        metadata: { lineCount: 2, byteSize: 200, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Events come directly from API (server-side transformation)
      expect(result.current.events).toEqual(mockEvents)
    })

    it('should handle empty logs', async () => {
      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: [],
        metadata: { lineCount: 0, byteSize: 0, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.events).toEqual([])
      expect(result.current.metadata?.lineCount).toBe(0)
      expect(result.current.error).toBeNull()
    })

    it('should handle large logs (1000+ lines)', async () => {
      const largeEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: 'TEXT_MESSAGE_CONTENT',
        delta: `Message ${i}`,
      }))

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: largeEvents,
        metadata: { lineCount: 1000, byteSize: 50000, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.events).toHaveLength(1000)
      expect(result.current.metadata?.lineCount).toBe(1000)
    })
  })

  describe('Error Handling', () => {
    it('should handle 404 errors', async () => {
      const axiosError = new AxiosError('Request failed with status code 404')
      axiosError.response = {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {},
        config: {} as any,
      }
      mockApiGet.mockRejectedValueOnce(axiosError)

      const { result } = renderHook(() => useExecutionLogs('exec-404'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toContain('404')
      expect(result.current.events).toEqual([])
      expect(result.current.metadata).toBeNull()
    })

    it('should handle 500 errors', async () => {
      const axiosError = new AxiosError('Request failed with status code 500')
      axiosError.response = {
        status: 500,
        statusText: 'Internal Server Error',
        data: {},
        headers: {},
        config: {} as any,
      }
      mockApiGet.mockRejectedValueOnce(axiosError)

      const { result } = renderHook(() => useExecutionLogs('exec-500'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toContain('500')
    })

    it('should handle network errors', async () => {
      const networkError = new AxiosError('Network Error')
      networkError.code = 'ERR_NETWORK'
      mockApiGet.mockRejectedValueOnce(networkError)

      const { result } = renderHook(() => useExecutionLogs('exec-net-err'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toContain('Network')
    })

    it('should handle malformed API response', async () => {
      // API returns invalid response structure
      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        // Missing 'events' field - this would cause an error
        metadata: { lineCount: 1, byteSize: 12, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-parse-err'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Should handle gracefully - events will be undefined which the hook should handle
      expect(result.current.events).toEqual([])
    })

    it('should handle API error responses', async () => {
      const axiosError = new AxiosError('Database connection failed')
      axiosError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Database connection failed' },
        headers: {},
        config: {} as any,
      }
      mockApiGet.mockRejectedValueOnce(axiosError)

      const { result } = renderHook(() => useExecutionLogs('exec-api-err'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
    })
  })

  describe('Execution ID Changes', () => {
    it('should re-fetch when executionId changes', async () => {
      const mockData1 = {
        executionId: 'exec-1',
        events: [{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Event 1' }],
        metadata: { lineCount: 1, byteSize: 10, createdAt: '', updatedAt: '' },
      }

      const mockData2 = {
        executionId: 'exec-2',
        events: [{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Event 2' }],
        metadata: { lineCount: 1, byteSize: 10, createdAt: '', updatedAt: '' },
      }

      mockApiGet.mockResolvedValueOnce(mockData1).mockResolvedValueOnce(mockData2)

      const { result, rerender } = renderHook(({ id }) => useExecutionLogs(id), {
        initialProps: { id: 'exec-1' },
      })

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.events).toEqual([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Event 1' }])

      // Change execution ID
      rerender({ id: 'exec-2' })

      // Should be loading again
      expect(result.current.loading).toBe(true)

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(mockApiGet).toHaveBeenCalledTimes(2)
      expect(result.current.events).toEqual([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Event 2' }])
    })

    it('should abort previous request on ID change', async () => {
      let abortedSignal: AbortSignal | null = null

      mockApiGet.mockImplementation((_url: string, options?: any) => {
        abortedSignal = options?.signal
        return new Promise(() => {}) // Never resolves
      })

      const { rerender } = renderHook(({ id }) => useExecutionLogs(id), {
        initialProps: { id: 'exec-1' },
      })

      // Give it time to start the fetch
      await new Promise((resolve) => setTimeout(resolve, 10))

      const firstSignal = abortedSignal!
      expect(firstSignal).not.toBeNull()
      expect(firstSignal.aborted).toBe(false)

      // Change execution ID
      rerender({ id: 'exec-2' })

      // Previous request should be aborted
      expect(firstSignal.aborted).toBe(true)
    })

    it('should reset state when ID changes', async () => {
      mockApiGet
        .mockResolvedValueOnce({
          executionId: 'exec-1',
          events: [{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Event 1' }],
          metadata: { lineCount: 1, byteSize: 10, createdAt: '', updatedAt: '' },
        })
        .mockImplementation(
          () => new Promise(() => {}) // Second request never resolves
        )

      const { result, rerender } = renderHook(({ id }) => useExecutionLogs(id), {
        initialProps: { id: 'exec-1' },
      })

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.events).toEqual([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'Event 1' }])

      // Change execution ID
      rerender({ id: 'exec-2' })

      // State should be reset immediately
      expect(result.current.loading).toBe(true)
      expect(result.current.events).toEqual([])
      expect(result.current.metadata).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('Loading States', () => {
    it('should set loading state correctly', async () => {
      const loadingStates: boolean[] = []

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: [],
        metadata: { lineCount: 0, byteSize: 0, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      // Track loading states
      loadingStates.push(result.current.loading)

      await waitFor(() => expect(result.current.loading).toBe(false))

      loadingStates.push(result.current.loading)

      // Should start as true, then become false
      expect(loadingStates).toEqual([true, false])
    })

    it('should set loading to false even on error', async () => {
      mockApiGet.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      expect(result.current.loading).toBe(true)

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.loading).toBe(false)
      expect(result.current.error).not.toBeNull()
    })
  })

  describe('Cleanup', () => {
    it('should abort fetch on unmount', async () => {
      let abortedSignal: AbortSignal | null = null

      mockApiGet.mockImplementation((_url: string, options?: any) => {
        abortedSignal = options?.signal
        return new Promise(() => {}) // Never resolves
      })

      const { unmount } = renderHook(() => useExecutionLogs('exec-123'))

      // Give it time to start the fetch
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(abortedSignal).not.toBeNull()
      expect(abortedSignal!.aborted).toBe(false)

      // Unmount
      unmount()

      // Should be aborted
      expect(abortedSignal!.aborted).toBe(true)
    })

    it('should not update state after abort', async () => {
      mockApiGet.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                executionId: 'exec-123',
                events: [],
                metadata: { lineCount: 0, byteSize: 0, createdAt: '', updatedAt: '' },
              })
            }, 100)
          })
      )

      const { result, unmount } = renderHook(() => useExecutionLogs('exec-123'))

      // Unmount immediately
      unmount()

      // Wait for the fetch to "complete"
      await new Promise((resolve) => setTimeout(resolve, 150))

      // State should still be initial values (not updated after abort)
      expect(result.current.loading).toBe(true)
      expect(result.current.events).toEqual([])
    })
  })

  describe('processCoalescedEvents - User Messages', () => {
    it('should process user_message_complete events', async () => {
      // Mock ACP format events with user message
      const mockEvents = [
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'Hello, how can I help?' },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          sessionUpdate: 'user_message_complete',
          content: { type: 'text', text: 'Can you read the file?' },
          timestamp: '2025-01-01T00:00:01Z',
        },
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'Sure, let me read that file.' },
          timestamp: '2025-01-01T00:00:02Z',
        },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        format: 'acp',
        metadata: { lineCount: 3, byteSize: 300, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Should have 3 messages total
      expect(result.current.processed.messages).toHaveLength(3)

      // First message should be agent message (no role or role='agent')
      expect(result.current.processed.messages[0].content).toBe('Hello, how can I help?')
      expect(result.current.processed.messages[0].role).toBeUndefined()

      // Second message should be user message with role='user'
      expect(result.current.processed.messages[1].content).toBe('Can you read the file?')
      expect(result.current.processed.messages[1].role).toBe('user')

      // Third message should be agent message
      expect(result.current.processed.messages[2].content).toBe('Sure, let me read that file.')
      expect(result.current.processed.messages[2].role).toBeUndefined()
    })

    it('should assign sequential indices to user messages', async () => {
      const mockEvents = [
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'First agent message' },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          sessionUpdate: 'user_message_complete',
          content: { type: 'text', text: 'User prompt' },
          timestamp: '2025-01-01T00:00:01Z',
        },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        format: 'acp',
        metadata: { lineCount: 2, byteSize: 200, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Check indices are sequential
      expect(result.current.processed.messages[0].index).toBe(0)
      expect(result.current.processed.messages[1].index).toBe(1)
    })

    it('should generate user-msg ID prefix for user messages', async () => {
      const mockEvents = [
        {
          sessionUpdate: 'user_message_complete',
          content: { type: 'text', text: 'User message' },
          timestamp: '2025-01-01T00:00:00Z',
        },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        format: 'acp',
        metadata: { lineCount: 1, byteSize: 100, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // User messages should have 'user-msg-' prefix
      expect(result.current.processed.messages[0].id).toMatch(/^user-msg-/)
    })
  })

  describe('Global Index Ordering', () => {
    it('should assign sequential global indices across messages and tool calls', async () => {
      // Events interleaved: message, tool call, message, tool call
      const mockEvents = [
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'First message' },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          sessionUpdate: 'tool_call_complete',
          toolCallId: 'tool-1',
          title: 'Read file',
          status: 'completed',
          timestamp: '2025-01-01T00:00:01Z',
        },
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'Second message' },
          timestamp: '2025-01-01T00:00:02Z',
        },
        {
          sessionUpdate: 'tool_call_complete',
          toolCallId: 'tool-2',
          title: 'Write file',
          status: 'completed',
          timestamp: '2025-01-01T00:00:03Z',
        },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        format: 'acp',
        metadata: { lineCount: 4, byteSize: 400, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Messages should have indices 0, 2 (not 0, 1)
      expect(result.current.processed.messages[0].index).toBe(0)
      expect(result.current.processed.messages[1].index).toBe(2)

      // Tool calls should have indices 1, 3 (not 0, 1)
      expect(result.current.processed.toolCalls[0].index).toBe(1)
      expect(result.current.processed.toolCalls[1].index).toBe(3)
    })

    it('should maintain correct order when sorted by index', async () => {
      // Complex interleaving: user message, agent message, tool call, agent message
      const mockEvents = [
        {
          sessionUpdate: 'user_message_complete',
          content: { type: 'text', text: 'User prompt' },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'Let me help' },
          timestamp: '2025-01-01T00:00:01Z',
        },
        {
          sessionUpdate: 'tool_call_complete',
          toolCallId: 'tool-1',
          title: 'Bash',
          status: 'completed',
          timestamp: '2025-01-01T00:00:02Z',
        },
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'Done!' },
          timestamp: '2025-01-01T00:00:03Z',
        },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        format: 'acp',
        metadata: { lineCount: 4, byteSize: 400, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Combine all items and sort by index (like AgentTrajectory does)
      const allItems = [
        ...result.current.processed.messages.map((m) => ({ type: 'message', index: m.index, content: m.content })),
        ...result.current.processed.toolCalls.map((tc) => ({ type: 'tool_call', index: tc.index, title: tc.title })),
      ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

      // Should maintain original chronological order
      expect(allItems[0]).toMatchObject({ type: 'message', index: 0, content: 'User prompt' })
      expect(allItems[1]).toMatchObject({ type: 'message', index: 1, content: 'Let me help' })
      expect(allItems[2]).toMatchObject({ type: 'tool_call', index: 2, title: 'Bash' })
      expect(allItems[3]).toMatchObject({ type: 'message', index: 3, content: 'Done!' })
    })

    it('should include thoughts in global index sequence', async () => {
      const mockEvents = [
        {
          sessionUpdate: 'agent_message_complete',
          content: { type: 'text', text: 'Message' },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          sessionUpdate: 'agent_thought_complete',
          content: { type: 'text', text: 'Thinking...' },
          timestamp: '2025-01-01T00:00:01Z',
        },
        {
          sessionUpdate: 'tool_call_complete',
          toolCallId: 'tool-1',
          title: 'Read',
          status: 'completed',
          timestamp: '2025-01-01T00:00:02Z',
        },
      ]

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: mockEvents,
        format: 'acp',
        metadata: { lineCount: 3, byteSize: 300, createdAt: '', updatedAt: '' },
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      // All should have sequential indices
      expect(result.current.processed.messages[0].index).toBe(0)
      expect(result.current.processed.thoughts[0].index).toBe(1)
      expect(result.current.processed.toolCalls[0].index).toBe(2)
    })
  })

  describe('Metadata', () => {
    it('should return metadata from response', async () => {
      const mockMetadata = {
        lineCount: 42,
        byteSize: 1024,
        createdAt: '2025-01-01T10:00:00Z',
        updatedAt: '2025-01-01T11:00:00Z',
      }

      mockApiGet.mockResolvedValueOnce({
        executionId: 'exec-123',
        events: [],
        metadata: mockMetadata,
      })

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.metadata).toEqual(mockMetadata)
    })

    it('should set metadata to null on error', async () => {
      mockApiGet.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.metadata).toBeNull()
    })
  })
})
