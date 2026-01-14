/**
 * useSessionUpdateStream Hook Tests
 *
 * Tests for the ACP SessionUpdate event streaming React hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionUpdateStream } from '@/hooks/useSessionUpdateStream'

// ============================================================================
// Mocks
// ============================================================================

// Track message handlers
const messageHandlers = new Map<string, (message: any) => void>()
const subscriptions = new Set<string>()

// Mock WebSocket context
const mockSubscribe = vi.fn((entityType: string, entityId?: string) => {
  subscriptions.add(`${entityType}:${entityId}`)
})

const mockUnsubscribe = vi.fn((entityType: string, entityId?: string) => {
  subscriptions.delete(`${entityType}:${entityId}`)
})

const mockAddMessageHandler = vi.fn((id: string, handler: (message: any) => void) => {
  messageHandlers.set(id, handler)
})

const mockRemoveMessageHandler = vi.fn((id: string) => {
  messageHandlers.delete(id)
})

// Mock WebSocketContext
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: true,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    addMessageHandler: mockAddMessageHandler,
    removeMessageHandler: mockRemoveMessageHandler,
    sendMessage: vi.fn(),
  }),
}))

// Helper to simulate WebSocket messages
function simulateMessage(message: any) {
  messageHandlers.forEach((handler) => {
    handler(message)
  })
}

// Helper to create session_update WebSocket message
function createSessionUpdateMessage(executionId: string, update: any) {
  return {
    type: 'session_update',
    data: {
      executionId,
      update,
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('useSessionUpdateStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messageHandlers.clear()
    subscriptions.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    messageHandlers.clear()
    subscriptions.clear()
  })

  describe('Initialization', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      expect(result.current.messages).toEqual([])
      expect(result.current.toolCalls).toEqual([])
      expect(result.current.thoughts).toEqual([])
      expect(result.current.isStreaming).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should subscribe to WebSocket on mount', () => {
      renderHook(() => useSessionUpdateStream('exec-123'))

      expect(mockSubscribe).toHaveBeenCalledWith('execution', 'exec-123')
      expect(mockAddMessageHandler).toHaveBeenCalled()
    })

    it('should unsubscribe from WebSocket on unmount', () => {
      const { unmount } = renderHook(() => useSessionUpdateStream('exec-123'))

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalledWith('execution', 'exec-123')
      expect(mockRemoveMessageHandler).toHaveBeenCalled()
    })

    it('should not subscribe when executionId is null', () => {
      renderHook(() => useSessionUpdateStream(null))

      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('should reset state when executionId changes', () => {
      const { result, rerender } = renderHook(
        ({ executionId }) => useSessionUpdateStream(executionId),
        { initialProps: { executionId: 'exec-1' } }
      )

      // Simulate receiving some data
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-1', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Hello' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(1)

      // Change execution ID
      rerender({ executionId: 'exec-2' })

      // State should be reset
      expect(result.current.messages).toEqual([])
      expect(result.current.toolCalls).toEqual([])
      expect(result.current.thoughts).toEqual([])
    })
  })

  describe('Agent Message Events', () => {
    it('should handle agent_message_chunk streaming', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // First chunk
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello ' },
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Hello ')
      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.isStreaming).toBe(true)

      // Second chunk
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'world!' },
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Hello world!')
      expect(result.current.messages[0].isStreaming).toBe(true)
    })

    it('should handle agent_message_complete (coalesced)', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      const timestamp = new Date().toISOString()

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Complete message' },
            timestamp,
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Complete message')
      expect(result.current.messages[0].isStreaming).toBe(false)
      expect(result.current.isStreaming).toBe(false)
    })

    it('should finalize streaming message with agent_message_complete', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Streaming...' },
          })
        )
      })

      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.isStreaming).toBe(true)

      // Finalize with complete
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Final content' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Final content')
      expect(result.current.messages[0].isStreaming).toBe(false)
      expect(result.current.isStreaming).toBe(false)
    })

    it('should handle multiple sequential messages', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // First message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'First message' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // Second message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Second message' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(2)
      expect(result.current.messages[0].content).toBe('First message')
      expect(result.current.messages[1].content).toBe('Second message')
    })
  })

  describe('Agent Thought Events', () => {
    it('should handle agent_thought_chunk streaming', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // First chunk
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thinking about ' },
          })
        )
      })

      expect(result.current.thoughts.length).toBe(1)
      expect(result.current.thoughts[0].content).toBe('Thinking about ')
      expect(result.current.thoughts[0].isStreaming).toBe(true)
      expect(result.current.isStreaming).toBe(true)

      // Second chunk
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'the problem...' },
          })
        )
      })

      expect(result.current.thoughts.length).toBe(1)
      expect(result.current.thoughts[0].content).toBe('Thinking about the problem...')
    })

    it('should handle agent_thought_complete (coalesced)', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      const timestamp = new Date().toISOString()

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_complete',
            content: { type: 'text', text: 'Complete thought' },
            timestamp,
          })
        )
      })

      expect(result.current.thoughts.length).toBe(1)
      expect(result.current.thoughts[0].content).toBe('Complete thought')
      expect(result.current.thoughts[0].isStreaming).toBe(false)
      expect(result.current.isStreaming).toBe(false)
    })

    it('should finalize streaming thought with agent_thought_complete', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Streaming thought...' },
          })
        )
      })

      expect(result.current.thoughts[0].isStreaming).toBe(true)

      // Finalize with complete
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_complete',
            content: { type: 'text', text: 'Final thought' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.thoughts.length).toBe(1)
      expect(result.current.thoughts[0].content).toBe('Final thought')
      expect(result.current.thoughts[0].isStreaming).toBe(false)
    })
  })

  describe('User Message Events', () => {
    it('should handle user_message_chunk streaming', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // First chunk
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'Can you ' },
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Can you ')
      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.isStreaming).toBe(true)

      // Second chunk
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'help me?' },
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Can you help me?')
      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.messages[0].role).toBe('user')
    })

    it('should handle user_message_complete (coalesced)', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      const timestamp = new Date().toISOString()

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_complete',
            content: { type: 'text', text: 'Complete user message' },
            timestamp,
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Complete user message')
      expect(result.current.messages[0].isStreaming).toBe(false)
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.isStreaming).toBe(false)
    })

    it('should finalize streaming user message with user_message_complete', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'Streaming...' },
          })
        )
      })

      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.isStreaming).toBe(true)

      // Finalize with complete
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_complete',
            content: { type: 'text', text: 'Final user content' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Final user content')
      expect(result.current.messages[0].isStreaming).toBe(false)
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.isStreaming).toBe(false)
    })

    it('should finalize streaming agent message before processing user_message_complete', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming agent message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Agent is typing...' },
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.messages[0].role).toBeUndefined()

      // User sends a complete message - should finalize agent message first
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_complete',
            content: { type: 'text', text: 'User prompt' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // Now should have 2 messages: finalized agent message + user message
      expect(result.current.messages.length).toBe(2)

      // Agent message should be finalized
      const agentMsg = result.current.messages.find((m) => !m.role || m.role === 'agent')
      expect(agentMsg).toBeDefined()
      expect(agentMsg?.isStreaming).toBe(false)

      // User message should be added with role='user'
      const userMsg = result.current.messages.find((m) => m.role === 'user')
      expect(userMsg).toBeDefined()
      expect(userMsg?.content).toBe('User prompt')
      expect(userMsg?.isStreaming).toBe(false)
    })

    it('should handle multiple sequential user messages in persistent session', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // First agent message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Hello!' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // First user message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_complete',
            content: { type: 'text', text: 'Hi, help me with a bug' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // Agent response
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Sure, tell me more' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // Second user message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'user_message_complete',
            content: { type: 'text', text: 'The test is failing' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(4)

      // Check order and roles
      const msgs = result.current.messages
      expect(msgs[0].role).toBeUndefined() // Agent: Hello!
      expect(msgs[1].role).toBe('user') // User: Hi, help me with a bug
      expect(msgs[2].role).toBeUndefined() // Agent: Sure, tell me more
      expect(msgs[3].role).toBe('user') // User: The test is failing
    })
  })

  describe('Tool Call Events', () => {
    it('should handle tool_call event (streaming)', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Reading file.ts',
            status: 'pending',
            rawInput: { path: 'file.ts' },
          })
        )
      })

      expect(result.current.toolCalls.length).toBe(1)
      expect(result.current.toolCalls[0].id).toBe('tool-1')
      expect(result.current.toolCalls[0].title).toBe('Reading file.ts')
      expect(result.current.toolCalls[0].status).toBe('pending')
      expect(result.current.toolCalls[0].rawInput).toEqual({ path: 'file.ts' })
    })

    it('should handle tool_call_update event (streaming)', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Create initial tool call
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Reading file',
            status: 'pending',
          })
        )
      })

      expect(result.current.toolCalls[0].status).toBe('pending')

      // Update status to in_progress
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-1',
            status: 'in_progress',
          })
        )
      })

      expect(result.current.toolCalls[0].status).toBe('running')

      // Update status to completed
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-1',
            status: 'completed',
            rawOutput: { content: 'file contents' },
          })
        )
      })

      expect(result.current.toolCalls[0].status).toBe('success')
      expect(result.current.toolCalls[0].rawOutput).toEqual({ content: 'file contents' })
      expect(result.current.toolCalls[0].completedAt).toBeInstanceOf(Date)
    })

    it('should handle tool_call_update with failed status', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Create initial tool call
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Reading file',
            status: 'in_progress',
          })
        )
      })

      // Update status to failed
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-1',
            status: 'failed',
          })
        )
      })

      expect(result.current.toolCalls[0].status).toBe('failed')
      expect(result.current.toolCalls[0].completedAt).toBeInstanceOf(Date)
    })

    it('should handle tool_call_complete (coalesced)', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      const timestamp = new Date().toISOString()
      const completedAt = new Date().toISOString()

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call_complete',
            toolCallId: 'tool-1',
            title: 'Read file.ts',
            status: 'completed',
            result: { content: 'file contents' },
            rawInput: { path: 'file.ts' },
            rawOutput: { success: true },
            timestamp,
            completedAt,
          })
        )
      })

      expect(result.current.toolCalls.length).toBe(1)
      expect(result.current.toolCalls[0].id).toBe('tool-1')
      expect(result.current.toolCalls[0].title).toBe('Read file.ts')
      expect(result.current.toolCalls[0].status).toBe('success')
      expect(result.current.toolCalls[0].result).toEqual({ content: 'file contents' })
      expect(result.current.toolCalls[0].rawInput).toEqual({ path: 'file.ts' })
      expect(result.current.toolCalls[0].rawOutput).toEqual({ success: true })
      expect(result.current.toolCalls[0].timestamp).toBeInstanceOf(Date)
      expect(result.current.toolCalls[0].completedAt).toBeInstanceOf(Date)
    })

    it('should handle multiple tool calls', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Read file1.ts',
            status: 'completed',
          })
        )
      })

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-2',
            title: 'Write file2.ts',
            status: 'in_progress',
          })
        )
      })

      expect(result.current.toolCalls.length).toBe(2)
      expect(result.current.toolCalls[0].id).toBe('tool-1')
      expect(result.current.toolCalls[1].id).toBe('tool-2')
    })
  })

  describe('Message Filtering', () => {
    it('should ignore messages from different executions', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-456', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Wrong execution' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(0)
    })

    it('should ignore non-session_update messages', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      act(() => {
        simulateMessage({
          type: 'execution_updated',
          data: { id: 'exec-123' },
        })
      })

      expect(result.current.messages.length).toBe(0)
      expect(result.current.toolCalls.length).toBe(0)
    })

    it('should handle malformed messages gracefully', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Missing data
      act(() => {
        simulateMessage({
          type: 'session_update',
        })
      })

      expect(result.current.messages.length).toBe(0)
      expect(result.current.error).toBeNull()

      // Missing update
      act(() => {
        simulateMessage({
          type: 'session_update',
          data: { executionId: 'exec-123' },
        })
      })

      expect(result.current.messages.length).toBe(0)
      expect(result.current.error).toBeNull()
    })
  })

  describe('Mixed Event Handling', () => {
    it('should handle interleaved messages, thoughts, and tool calls', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Starting task...' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // Thought
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_complete',
            content: { type: 'text', text: 'Let me think...' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      // Tool call
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Reading file',
            status: 'in_progress',
          })
        )
      })

      // Another message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Done!' },
            timestamp: new Date().toISOString(),
          })
        )
      })

      expect(result.current.messages.length).toBe(2)
      expect(result.current.thoughts.length).toBe(1)
      expect(result.current.toolCalls.length).toBe(1)
    })

    it('should handle streaming messages and thoughts simultaneously', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start message streaming
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Message: ' },
          })
        )
      })

      // Start thought streaming
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thought: ' },
          })
        )
      })

      // Continue message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'continued' },
          })
        )
      })

      // Continue thought
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'continued' },
          })
        )
      })

      expect(result.current.messages.length).toBe(1)
      expect(result.current.messages[0].content).toBe('Message: continued')
      expect(result.current.thoughts.length).toBe(1)
      expect(result.current.thoughts[0].content).toBe('Thought: continued')
    })
  })

  describe('Status Mapping', () => {
    it('should map ACP tool call statuses correctly', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Test pending status
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-pending',
            title: 'Test',
            status: 'pending',
          })
        )
      })
      expect(result.current.toolCalls.find((t) => t.id === 'tool-pending')?.status).toBe('pending')

      // Test in_progress status -> running
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-progress',
            title: 'Test',
            status: 'in_progress',
          })
        )
      })
      expect(result.current.toolCalls.find((t) => t.id === 'tool-progress')?.status).toBe('running')

      // Test completed status -> success
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-complete',
            title: 'Test',
            status: 'completed',
          })
        )
      })
      expect(result.current.toolCalls.find((t) => t.id === 'tool-complete')?.status).toBe('success')

      // Test failed status
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-failed',
            title: 'Test',
            status: 'failed',
          })
        )
      })
      expect(result.current.toolCalls.find((t) => t.id === 'tool-failed')?.status).toBe('failed')
    })

    it('should default to pending for missing/unknown status', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // No status provided
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-no-status',
            title: 'Test',
          })
        )
      })
      expect(result.current.toolCalls.find((t) => t.id === 'tool-no-status')?.status).toBe(
        'pending'
      )
    })
  })

  describe('Date Handling', () => {
    it('should parse ISO date strings', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      const timestamp = '2024-01-15T10:30:00.000Z'

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Test' },
            timestamp,
          })
        )
      })

      expect(result.current.messages[0].timestamp).toBeInstanceOf(Date)
      expect(result.current.messages[0].timestamp.toISOString()).toBe(timestamp)
    })

    it('should handle Date objects directly', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      const timestamp = new Date('2024-01-15T10:30:00.000Z')

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call_complete',
            toolCallId: 'tool-1',
            title: 'Test',
            status: 'completed',
            timestamp,
            completedAt: timestamp,
          })
        )
      })

      expect(result.current.toolCalls[0].timestamp).toBeInstanceOf(Date)
      expect(result.current.toolCalls[0].completedAt).toBeInstanceOf(Date)
    })
  })

  describe('Execution Lifecycle Finalization', () => {
    it('should finalize streaming messages when execution completes', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming a message
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Streaming message...' },
          })
        )
      })

      expect(result.current.messages[0].isStreaming).toBe(true)

      // Simulate execution completion
      act(() => {
        simulateMessage({
          type: 'execution_status_changed',
          data: {
            id: 'exec-123',
            status: 'completed',
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        })
      })

      // Message should be finalized (no longer streaming)
      expect(result.current.messages[0].isStreaming).toBe(false)
    })

    it('should finalize streaming thoughts when execution completes', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming a thought
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thinking...' },
          })
        )
      })

      expect(result.current.thoughts[0].isStreaming).toBe(true)

      // Simulate execution completion
      act(() => {
        simulateMessage({
          type: 'execution_status_changed',
          data: {
            id: 'exec-123',
            status: 'completed',
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        })
      })

      // Thought should be finalized
      expect(result.current.thoughts[0].isStreaming).toBe(false)
    })

    it('should mark pending/running tool calls as failed when execution errors', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start a tool call
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Reading file',
            status: 'in_progress',
          })
        )
      })

      expect(result.current.toolCalls[0].status).toBe('running')

      // Simulate execution error
      act(() => {
        simulateMessage({
          type: 'execution_status_changed',
          data: {
            id: 'exec-123',
            status: 'failed',
            error_message: 'Something went wrong',
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        })
      })

      // Tool call should be marked as failed
      expect(result.current.toolCalls[0].status).toBe('failed')
      expect(result.current.toolCalls[0].completedAt).toBeInstanceOf(Date)
    })

    it('should finalize all streaming content when execution is cancelled', () => {
      const { result } = renderHook(() => useSessionUpdateStream('exec-123'))

      // Start streaming message and thought
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Message...' },
          })
        )
      })

      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thought...' },
          })
        )
      })

      // At this point, both are still streaming (no tool call yet)
      expect(result.current.messages[0].isStreaming).toBe(true)
      expect(result.current.thoughts[0].isStreaming).toBe(true)

      // Start a tool call - this finalizes the previous message and thought
      // because a tool call starting signals the end of the preceding text content
      act(() => {
        simulateMessage(
          createSessionUpdateMessage('exec-123', {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Writing file',
            status: 'in_progress',
          })
        )
      })

      // Message and thought should be finalized by the tool_call
      expect(result.current.messages[0].isStreaming).toBe(false)
      expect(result.current.thoughts[0].isStreaming).toBe(false)
      expect(result.current.toolCalls[0].status).toBe('running')

      // Simulate execution cancellation
      act(() => {
        simulateMessage({
          type: 'execution_status_changed',
          data: {
            id: 'exec-123',
            status: 'cancelled',
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        })
      })

      // Tool call should be marked as failed on cancellation
      expect(result.current.messages[0].isStreaming).toBe(false)
      expect(result.current.thoughts[0].isStreaming).toBe(false)
      expect(result.current.toolCalls[0].status).toBe('failed')
      expect(result.current.isStreaming).toBe(false)
    })
  })
})
