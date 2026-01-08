/**
 * useSessionUpdateStream React Hook
 *
 * Consumes SessionUpdate events via WebSocket from the ACP execution stream.
 * Handles real-time agent execution updates including messages, tool calls, and thoughts.
 *
 * This replaces the AG-UI based useAgUiStream hook with ACP-native SessionUpdate events.
 *
 * @module hooks/useSessionUpdateStream
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { WebSocketMessage, Execution } from '@/types/api'

// ============================================================================
// Types
// ============================================================================

/**
 * Connection status (compatible with useAgUiStream)
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'

/**
 * Agent message (accumulated from agent_message_chunk or agent_message_complete)
 */
export interface AgentMessage {
  id: string
  content: string
  timestamp: Date
  isStreaming?: boolean
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Tool call tracking
 */
export interface ToolCall {
  id: string
  title: string
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: unknown
  rawInput?: unknown
  rawOutput?: unknown
  timestamp: Date
  completedAt?: Date
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Agent thought (accumulated from agent_thought_chunk or agent_thought_complete)
 */
export interface AgentThought {
  id: string
  content: string
  timestamp: Date
  isStreaming?: boolean
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Execution lifecycle tracking (compatible with useAgUiStream's WorkflowExecution)
 */
export interface ExecutionState {
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled' | 'stopped'
  error: string | null
  startTime: number | null
  endTime: number | null
}

/**
 * Hook options
 */
export interface UseSessionUpdateStreamOptions {
  /**
   * Execution ID to stream events from
   */
  executionId: string | null

  /**
   * Event handlers for lifecycle events
   */
  onEvent?: {
    onExecutionStarted?: (execution: Execution) => void
    onExecutionCompleted?: (execution: Execution) => void
    onExecutionError?: (execution: Execution, error: string) => void
    onMessage?: (message: AgentMessage) => void
    onToolCall?: (toolCall: ToolCall) => void
    onThought?: (thought: AgentThought) => void
  }
}

/**
 * Hook return type
 */
export interface UseSessionUpdateStreamResult {
  /** Connection status */
  connectionStatus: ConnectionStatus
  /** Execution lifecycle state */
  execution: ExecutionState
  /** Accumulated messages */
  messages: AgentMessage[]
  /** Tool calls with status */
  toolCalls: ToolCall[]
  /** Agent thoughts/reasoning */
  thoughts: AgentThought[]
  /** Whether currently receiving streaming updates */
  isStreaming: boolean
  /** Error if any */
  error: Error | null
  /** Whether WebSocket is connected */
  isConnected: boolean
}

// ============================================================================
// SessionUpdate type definitions (from ACP)
// ============================================================================

/**
 * Content block from ACP
 */
interface ContentBlock {
  type: 'text' | 'image' | 'audio' | 'resource_link' | 'resource'
  text?: string
  // Other fields not used in this hook
}

/**
 * Content chunk from ACP streaming
 */
interface ContentChunk {
  content: ContentBlock
}

/**
 * Tool call status from ACP
 */
type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/**
 * Streaming SessionUpdate types from ACP
 */
interface AgentMessageChunk extends ContentChunk {
  sessionUpdate: 'agent_message_chunk'
}

interface AgentThoughtChunk extends ContentChunk {
  sessionUpdate: 'agent_thought_chunk'
}

interface ToolCallEvent {
  sessionUpdate: 'tool_call'
  toolCallId: string
  title: string
  status?: ToolCallStatus
  rawInput?: unknown
  rawOutput?: unknown
}

interface ToolCallUpdateEvent {
  sessionUpdate: 'tool_call_update'
  toolCallId: string
  title?: string | null
  status?: ToolCallStatus | null
  rawInput?: unknown
  rawOutput?: unknown
}

/**
 * Coalesced SessionUpdate types (from legacy shim or storage)
 */
interface AgentMessageComplete {
  sessionUpdate: 'agent_message_complete'
  content: ContentBlock
  timestamp: string | Date
  /** Optional stable message ID for deduplication (from legacy agents) */
  messageId?: string
}

interface AgentThoughtComplete {
  sessionUpdate: 'agent_thought_complete'
  content: ContentBlock
  timestamp: string | Date
}

interface ToolCallComplete {
  sessionUpdate: 'tool_call_complete'
  toolCallId: string
  title: string
  status: ToolCallStatus
  result?: unknown
  rawInput?: unknown
  rawOutput?: unknown
  timestamp: string | Date
  completedAt?: string | Date
}

/**
 * Union of all SessionUpdate types we handle
 */
type SessionUpdate =
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCallEvent
  | ToolCallUpdateEvent
  | AgentMessageComplete
  | AgentThoughtComplete
  | ToolCallComplete

/**
 * WebSocket session_update message payload
 */
interface SessionUpdateMessage {
  update: SessionUpdate
  executionId: string
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Map ACP tool call status to our ToolCall status
 */
function mapToolCallStatus(status?: ToolCallStatus | null): ToolCall['status'] {
  if (!status) return 'pending'
  switch (status) {
    case 'pending':
      return 'pending'
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'success'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

/**
 * Extract text from a content block
 */
function getTextFromContentBlock(content: ContentBlock): string {
  if (content.type === 'text' && content.text) {
    return content.text
  }
  return ''
}

/**
 * Generate a unique ID for streaming messages/thoughts
 */
let streamIdCounter = 0
function generateStreamId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++streamIdCounter}`
}

/**
 * Parse a date from string or Date
 */
function parseDate(value: string | Date | undefined): Date {
  if (!value) return new Date()
  if (value instanceof Date) return value
  return new Date(value)
}

// ============================================================================
// Hook implementation
// ============================================================================

/**
 * Map execution status to our ExecutionState status
 */
function mapExecutionStatus(
  status: string
): ExecutionState['status'] {
  switch (status) {
    case 'preparing':
    case 'pending':
      return 'idle'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    case 'stopped':
      return 'stopped'
    default:
      return 'idle'
  }
}

/**
 * Initial execution state
 */
const initialExecutionState: ExecutionState = {
  runId: null,
  status: 'idle',
  error: null,
  startTime: null,
  endTime: null,
}

/**
 * useSessionUpdateStream Hook
 *
 * Subscribes to WebSocket messages for an execution and accumulates
 * SessionUpdate events into messages, tool calls, and thoughts.
 * Also tracks execution lifecycle via execution_status_changed events.
 *
 * @example
 * ```typescript
 * const {
 *   connectionStatus,
 *   execution,
 *   messages,
 *   toolCalls,
 *   thoughts,
 *   isStreaming,
 *   error,
 *   isConnected,
 * } = useSessionUpdateStream({ executionId: 'exec-123' })
 * ```
 */
export function useSessionUpdateStream(
  options: UseSessionUpdateStreamOptions | string | null
): UseSessionUpdateStreamResult {
  // Normalize options (support both string and options object for backwards compatibility)
  const normalizedOptions: UseSessionUpdateStreamOptions =
    typeof options === 'string' || options === null
      ? { executionId: options }
      : options

  const { executionId, onEvent } = normalizedOptions

  // State
  const [messages, setMessages] = useState<Map<string, AgentMessage>>(new Map())
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCall>>(new Map())
  const [thoughts, setThoughts] = useState<Map<string, AgentThought>>(new Map())
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [execution, setExecution] = useState<ExecutionState>(initialExecutionState)

  // Refs for tracking streaming state
  const currentMessageIdRef = useRef<string | null>(null)
  const currentThoughtIdRef = useRef<string | null>(null)
  const onEventRef = useRef(onEvent)

  // Update ref when onEvent changes
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  // WebSocket context
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Derive connection status from WebSocket connected state
  const connectionStatus: ConnectionStatus = useMemo(() => {
    if (!executionId) return 'idle'
    if (connected) return 'connected'
    return 'disconnected'
  }, [executionId, connected])

  // Generate a unique handler ID for this hook instance
  const handlerIdRef = useRef(`session-update-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  /**
   * Process a SessionUpdate event
   */
  const processUpdate = useCallback((update: SessionUpdate) => {
    switch (update.sessionUpdate) {
      // Streaming: agent_message_chunk
      case 'agent_message_chunk': {
        setIsStreaming(true)
        const text = getTextFromContentBlock(update.content)

        setMessages((prev) => {
          const next = new Map(prev)

          // Get or create current streaming message
          let messageId = currentMessageIdRef.current
          if (!messageId || !next.has(messageId) || !next.get(messageId)?.isStreaming) {
            // Start a new streaming message
            messageId = generateStreamId('msg')
            currentMessageIdRef.current = messageId
            next.set(messageId, {
              id: messageId,
              content: '',
              timestamp: new Date(),
              isStreaming: true,
            })
          }

          // Append text to current message
          const existing = next.get(messageId)!
          next.set(messageId, {
            ...existing,
            content: existing.content + text,
          })

          return next
        })
        break
      }

      // Coalesced: agent_message_complete
      case 'agent_message_complete': {
        const text = getTextFromContentBlock(update.content)
        // Use provided messageId (from legacy agents) or current streaming ID or generate new
        const messageId = update.messageId || currentMessageIdRef.current || generateStreamId('msg')

        setMessages((prev) => {
          const next = new Map(prev)
          const existing = next.get(messageId)

          if (existing) {
            // Update existing message (for legacy agent cumulative updates)
            next.set(messageId, {
              ...existing,
              content: text || existing.content,
              isStreaming: false,
            })
          } else {
            // Add complete message directly
            next.set(messageId, {
              id: messageId,
              content: text,
              timestamp: parseDate(update.timestamp),
              isStreaming: false,
            })
          }

          return next
        })

        // Only reset current message tracking if this wasn't a legacy agent update
        // (legacy agents provide their own messageId and may send more updates)
        if (!update.messageId) {
          currentMessageIdRef.current = null
        }
        setIsStreaming(false)
        break
      }

      // Streaming: agent_thought_chunk
      case 'agent_thought_chunk': {
        setIsStreaming(true)
        const text = getTextFromContentBlock(update.content)

        setThoughts((prev) => {
          const next = new Map(prev)

          // Get or create current streaming thought
          let thoughtId = currentThoughtIdRef.current
          if (!thoughtId || !next.has(thoughtId) || !next.get(thoughtId)?.isStreaming) {
            // Start a new streaming thought
            thoughtId = generateStreamId('thought')
            currentThoughtIdRef.current = thoughtId
            next.set(thoughtId, {
              id: thoughtId,
              content: '',
              timestamp: new Date(),
              isStreaming: true,
            })
          }

          // Append text to current thought
          const existing = next.get(thoughtId)!
          next.set(thoughtId, {
            ...existing,
            content: existing.content + text,
          })

          return next
        })
        break
      }

      // Coalesced: agent_thought_complete
      case 'agent_thought_complete': {
        const text = getTextFromContentBlock(update.content)
        const thoughtId = currentThoughtIdRef.current || generateStreamId('thought')

        setThoughts((prev) => {
          const next = new Map(prev)
          const existing = next.get(thoughtId)

          if (existing) {
            // Finalize streaming thought
            next.set(thoughtId, {
              ...existing,
              content: text || existing.content,
              isStreaming: false,
            })
          } else {
            // Add complete thought directly
            next.set(thoughtId, {
              id: thoughtId,
              content: text,
              timestamp: parseDate(update.timestamp),
              isStreaming: false,
            })
          }

          return next
        })

        // Reset current thought tracking
        currentThoughtIdRef.current = null
        setIsStreaming(false)
        break
      }

      // Streaming: tool_call (new tool call started)
      case 'tool_call': {
        const toolId = update.toolCallId

        setToolCalls((prev) => {
          const next = new Map(prev)
          next.set(toolId, {
            id: toolId,
            title: update.title,
            status: mapToolCallStatus(update.status),
            rawInput: update.rawInput,
            rawOutput: update.rawOutput,
            timestamp: new Date(),
          })
          return next
        })
        break
      }

      // Streaming: tool_call_update (status/content update)
      case 'tool_call_update': {
        const toolId = update.toolCallId

        setToolCalls((prev) => {
          const next = new Map(prev)
          const existing = next.get(toolId)

          if (existing) {
            next.set(toolId, {
              ...existing,
              title: update.title ?? existing.title,
              status: update.status ? mapToolCallStatus(update.status) : existing.status,
              rawInput: update.rawInput ?? existing.rawInput,
              rawOutput: update.rawOutput ?? existing.rawOutput,
              completedAt:
                update.status === 'completed' || update.status === 'failed'
                  ? new Date()
                  : existing.completedAt,
            })
          }

          return next
        })
        break
      }

      // Coalesced: tool_call_complete (final tool call state)
      case 'tool_call_complete': {
        const toolId = update.toolCallId

        setToolCalls((prev) => {
          const next = new Map(prev)
          next.set(toolId, {
            id: toolId,
            title: update.title,
            status: mapToolCallStatus(update.status),
            result: update.result,
            rawInput: update.rawInput,
            rawOutput: update.rawOutput,
            timestamp: parseDate(update.timestamp),
            completedAt: update.completedAt ? parseDate(update.completedAt) : undefined,
          })
          return next
        })
        break
      }
    }
  }, [])

  /**
   * Finalize all streaming messages and thoughts
   * Called when execution enters a terminal state
   */
  const finalizeStreamingContent = useCallback(() => {
    // Finalize any streaming messages
    setMessages((prev) => {
      const next = new Map(prev)
      for (const [id, message] of next) {
        if (message.isStreaming) {
          next.set(id, { ...message, isStreaming: false })
        }
      }
      return next
    })

    // Finalize any streaming thoughts
    setThoughts((prev) => {
      const next = new Map(prev)
      for (const [id, thought] of next) {
        if (thought.isStreaming) {
          next.set(id, { ...thought, isStreaming: false })
        }
      }
      return next
    })

    // Finalize any pending/running tool calls
    setToolCalls((prev) => {
      const next = new Map(prev)
      for (const [id, toolCall] of next) {
        if (toolCall.status === 'pending' || toolCall.status === 'running') {
          next.set(id, {
            ...toolCall,
            status: 'failed',
            completedAt: new Date(),
          })
        }
      }
      return next
    })

    // Reset streaming state
    currentMessageIdRef.current = null
    currentThoughtIdRef.current = null
    setIsStreaming(false)
  }, [])

  /**
   * Handle execution lifecycle events
   */
  const handleExecutionEvent = useCallback(
    (exec: Execution) => {
      // Only process updates for our execution
      if (executionId && exec.id !== executionId) {
        return
      }

      const newStatus = mapExecutionStatus(exec.status)
      const createdAt = exec.created_at ? new Date(exec.created_at).getTime() : null
      const completedAt = exec.completed_at ? new Date(exec.completed_at).getTime() : null

      setExecution({
        runId: exec.id,
        status: newStatus,
        error: exec.error_message || null,
        startTime: createdAt,
        endTime: completedAt,
      })

      // Finalize streaming content when execution enters terminal state
      const terminalStatuses = ['completed', 'error', 'cancelled', 'stopped']
      if (terminalStatuses.includes(newStatus)) {
        finalizeStreamingContent()
      }

      // Trigger callbacks
      if (newStatus === 'running' && onEventRef.current?.onExecutionStarted) {
        onEventRef.current.onExecutionStarted(exec)
      }
      if (newStatus === 'completed' && onEventRef.current?.onExecutionCompleted) {
        onEventRef.current.onExecutionCompleted(exec)
      }
      if (newStatus === 'error' && onEventRef.current?.onExecutionError) {
        onEventRef.current.onExecutionError(exec, exec.error_message || 'Unknown error')
      }
    },
    [executionId, finalizeStreamingContent]
  )

  /**
   * Handle WebSocket messages
   */
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      // Handle execution lifecycle events
      if (
        message.type === 'execution_status_changed' ||
        message.type === 'execution_updated'
      ) {
        const exec = message.data as Execution | undefined
        if (exec) {
          handleExecutionEvent(exec)
        }
        return
      }

      // Handle session_update messages
      if (message.type !== 'session_update') {
        return
      }

      const data = message.data as SessionUpdateMessage | undefined
      if (!data?.update || !data?.executionId) {
        return
      }

      // Only process updates for our execution
      if (executionId && data.executionId !== executionId) {
        return
      }

      try {
        processUpdate(data.update)
      } catch (err) {
        console.error('[useSessionUpdateStream] Error processing update:', err)
        setError(err instanceof Error ? err : new Error('Failed to process SessionUpdate'))
      }
    },
    [executionId, processUpdate, handleExecutionEvent]
  )

  // Subscribe to WebSocket on mount/executionId change
  useEffect(() => {
    if (!executionId) {
      return
    }

    // Reset state when execution changes
    setMessages(new Map())
    setToolCalls(new Map())
    setThoughts(new Map())
    setIsStreaming(false)
    setError(null)
    setExecution(initialExecutionState)
    currentMessageIdRef.current = null
    currentThoughtIdRef.current = null

    // Subscribe to execution updates
    subscribe('execution', executionId)

    // Add message handler
    const handlerId = handlerIdRef.current
    addMessageHandler(handlerId, handleMessage)

    // Cleanup
    return () => {
      unsubscribe('execution', executionId)
      removeMessageHandler(handlerId)
    }
  }, [executionId, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  // Convert Maps to arrays for return value
  const messagesArray = useMemo(() => Array.from(messages.values()), [messages])
  const toolCallsArray = useMemo(() => Array.from(toolCalls.values()), [toolCalls])
  const thoughtsArray = useMemo(() => Array.from(thoughts.values()), [thoughts])

  return {
    connectionStatus,
    execution,
    messages: messagesArray,
    toolCalls: toolCallsArray,
    thoughts: thoughtsArray,
    isStreaming,
    error,
    isConnected: connected,
  }
}
