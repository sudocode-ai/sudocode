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
import type { PermissionRequest } from '@/types/permissions'

// ============================================================================
// Types
// ============================================================================

/**
 * Connection status (compatible with useAgUiStream)
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'

/**
 * Agent message (accumulated from agent_message_chunk or agent_message_complete)
 * Also used for user messages in persistent sessions
 */
export interface AgentMessage {
  id: string
  content: string
  timestamp: Date
  isStreaming?: boolean
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
  /** Message role - 'agent' for assistant messages, 'user' for user prompts */
  role?: 'agent' | 'user'
}

/**
 * Content produced by a tool call (from ACP)
 */
export type ToolCallContentItem =
  | {
      type: 'content'
      content: { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string }

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
  /** Structured content from tool call (ACP content field) */
  content?: ToolCallContentItem[]
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
 * Available command input specification from ACP
 */
export interface AvailableCommandInput {
  hint: string
}

/**
 * Available slash command from ACP
 * Agents advertise these via available_commands_update session notifications
 */
export interface AvailableCommand {
  name: string
  description: string
  input?: AvailableCommandInput
}

/**
 * Plan entry (todo item) from Claude Code's TodoWrite tool
 * Exposed via ACP 'plan' session updates (not tool_call events)
 */
export interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

/**
 * Plan update event from ACP
 */
export interface PlanUpdateEvent {
  id: string
  entries: PlanEntry[]
  timestamp: Date
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Generic session notification from ACP (acp-factory 0.1.2+)
 *
 * Represents various agent lifecycle events like compaction, mode changes, etc.
 * The notificationType field indicates the specific event kind, and data contains
 * the event-specific payload.
 *
 * Common notification types:
 * - "compaction_started": { trigger: "auto"|"manual", preTokens: number, threshold?: number }
 * - "compaction_completed": { trigger: "auto"|"manual", preTokens: number }
 */
export interface SessionNotification {
  id: string
  /** The specific notification type (e.g., "compaction_started", "compaction_completed") */
  notificationType: string
  /** Session where the notification occurred */
  sessionId?: string
  /** Notification-specific data payload */
  data: Record<string, unknown>
  timestamp: Date
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Execution lifecycle tracking (compatible with useAgUiStream's WorkflowExecution)
 */
export interface ExecutionState {
  runId: string | null
  status:
    | 'idle'
    | 'running'
    | 'pending'
    | 'paused'
    | 'completed'
    | 'error'
    | 'cancelled'
    | 'stopped'
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
    onPermissionRequest?: (request: PermissionRequest) => void
    onPlanUpdate?: (planUpdate: PlanUpdateEvent) => void
    onSessionNotification?: (notification: SessionNotification) => void
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
  /** Plan updates (todo list state changes from Claude Code) */
  planUpdates: PlanUpdateEvent[]
  /** Latest plan state (most recent plan update) */
  latestPlan: PlanEntry[] | null
  /** Pending permission requests */
  permissionRequests: PermissionRequest[]
  /** Mark a permission request as responded (call after REST API success) */
  markPermissionResponded: (requestId: string, selectedOptionId: string) => void
  /** Available slash commands advertised by the agent */
  availableCommands: AvailableCommand[]
  /** Session notifications (compaction, mode changes, etc.) */
  sessionNotifications: SessionNotification[]
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

interface UserMessageChunk extends ContentChunk {
  sessionUpdate: 'user_message_chunk'
}

interface UserMessageComplete {
  sessionUpdate: 'user_message_complete'
  content: ContentBlock
  timestamp: string | Date
}

interface ToolCallEvent {
  sessionUpdate: 'tool_call'
  toolCallId: string
  title: string
  status?: ToolCallStatus
  rawInput?: unknown
  rawOutput?: unknown
  content?: ToolCallContentItem[]
}

interface ToolCallUpdateEvent {
  sessionUpdate: 'tool_call_update'
  toolCallId: string
  title?: string | null
  status?: ToolCallStatus | null
  rawInput?: unknown
  rawOutput?: unknown
  content?: ToolCallContentItem[] | null
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
  content?: ToolCallContentItem[]
  timestamp: string | Date
  completedAt?: string | Date
}

/**
 * Permission request event from ACP interactive mode
 */
interface PermissionRequestEvent {
  sessionUpdate: 'permission_request'
  requestId: string
  sessionId: string
  toolCall: {
    toolCallId: string
    title: string
    status: string
    rawInput?: unknown
  }
  options: Array<{
    optionId: string
    name: string
    kind: 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always'
  }>
}

/**
 * Plan event from ACP - contains Claude Code's todo list state
 * This is how TodoWrite operations are exposed (NOT via tool_call events)
 */
interface PlanEvent {
  sessionUpdate: 'plan'
  plan?: {
    entries?: Array<{
      content: string
      status: string
      priority: string
    }>
  }
}

/**
 * Available commands update event from ACP
 * Agents advertise slash commands via this session notification
 */
interface AvailableCommandsUpdateEvent {
  sessionUpdate: 'available_commands_update'
  commands: Array<{
    name: string
    description: string
    input?: {
      hint: string
    }
  }>
}

/**
 * Check if a sessionUpdate type is a notification event
 * These are handled separately from the typed SessionUpdate union
 */
function isNotificationEvent(sessionUpdate: string): boolean {
  return (
    sessionUpdate === 'compaction_started' || sessionUpdate === 'compaction_completed'
    // Add other notification types here as needed
  )
}

/**
 * Union of all typed SessionUpdate events we handle
 * Note: Notification events (compaction, etc.) are handled separately
 * to avoid index signature breaking type narrowing
 */
type SessionUpdate =
  | AgentMessageChunk
  | AgentThoughtChunk
  | UserMessageChunk
  | UserMessageComplete
  | ToolCallEvent
  | ToolCallUpdateEvent
  | AgentMessageComplete
  | AgentThoughtComplete
  | ToolCallComplete
  | PermissionRequestEvent
  | PlanEvent
  | AvailableCommandsUpdateEvent

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
function mapExecutionStatus(status: string): ExecutionState['status'] {
  switch (status) {
    case 'preparing':
    case 'pending':
      return 'pending'
    case 'running':
      return 'running'
    case 'paused':
      return 'paused'
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
    typeof options === 'string' || options === null ? { executionId: options } : options

  const { executionId, onEvent } = normalizedOptions

  // State
  const [messages, setMessages] = useState<Map<string, AgentMessage>>(new Map())
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCall>>(new Map())
  const [thoughts, setThoughts] = useState<Map<string, AgentThought>>(new Map())
  const [permissionRequests, setPermissionRequests] = useState<Map<string, PermissionRequest>>(
    new Map()
  )
  const [planUpdates, setPlanUpdates] = useState<Map<string, PlanUpdateEvent>>(new Map())
  const [sessionNotifications, setSessionNotifications] = useState<
    Map<string, SessionNotification>
  >(new Map())
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [execution, setExecution] = useState<ExecutionState>(initialExecutionState)

  // Refs for tracking streaming state
  const currentMessageIdRef = useRef<string | null>(null)
  const currentThoughtIdRef = useRef<string | null>(null)
  const currentUserMessageIdRef = useRef<string | null>(null)
  const onEventRef = useRef(onEvent)

  // Counter for stable ordering of events during streaming
  const eventIndexRef = useRef(0)
  // Track assigned indices for tool calls (to handle tool_call vs tool_call_complete race)
  const toolCallIndicesRef = useRef(new Map<string, number>())

  // Update ref when onEvent changes
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  // WebSocket context
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

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
   * Accepts a broad type to handle both typed SessionUpdate events and
   * notification events (compaction, etc.) which are not in the typed union.
   */
  const processUpdate = useCallback(
    (
      update: SessionUpdate | { sessionUpdate: string; sessionId?: string; [key: string]: unknown }
    ) => {
      // Debug: Log received events (but throttle to avoid spam)
      const eventType = update.sessionUpdate
      if (
        eventType === 'tool_call' ||
        eventType === 'tool_call_update' ||
        eventType === 'tool_call_complete'
      ) {
        console.log('[useSessionUpdateStream] Received tool call event:', eventType, {
          toolCallId: (update as { toolCallId?: string }).toolCallId,
          title: (update as { title?: string }).title,
          status: (update as { status?: string }).status,
        })
      }

      // Handle notification events (compaction, etc.) before the typed switch
      // These use a generic record type to avoid breaking type narrowing
      if (isNotificationEvent(eventType)) {
        const notificationData = update as {
          sessionUpdate: string
          sessionId?: string
          [key: string]: unknown
        }
        const assignedIndex = eventIndexRef.current++
        const notificationId = generateStreamId('notification')

        // Build the data payload by extracting all fields except sessionUpdate/sessionId
        const data: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(notificationData)) {
          if (key !== 'sessionUpdate' && key !== 'sessionId') {
            data[key] = value
          }
        }

        const notification: SessionNotification = {
          id: notificationId,
          notificationType: eventType,
          sessionId: notificationData.sessionId,
          data,
          timestamp: new Date(),
          index: assignedIndex,
        }

        setSessionNotifications((prev) => {
          const next = new Map(prev)
          next.set(notificationId, notification)
          return next
        })

        // Trigger callback
        if (onEventRef.current?.onSessionNotification) {
          onEventRef.current.onSessionNotification(notification)
        }
        return
      }

      // Cast to typed SessionUpdate for switch statement type narrowing
      const typedUpdate = update as SessionUpdate

      switch (typedUpdate.sessionUpdate) {
        // Streaming: agent_message_chunk
        case 'agent_message_chunk': {
          setIsStreaming(true)
          const text = getTextFromContentBlock(typedUpdate.content)

          // Check if we need to start a new streaming message (sync check via ref)
          const needsNewMessage = !currentMessageIdRef.current
          let assignedIndex: number | undefined
          let newMessageId: string | undefined

          if (needsNewMessage) {
            // Assign index synchronously before setState to ensure correct ordering
            assignedIndex = eventIndexRef.current++
            newMessageId = generateStreamId('msg')
            currentMessageIdRef.current = newMessageId
            console.log('[useSessionUpdateStream] agent_message_chunk (new message):', {
              messageId: newMessageId,
              assignedIndex,
              eventIndexCurrent: eventIndexRef.current,
            })
          }

          setMessages((prev) => {
            const next = new Map(prev)
            const messageId = currentMessageIdRef.current!

            // Check if message exists and is streaming (may have been finalized)
            const existing = next.get(messageId)
            if (!existing || !existing.isStreaming) {
              // Create new streaming message with pre-assigned index
              next.set(messageId, {
                id: messageId,
                content: text,
                timestamp: new Date(),
                isStreaming: true,
                index: assignedIndex,
              })
            } else {
              // Append text to current message
              next.set(messageId, {
                ...existing,
                content: existing.content + text,
              })
            }

            return next
          })
          break
        }

        // Coalesced: agent_message_complete
        case 'agent_message_complete': {
          const text = getTextFromContentBlock(typedUpdate.content)
          // Use provided messageId (from legacy agents) or current streaming ID or generate new
          const isNewMessage = !typedUpdate.messageId && !currentMessageIdRef.current
          const messageId =
            typedUpdate.messageId || currentMessageIdRef.current || generateStreamId('msg')
          // Assign index only for brand new messages (existing streaming messages already have an index)
          const assignedIndex = isNewMessage ? eventIndexRef.current++ : undefined

          setMessages((prev) => {
            const next = new Map(prev)
            const existing = next.get(messageId)

            if (existing) {
              // Update existing message (for legacy agent cumulative updates)
              // Preserve existing index
              next.set(messageId, {
                ...existing,
                content: text || existing.content,
                isStreaming: false,
              })
            } else {
              // Add complete message directly with new index
              next.set(messageId, {
                id: messageId,
                content: text,
                timestamp: parseDate(typedUpdate.timestamp),
                isStreaming: false,
                index: assignedIndex,
              })
            }

            return next
          })

          // Only reset current message tracking if this wasn't a legacy agent update
          // (legacy agents provide their own messageId and may send more updates)
          if (!typedUpdate.messageId) {
            currentMessageIdRef.current = null
          }
          setIsStreaming(false)
          break
        }

        // Streaming: agent_thought_chunk
        case 'agent_thought_chunk': {
          setIsStreaming(true)
          const text = getTextFromContentBlock(typedUpdate.content)

          // Check if we need to start a new streaming thought (sync check via ref)
          const needsNewThought = !currentThoughtIdRef.current
          let assignedIndex: number | undefined

          if (needsNewThought) {
            // Assign index synchronously before setState to ensure correct ordering
            assignedIndex = eventIndexRef.current++
            currentThoughtIdRef.current = generateStreamId('thought')
          }

          setThoughts((prev) => {
            const next = new Map(prev)
            const thoughtId = currentThoughtIdRef.current!

            // Check if thought exists and is streaming (may have been finalized)
            const existing = next.get(thoughtId)
            if (!existing || !existing.isStreaming) {
              // Create new streaming thought with pre-assigned index
              next.set(thoughtId, {
                id: thoughtId,
                content: text,
                timestamp: new Date(),
                isStreaming: true,
                index: assignedIndex,
              })
            } else {
              // Append text to current thought
              next.set(thoughtId, {
                ...existing,
                content: existing.content + text,
              })
            }

            return next
          })
          break
        }

        // Coalesced: agent_thought_complete
        case 'agent_thought_complete': {
          const text = getTextFromContentBlock(typedUpdate.content)
          const isNewThought = !currentThoughtIdRef.current
          const thoughtId = currentThoughtIdRef.current || generateStreamId('thought')
          // Assign index only for brand new thoughts (existing streaming thoughts already have an index)
          const assignedIndex = isNewThought ? eventIndexRef.current++ : undefined

          setThoughts((prev) => {
            const next = new Map(prev)
            const existing = next.get(thoughtId)

            if (existing) {
              // Finalize streaming thought - preserve existing index
              next.set(thoughtId, {
                ...existing,
                content: text || existing.content,
                isStreaming: false,
              })
            } else {
              // Add complete thought directly with new index
              next.set(thoughtId, {
                id: thoughtId,
                content: text,
                timestamp: parseDate(typedUpdate.timestamp),
                isStreaming: false,
                index: assignedIndex,
              })
            }

            return next
          })

          // Reset current thought tracking
          currentThoughtIdRef.current = null
          setIsStreaming(false)
          break
        }

        // Streaming: user_message_chunk (for persistent sessions)
        case 'user_message_chunk': {
          setIsStreaming(true)
          const text = getTextFromContentBlock(typedUpdate.content)

          // Check if we need to start a new streaming user message
          const needsNewMessage = !currentUserMessageIdRef.current
          let assignedIndex: number | undefined
          let newMessageId: string | undefined

          if (needsNewMessage) {
            assignedIndex = eventIndexRef.current++
            newMessageId = generateStreamId('user-msg')
            currentUserMessageIdRef.current = newMessageId
          }

          setMessages((prev) => {
            const next = new Map(prev)
            const messageId = currentUserMessageIdRef.current!

            const existing = next.get(messageId)
            if (!existing || !existing.isStreaming) {
              next.set(messageId, {
                id: messageId,
                content: text,
                timestamp: new Date(),
                isStreaming: true,
                index: assignedIndex,
                role: 'user',
              })
            } else {
              next.set(messageId, {
                ...existing,
                content: existing.content + text,
              })
            }

            return next
          })
          break
        }

        // Coalesced: user_message_complete (for persistent sessions)
        case 'user_message_complete': {
          // Finalize any current streaming agent message first to ensure proper ordering
          if (currentMessageIdRef.current) {
            const messageIdToFinalize = currentMessageIdRef.current
            setMessages((prev) => {
              const next = new Map(prev)
              const existing = next.get(messageIdToFinalize)
              if (existing && existing.isStreaming) {
                next.set(messageIdToFinalize, { ...existing, isStreaming: false })
              }
              return next
            })
            currentMessageIdRef.current = null
          }

          // Also finalize any current streaming thought
          if (currentThoughtIdRef.current) {
            const thoughtIdToFinalize = currentThoughtIdRef.current
            setThoughts((prev) => {
              const next = new Map(prev)
              const existing = next.get(thoughtIdToFinalize)
              if (existing && existing.isStreaming) {
                next.set(thoughtIdToFinalize, { ...existing, isStreaming: false })
              }
              return next
            })
            currentThoughtIdRef.current = null
          }

          const text = getTextFromContentBlock(typedUpdate.content)
          const isNewMessage = !currentUserMessageIdRef.current
          const messageId = currentUserMessageIdRef.current || generateStreamId('user-msg')
          const assignedIndex = isNewMessage ? eventIndexRef.current++ : undefined

          console.log('[useSessionUpdateStream] user_message_complete:', {
            messageId,
            assignedIndex,
            eventIndexCurrent: eventIndexRef.current,
            textPreview: text.substring(0, 50),
          })

          setMessages((prev) => {
            const next = new Map(prev)
            const existing = next.get(messageId)

            if (existing) {
              // Finalize streaming message
              next.set(messageId, {
                ...existing,
                content: text || existing.content,
                isStreaming: false,
                role: 'user',
              })
            } else {
              // Create new completed message
              next.set(messageId, {
                id: messageId,
                content: text,
                timestamp: parseDate(typedUpdate.timestamp),
                isStreaming: false,
                index: assignedIndex,
                role: 'user',
              })
            }

            return next
          })

          currentUserMessageIdRef.current = null
          setIsStreaming(false)
          break
        }

        // Streaming: tool_call (new tool call started)
        case 'tool_call': {
          // Finalize any current streaming message - a tool call starting means
          // the previous message is complete. This ensures proper message boundaries.
          if (currentMessageIdRef.current) {
            const messageIdToFinalize = currentMessageIdRef.current
            setMessages((prev) => {
              const next = new Map(prev)
              const existing = next.get(messageIdToFinalize)
              if (existing && existing.isStreaming) {
                next.set(messageIdToFinalize, { ...existing, isStreaming: false })
              }
              return next
            })
            currentMessageIdRef.current = null
          }

          // Also finalize any current streaming thought
          if (currentThoughtIdRef.current) {
            const thoughtIdToFinalize = currentThoughtIdRef.current
            setThoughts((prev) => {
              const next = new Map(prev)
              const existing = next.get(thoughtIdToFinalize)
              if (existing && existing.isStreaming) {
                next.set(thoughtIdToFinalize, { ...existing, isStreaming: false })
              }
              return next
            })
            currentThoughtIdRef.current = null
          }

          const toolId = typedUpdate.toolCallId
          // Assign index synchronously and track it for this tool call
          let assignedIndex = toolCallIndicesRef.current.get(toolId)
          if (assignedIndex === undefined) {
            assignedIndex = eventIndexRef.current++
            toolCallIndicesRef.current.set(toolId, assignedIndex)
          }

          setToolCalls((prev) => {
            const next = new Map(prev)
            next.set(toolId, {
              id: toolId,
              title: typedUpdate.title,
              status: mapToolCallStatus(typedUpdate.status),
              rawInput: typedUpdate.rawInput,
              rawOutput: typedUpdate.rawOutput,
              content: typedUpdate.content as ToolCallContentItem[] | undefined,
              timestamp: new Date(),
              index: assignedIndex,
            })
            return next
          })
          break
        }

        // Streaming: tool_call_update (status/content update)
        case 'tool_call_update': {
          const toolId = typedUpdate.toolCallId

          setToolCalls((prev) => {
            const next = new Map(prev)
            const existing = next.get(toolId)

            if (existing) {
              // Preserve existing index
              next.set(toolId, {
                ...existing,
                title: typedUpdate.title ?? existing.title,
                status: typedUpdate.status
                  ? mapToolCallStatus(typedUpdate.status)
                  : existing.status,
                rawInput: typedUpdate.rawInput ?? existing.rawInput,
                rawOutput: typedUpdate.rawOutput ?? existing.rawOutput,
                content: typedUpdate.content
                  ? (typedUpdate.content as ToolCallContentItem[])
                  : existing.content,
                completedAt:
                  typedUpdate.status === 'completed' || typedUpdate.status === 'failed'
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
          // Finalize any current streaming message - ensures proper message boundaries
          // even when tool_call_complete arrives directly (e.g., from stored logs)
          if (currentMessageIdRef.current) {
            const messageIdToFinalize = currentMessageIdRef.current
            setMessages((prev) => {
              const next = new Map(prev)
              const existing = next.get(messageIdToFinalize)
              if (existing && existing.isStreaming) {
                next.set(messageIdToFinalize, { ...existing, isStreaming: false })
              }
              return next
            })
            currentMessageIdRef.current = null
          }

          // Also finalize any current streaming thought
          if (currentThoughtIdRef.current) {
            const thoughtIdToFinalize = currentThoughtIdRef.current
            setThoughts((prev) => {
              const next = new Map(prev)
              const existing = next.get(thoughtIdToFinalize)
              if (existing && existing.isStreaming) {
                next.set(thoughtIdToFinalize, { ...existing, isStreaming: false })
              }
              return next
            })
            currentThoughtIdRef.current = null
          }

          const toolId = typedUpdate.toolCallId
          // Get existing index from tracking map or assign new one
          let assignedIndex = toolCallIndicesRef.current.get(toolId)
          if (assignedIndex === undefined) {
            assignedIndex = eventIndexRef.current++
            toolCallIndicesRef.current.set(toolId, assignedIndex)
          }

          setToolCalls((prev) => {
            const next = new Map(prev)
            next.set(toolId, {
              id: toolId,
              title: typedUpdate.title,
              status: mapToolCallStatus(typedUpdate.status),
              result: typedUpdate.result,
              rawInput: typedUpdate.rawInput,
              rawOutput: typedUpdate.rawOutput,
              content: typedUpdate.content as ToolCallContentItem[] | undefined,
              timestamp: parseDate(typedUpdate.timestamp),
              completedAt: typedUpdate.completedAt ? parseDate(typedUpdate.completedAt) : undefined,
              index: assignedIndex,
            })
            return next
          })
          break
        }

        // Interactive mode: permission_request
        case 'permission_request': {
          // Assign index synchronously for stable ordering
          const assignedIndex = eventIndexRef.current++

          const request: PermissionRequest = {
            requestId: typedUpdate.requestId,
            sessionId: typedUpdate.sessionId,
            toolCall: {
              toolCallId: typedUpdate.toolCall.toolCallId,
              title: typedUpdate.toolCall.title,
              status: typedUpdate.toolCall.status,
              rawInput: typedUpdate.toolCall.rawInput,
            },
            options: typedUpdate.options,
            responded: false,
            timestamp: new Date(),
            index: assignedIndex,
          }

          setPermissionRequests((prev) => {
            const next = new Map(prev)
            next.set(typedUpdate.requestId, request)
            return next
          })

          // Trigger callback
          if (onEventRef.current?.onPermissionRequest) {
            onEventRef.current.onPermissionRequest(request)
          }
          break
        }

        // Plan updates from Claude Code's TodoWrite tool
        // ACP plan structure: { sessionUpdate: "plan", entries: [...] } - entries are directly on update
        case 'plan': {
          // Parse plan entries from ACP format - entries are directly on the update object
          const planData = typedUpdate as {
            entries?: Array<{ content: string; status: string; priority: string }>
          }
          const entries =
            planData.entries?.map((e) => ({
              content: e.content,
              status: e.status as 'pending' | 'in_progress' | 'completed',
              priority: e.priority as 'high' | 'medium' | 'low',
            })) || []

          if (entries.length > 0) {
            // Assign index synchronously for stable ordering
            const assignedIndex = eventIndexRef.current++
            const planId = generateStreamId('plan')

            const planUpdate: PlanUpdateEvent = {
              id: planId,
              entries,
              timestamp: new Date(),
              index: assignedIndex,
            }

            setPlanUpdates((prev) => {
              const next = new Map(prev)
              next.set(planId, planUpdate)
              return next
            })

            // Trigger callback
            if (onEventRef.current?.onPlanUpdate) {
              onEventRef.current.onPlanUpdate(planUpdate)
            }
          }
          break
        }

        // Available commands update from agent
        // Agents advertise slash commands via this session notification
        case 'available_commands_update': {
          const commandsData = typedUpdate as AvailableCommandsUpdateEvent
          if (commandsData.commands && Array.isArray(commandsData.commands)) {
            const commands: AvailableCommand[] = commandsData.commands.map((cmd) => ({
              name: cmd.name,
              description: cmd.description,
              input: cmd.input,
            }))
            setAvailableCommands(commands)
          }
          break
        }

        // Unknown event types - should never happen with typed union
        default: {
          // Exhaustive check - if we get here, we've missed a case
          const _exhaustiveCheck: never = typedUpdate
          console.debug('[useSessionUpdateStream] Unhandled sessionUpdate type:', _exhaustiveCheck)
          break
        }
      }
    },
    []
  )

  /**
   * Mark a permission request as responded
   * Call this after successfully responding via REST API
   */
  const markPermissionResponded = useCallback((requestId: string, selectedOptionId: string) => {
    setPermissionRequests((prev) => {
      const next = new Map(prev)
      const existing = next.get(requestId)
      if (existing) {
        next.set(requestId, {
          ...existing,
          responded: true,
          selectedOptionId,
        })
      }
      return next
    })
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
    currentUserMessageIdRef.current = null
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
      if (message.type === 'execution_status_changed' || message.type === 'execution_updated') {
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

      // Debug: Log all session_update events to see what's coming through
      const updateType = (data.update as { sessionUpdate?: string })?.sessionUpdate
      if (
        updateType &&
        (updateType.includes('compaction') || updateType.includes('notification'))
      ) {
        console.log(
          '[useSessionUpdateStream] Received WebSocket session_update:',
          updateType,
          data.update
        )
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
    setPermissionRequests(new Map())
    setPlanUpdates(new Map())
    setSessionNotifications(new Map())
    setAvailableCommands([])
    setIsStreaming(false)
    setError(null)
    setExecution(initialExecutionState)
    currentMessageIdRef.current = null
    currentThoughtIdRef.current = null
    currentUserMessageIdRef.current = null
    eventIndexRef.current = 0
    toolCallIndicesRef.current = new Map()

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
  const permissionRequestsArray = useMemo(
    () => Array.from(permissionRequests.values()),
    [permissionRequests]
  )
  const planUpdatesArray = useMemo(() => Array.from(planUpdates.values()), [planUpdates])
  const sessionNotificationsArray = useMemo(
    () => Array.from(sessionNotifications.values()),
    [sessionNotifications]
  )

  // Compute latest plan (from most recent plan update)
  const latestPlan = useMemo(() => {
    if (planUpdatesArray.length === 0) return null
    // Sort by timestamp descending and take the most recent
    const sorted = [...planUpdatesArray].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    )
    return sorted[0]?.entries || null
  }, [planUpdatesArray])

  return {
    connectionStatus,
    execution,
    messages: messagesArray,
    toolCalls: toolCallsArray,
    thoughts: thoughtsArray,
    planUpdates: planUpdatesArray,
    latestPlan,
    permissionRequests: permissionRequestsArray,
    markPermissionResponded,
    availableCommands,
    sessionNotifications: sessionNotificationsArray,
    isStreaming,
    error,
    isConnected: connected,
  }
}
