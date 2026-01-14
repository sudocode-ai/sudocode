/**
 * useExecutionLogs React Hook
 *
 * Fetches historical execution logs from the backend for displaying execution history.
 * Returns CoalescedSessionUpdate events that can be processed into messages/toolCalls.
 *
 * @module hooks/useExecutionLogs
 */

import { useState, useEffect, useMemo } from 'react'
import api from '../lib/api'
import { isCancel } from 'axios'
import type { AgentMessage, ToolCall, AgentThought } from './useSessionUpdateStream'

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata about execution logs
 */
export interface ExecutionLogMetadata {
  lineCount: number
  byteSize: number
  createdAt: string
  updatedAt: string
}

/**
 * Content block from ACP
 */
interface ContentBlock {
  type: 'text' | 'image' | 'audio' | 'resource_link' | 'resource'
  text?: string
}

/**
 * Plan entry (todo item) from ACP
 */
export interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

/**
 * Tool call status from ACP
 */
type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'working' | 'incomplete'

/**
 * Coalesced SessionUpdate types from backend
 */
export interface AgentMessageComplete {
  sessionUpdate: 'agent_message_complete'
  content: ContentBlock
  timestamp: string | Date
}

export interface AgentThoughtComplete {
  sessionUpdate: 'agent_thought_complete'
  content: ContentBlock
  timestamp: string | Date
}

export interface ToolCallComplete {
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

export interface UserMessageComplete {
  sessionUpdate: 'user_message_complete'
  content: ContentBlock
  timestamp: string | Date
}

/**
 * Plan update containing todos/tasks from Claude Code
 */
export interface PlanUpdateEvent {
  sessionUpdate: 'plan'
  entries: PlanEntry[]
  timestamp: string | Date
}

/**
 * Union of all CoalescedSessionUpdate types
 */
export type CoalescedSessionUpdate =
  | AgentMessageComplete
  | AgentThoughtComplete
  | ToolCallComplete
  | UserMessageComplete
  | PlanUpdateEvent

/**
 * API response shape from GET /api/executions/:id/logs
 */
interface ExecutionLogsData {
  executionId: string
  events: CoalescedSessionUpdate[]
  format: 'acp' | 'normalized_entry' | 'empty'
  metadata: ExecutionLogMetadata
}

/**
 * Processed logs ready for display
 */
export interface ProcessedLogs {
  messages: AgentMessage[]
  toolCalls: ToolCall[]
  thoughts: AgentThought[]
  /** Plan updates (todo list state changes) */
  planUpdates: PlanUpdateEvent[]
  /** Latest plan state (most recent plan update) */
  latestPlan: PlanEntry[] | null
}

/**
 * Hook return value
 */
export interface UseExecutionLogsResult {
  /** Raw CoalescedSessionUpdate events */
  events: CoalescedSessionUpdate[]
  /** Processed logs (messages, toolCalls, thoughts) */
  processed: ProcessedLogs
  /** Loading state */
  loading: boolean
  /** Error if fetch failed */
  error: Error | null
  /** Metadata about the logs */
  metadata: ExecutionLogMetadata | null
  /** Detected log format */
  format: 'acp' | 'normalized_entry' | 'empty' | null
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Extract text from a content block
 */
function getTextFromContentBlock(content: ContentBlock): string {
  if (content.type === 'text' && content.text) {
    return content.text
  }
  return `[${content.type}]`
}

/**
 * Parse a date that may be a string or Date object
 */
function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value
  return new Date(value)
}

/**
 * Map tool call status to UI status
 */
function mapToolCallStatus(
  status: ToolCallStatus
): 'pending' | 'running' | 'success' | 'failed' {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'in_progress':
    case 'working':
      return 'running'
    case 'completed':
      return 'success'
    case 'failed':
    case 'incomplete':
      return 'failed'
    default:
      return 'pending'
  }
}

/**
 * Process CoalescedSessionUpdate events into messages, toolCalls, thoughts, and plans
 */
export function processCoalescedEvents(events: CoalescedSessionUpdate[]): ProcessedLogs {
  const messages: AgentMessage[] = []
  const toolCalls: ToolCall[] = []
  const thoughts: AgentThought[] = []
  const planUpdates: PlanUpdateEvent[] = []

  // Use a single global index counter across all event types to preserve ordering
  // This ensures messages and tool calls sort correctly in AgentTrajectory
  let globalIndex = 0
  let messageIdCounter = 0
  let thoughtIdCounter = 0

  for (const event of events) {
    switch (event.sessionUpdate) {
      case 'agent_message_complete':
        messages.push({
          id: `msg-${messageIdCounter}`,
          content: getTextFromContentBlock(event.content),
          timestamp: parseDate(event.timestamp),
          isStreaming: false,
          index: globalIndex,
        })
        messageIdCounter++
        globalIndex++
        break

      case 'agent_thought_complete':
        thoughts.push({
          id: `thought-${thoughtIdCounter}`,
          content: getTextFromContentBlock(event.content),
          timestamp: parseDate(event.timestamp),
          isStreaming: false,
          index: globalIndex,
        })
        thoughtIdCounter++
        globalIndex++
        break

      case 'tool_call_complete':
        toolCalls.push({
          id: event.toolCallId,
          title: event.title,
          status: mapToolCallStatus(event.status),
          result: event.result,
          rawInput: event.rawInput,
          rawOutput: event.rawOutput,
          timestamp: parseDate(event.timestamp),
          completedAt: event.completedAt ? parseDate(event.completedAt) : undefined,
          index: globalIndex,
        })
        globalIndex++
        break

      case 'plan':
        // Store plan updates for todo tracking
        planUpdates.push(event)
        break

      case 'user_message_complete':
        // User messages for persistent sessions - add to messages with role='user'
        messages.push({
          id: `user-msg-${messageIdCounter}`,
          content: getTextFromContentBlock(event.content),
          timestamp: parseDate(event.timestamp),
          isStreaming: false,
          index: globalIndex,
          role: 'user',
        })
        messageIdCounter++
        globalIndex++
        break
    }
  }

  // Get latest plan state (last plan update)
  const latestPlan = planUpdates.length > 0
    ? planUpdates[planUpdates.length - 1].entries
    : null

  return { messages, toolCalls, thoughts, planUpdates, latestPlan }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch historical execution logs for replay
 *
 * Fetches CoalescedSessionUpdate events from the backend API and processes them
 * into messages, toolCalls, and thoughts ready for display.
 *
 * @param executionId - ID of execution to fetch logs for
 * @returns Hook result with events, processed data, loading state, error, and metadata
 *
 * @example
 * ```tsx
 * function ExecutionHistory({ executionId }: { executionId: string }) {
 *   const { processed, loading, error, metadata } = useExecutionLogs(executionId);
 *
 *   if (loading) return <LoadingSpinner />;
 *   if (error) return <ErrorDisplay error={error} />;
 *
 *   return (
 *     <div>
 *       <div>Events: {processed.messages.length + processed.toolCalls.length}</div>
 *       <AgentTrajectory
 *         messages={processed.messages}
 *         toolCalls={processed.toolCalls}
 *         thoughts={processed.thoughts}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function useExecutionLogs(executionId: string): UseExecutionLogsResult {
  const [events, setEvents] = useState<CoalescedSessionUpdate[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)
  const [metadata, setMetadata] = useState<ExecutionLogMetadata | null>(null)
  const [format, setFormat] = useState<'acp' | 'normalized_entry' | 'empty' | null>(null)

  useEffect(() => {
    // Reset state when execution ID changes
    setLoading(true)
    setError(null)
    setEvents([])
    setMetadata(null)
    setFormat(null)

    // Create abort controller for cleanup
    const abortController = new AbortController()

    async function fetchEvents() {
      try {
        // Fetch CoalescedSessionUpdate events from API
        const data = await api.get<ExecutionLogsData, ExecutionLogsData>(
          `/executions/${executionId}/logs`,
          {
            signal: abortController.signal,
          }
        )

        // Store events and metadata
        setEvents(data.events || [])
        setMetadata(data.metadata)
        setFormat(data.format)
      } catch (err) {
        // Ignore abort/cancel errors (cleanup)
        if (isCancel(err) || (err instanceof Error && err.name === 'AbortError')) {
          console.debug('[useExecutionLogs] Request canceled for execution:', executionId)
          return
        }

        // Set error state
        let error: Error
        if (err instanceof Error) {
          error = err
        } else {
          error = new Error('Unknown error fetching execution logs')
        }

        setError(error)
        console.error('[useExecutionLogs] Error:', error)
      } finally {
        // Only set loading to false if not aborted
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    fetchEvents()

    // Cleanup function - abort fetch on unmount or ID change
    return () => {
      abortController.abort()
    }
  }, [executionId])

  // Process events into messages/toolCalls/thoughts
  const processed = useMemo(() => {
    return processCoalescedEvents(events)
  }, [events])

  return {
    events,
    processed,
    loading,
    error,
    metadata,
    format,
  }
}
