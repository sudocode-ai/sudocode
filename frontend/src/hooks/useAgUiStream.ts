/**
 * useAgUiStream React Hook
 *
 * Consumes AG-UI events via Server-Sent Events (SSE) from the execution stream API.
 * Handles real-time workflow execution updates including messages, tool calls, and state changes.
 *
 * @module hooks/useAgUiStream
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  EventType,
  type RunStartedEvent,
  type RunFinishedEvent,
  type RunErrorEvent,
  type StepStartedEvent,
  type StepFinishedEvent,
  type ToolCallStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type TextMessageStartEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
  type State,
} from '@ag-ui/core'
import { getCurrentProjectId } from '../lib/api'

/**
 * Connection status
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'

/**
 * Message buffer for streaming text messages
 */
export interface MessageBuffer {
  messageId: string
  role: string
  content: string
  complete: boolean
  timestamp: number
  /** Sequential index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Tool call tracking
 */
export interface ToolCallTracking {
  toolCallId: string
  toolCallName: string
  args: string
  status: 'started' | 'executing' | 'completed' | 'error'
  result?: string
  error?: string
  startTime: number
  endTime?: number
  /** Sequential index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Workflow execution tracking
 */
export interface WorkflowExecution {
  runId: string | null
  threadId: string | null
  status: 'idle' | 'running' | 'completed' | 'error'
  currentStep: string | null
  error: string | null
  startTime: number | null
  endTime: number | null
}

/**
 * Hook options
 */
export interface UseAgUiStreamOptions {
  /**
   * Execution ID to stream events from
   */
  executionId: string

  /**
   * Auto-connect on mount (default: true)
   */
  autoConnect?: boolean

  /**
   * Reconnect on error (default: false)
   */
  reconnectOnError?: boolean

  /**
   * Custom SSE endpoint (default: /api/executions/:id/stream)
   */
  endpoint?: string

  /**
   * Event handlers for specific event types
   */
  onEvent?: {
    onRunStarted?: (event: RunStartedEvent) => void
    onRunFinished?: (event: RunFinishedEvent) => void
    onRunError?: (event: RunErrorEvent) => void
    onStepStarted?: (event: StepStartedEvent) => void
    onStepFinished?: (event: StepFinishedEvent) => void
    onToolCallStart?: (event: ToolCallStartEvent) => void
    onToolCallEnd?: (event: ToolCallEndEvent) => void
    onMessage?: (message: MessageBuffer) => void
    onStateUpdate?: (state: State) => void
  }
}

/**
 * Hook state
 */
export interface AgUiStreamState {
  /**
   * Connection status
   */
  connectionStatus: ConnectionStatus

  /**
   * Current workflow execution
   */
  execution: WorkflowExecution

  /**
   * Buffered messages (streaming text)
   */
  messages: Map<string, MessageBuffer>

  /**
   * Active tool calls
   */
  toolCalls: Map<string, ToolCallTracking>

  /**
   * Current execution state (from STATE_SNAPSHOT/STATE_DELTA)
   */
  state: State

  /**
   * Connection error (if any)
   */
  error: Error | null
}

/**
 * Hook return type
 */
export interface UseAgUiStreamReturn extends AgUiStreamState {
  /**
   * Manually connect to the event stream
   */
  connect: () => void

  /**
   * Manually disconnect from the event stream
   */
  disconnect: () => void

  /**
   * Reconnect to the event stream
   */
  reconnect: () => void

  /**
   * Check if currently connected
   */
  isConnected: boolean
}

/**
 * useAgUiStream Hook
 *
 * Establishes SSE connection to AG-UI event stream and manages execution state.
 *
 * @example
 * ```typescript
 * const { execution, messages, toolCalls, state, isConnected } = useAgUiStream({
 *   executionId: 'exec-123',
 *   onEvent: {
 *     onRunStarted: (event) => console.log('Run started:', event.runId),
 *     onToolCallStart: (event) => console.log('Tool called:', event.toolCallName),
 *   }
 * })
 * ```
 */
export function useAgUiStream(options: UseAgUiStreamOptions): UseAgUiStreamReturn {
  const { executionId, autoConnect = true, reconnectOnError = false, endpoint, onEvent } = options

  // State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [execution, setExecution] = useState<WorkflowExecution>({
    runId: null,
    threadId: null,
    status: 'idle',
    currentStep: null,
    error: null,
    startTime: null,
    endTime: null,
  })
  const [messages, setMessages] = useState<Map<string, MessageBuffer>>(new Map())
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallTracking>>(new Map())
  const [state, setState] = useState<State>({})
  const [error, setError] = useState<Error | null>(null)

  // Refs
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const onEventRef = useRef(onEvent)
  const shouldStayDisconnected = useRef(false)

  // Update ref when onEvent changes
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  /**
   * Handle RUN_STARTED event
   */
  const handleRunStarted = useCallback((event: RunStartedEvent) => {
    setExecution((prev) => ({
      ...prev,
      runId: event.runId,
      threadId: event.threadId,
      status: 'running',
      startTime: event.timestamp || Date.now(),
    }))
    onEventRef.current?.onRunStarted?.(event)
  }, [])

  /**
   * Handle RUN_FINISHED event
   */
  const handleRunFinished = useCallback((event: RunFinishedEvent) => {
    setExecution((prev) => ({
      ...prev,
      status: 'completed',
      endTime: event.timestamp || Date.now(),
    }))
    onEventRef.current?.onRunFinished?.(event)

    // Mark that we should stay disconnected
    shouldStayDisconnected.current = true

    // Close SSE connection after run completes
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setConnectionStatus('disconnected')
    }
  }, [])

  /**
   * Handle RUN_ERROR event
   */
  const handleRunError = useCallback((event: RunErrorEvent) => {
    setExecution((prev) => ({
      ...prev,
      status: 'error',
      error: event.message,
      endTime: event.timestamp || Date.now(),
    }))
    setError(new Error(event.message))
    onEventRef.current?.onRunError?.(event)

    // Mark that we should stay disconnected
    shouldStayDisconnected.current = true

    // Close SSE connection after run errors
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setConnectionStatus('disconnected')
    }
  }, [])

  /**
   * Handle STEP_STARTED event
   */
  const handleStepStarted = useCallback((event: StepStartedEvent) => {
    setExecution((prev) => ({
      ...prev,
      currentStep: event.stepName,
    }))
    onEventRef.current?.onStepStarted?.(event)
  }, [])

  /**
   * Handle STEP_FINISHED event
   */
  const handleStepFinished = useCallback((event: StepFinishedEvent) => {
    onEventRef.current?.onStepFinished?.(event)
  }, [])

  /**
   * Handle TEXT_MESSAGE_START event
   */
  const handleTextMessageStart = useCallback((event: TextMessageStartEvent) => {
    setMessages((prev) => {
      const next = new Map(prev)
      next.set(event.messageId, {
        messageId: event.messageId,
        role: event.role || 'assistant',
        content: '',
        complete: false,
        timestamp: event.timestamp || Date.now(),
      })
      return next
    })
  }, [])

  /**
   * Handle TEXT_MESSAGE_CONTENT event
   */
  const handleTextMessageContent = useCallback((event: TextMessageContentEvent) => {
    setMessages((prev) => {
      const next = new Map(prev)
      const existing = next.get(event.messageId)
      if (existing) {
        const updated = {
          ...existing,
          content: existing.content + event.delta,
        }
        next.set(event.messageId, updated)
        onEventRef.current?.onMessage?.(updated)
      }
      return next
    })
  }, [])

  /**
   * Handle TEXT_MESSAGE_END event
   */
  const handleTextMessageEnd = useCallback((event: TextMessageEndEvent) => {
    setMessages((prev) => {
      const next = new Map(prev)
      const existing = next.get(event.messageId)
      if (existing) {
        const completed = { ...existing, complete: true }
        next.set(event.messageId, completed)
        onEventRef.current?.onMessage?.(completed)
      }
      return next
    })
  }, [])

  /**
   * Handle TOOL_CALL_START event
   */
  const handleToolCallStart = useCallback((event: ToolCallStartEvent) => {
    setToolCalls((prev) => {
      const next = new Map(prev)
      next.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolCallName: event.toolCallName,
        args: '',
        status: 'started',
        startTime: event.timestamp || Date.now(),
      })
      return next
    })
    onEventRef.current?.onToolCallStart?.(event)
  }, [])

  /**
   * Handle TOOL_CALL_ARGS event
   */
  const handleToolCallArgs = useCallback((event: ToolCallArgsEvent) => {
    setToolCalls((prev) => {
      const next = new Map(prev)
      const existing = next.get(event.toolCallId)
      if (existing) {
        next.set(event.toolCallId, {
          ...existing,
          args: existing.args + event.delta,
          status: 'executing',
        })
      }
      return next
    })
  }, [])

  /**
   * Handle TOOL_CALL_END event
   */
  const handleToolCallEnd = useCallback((event: ToolCallEndEvent) => {
    setToolCalls((prev) => {
      const next = new Map(prev)
      const existing = next.get(event.toolCallId)
      if (existing) {
        next.set(event.toolCallId, {
          ...existing,
          endTime: event.timestamp || Date.now(),
        })
      }
      return next
    })
    onEventRef.current?.onToolCallEnd?.(event)
  }, [])

  /**
   * Handle TOOL_CALL_RESULT event
   */
  const handleToolCallResult = useCallback((event: ToolCallResultEvent) => {
    setToolCalls((prev) => {
      const next = new Map(prev)
      const existing = next.get(event.toolCallId)
      if (existing) {
        next.set(event.toolCallId, {
          ...existing,
          result: event.content,
          status: 'completed',
        })
      }
      return next
    })
  }, [])

  /**
   * Handle STATE_SNAPSHOT event
   */
  const handleStateSnapshot = useCallback((event: StateSnapshotEvent) => {
    setState(event.snapshot)
    onEventRef.current?.onStateUpdate?.(event.snapshot)
  }, [])

  /**
   * Handle STATE_DELTA event
   */
  const handleStateDelta = useCallback((event: StateDeltaEvent) => {
    setState((prevState: State) => {
      // Apply JSON Patch operations
      let newState = { ...prevState }
      for (const op of event.delta) {
        if (op.op === 'replace') {
          const key = op.path.slice(1) // Remove leading '/'
          newState = { ...newState, [key]: op.value }
        } else if (op.op === 'add') {
          const key = op.path.slice(1)
          newState = { ...newState, [key]: op.value }
        }
        // Can extend to handle other operations (remove, move, copy, test)
      }
      onEventRef.current?.onStateUpdate?.(newState)
      return newState
    })
  }, [])

  /**
   * Connect to SSE stream
   */
  const connect = useCallback(() => {
    // Don't reconnect if we've intentionally disconnected after completion
    if (shouldStayDisconnected.current) {
      console.debug('[SSE] Skipping connection - execution already completed')
      return
    }

    if (eventSourceRef.current) {
      console.warn('EventSource already connected')
      return
    }

    // Get current project ID from api module
    // EventSource doesn't support custom headers, so we pass projectId as query parameter
    const projectId = getCurrentProjectId()

    let url = endpoint || `/api/executions/${executionId}/stream`

    // Append projectId query parameter if available
    if (projectId) {
      const separator = url.includes('?') ? '&' : '?'
      url = `${url}${separator}projectId=${encodeURIComponent(projectId)}`
    }

    console.debug('[SSE]. Connecting to SSE stream', {
      executionId,
      projectId,
      url,
      timestamp: new Date().toISOString(),
    })
    setConnectionStatus('connecting')
    setError(null)

    try {
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      // Connection established
      eventSource.onopen = () => {
        console.debug('[SSE]. SSE connection established', {
          executionId,
          timestamp: new Date().toISOString(),
        })
        setConnectionStatus('connected')
      }

      // Connection error
      eventSource.onerror = (err) => {
        console.error('EventSource error:', err)

        // Don't reconnect if we've intentionally disconnected after completion
        if (shouldStayDisconnected.current) {
          disconnect()
          return
        }

        setConnectionStatus('error')
        setError(new Error('SSE connection error'))

        if (reconnectOnError && reconnectTimeoutRef.current === null) {
          console.debug('[SSE] Reconnecting in 3 seconds...')
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null
            disconnect()
            connect()
          }, 3000)
        }
      }

      // Register event listeners for all AG-UI event types
      eventSource.addEventListener(EventType.RUN_STARTED, (e: MessageEvent) => {
        handleRunStarted(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.RUN_FINISHED, (e: MessageEvent) => {
        handleRunFinished(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.RUN_ERROR, (e: MessageEvent) => {
        handleRunError(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.STEP_STARTED, (e: MessageEvent) => {
        handleStepStarted(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.STEP_FINISHED, (e: MessageEvent) => {
        handleStepFinished(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TEXT_MESSAGE_START, (e: MessageEvent) => {
        handleTextMessageStart(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TEXT_MESSAGE_CONTENT, (e: MessageEvent) => {
        handleTextMessageContent(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TEXT_MESSAGE_END, (e: MessageEvent) => {
        handleTextMessageEnd(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TOOL_CALL_START, (e: MessageEvent) => {
        handleToolCallStart(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TOOL_CALL_ARGS, (e: MessageEvent) => {
        handleToolCallArgs(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TOOL_CALL_END, (e: MessageEvent) => {
        handleToolCallEnd(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.TOOL_CALL_RESULT, (e: MessageEvent) => {
        handleToolCallResult(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.STATE_SNAPSHOT, (e: MessageEvent) => {
        handleStateSnapshot(JSON.parse(e.data))
      })

      eventSource.addEventListener(EventType.STATE_DELTA, (e: MessageEvent) => {
        handleStateDelta(JSON.parse(e.data))
      })
    } catch (err) {
      console.error('Failed to create EventSource:', err)
      setConnectionStatus('error')
      setError(err instanceof Error ? err : new Error('Unknown error'))
    }
  }, [
    executionId,
    endpoint,
    reconnectOnError,
    handleRunStarted,
    handleRunFinished,
    handleRunError,
    handleStepStarted,
    handleStepFinished,
    handleTextMessageStart,
    handleTextMessageContent,
    handleTextMessageEnd,
    handleToolCallStart,
    handleToolCallArgs,
    handleToolCallEnd,
    handleToolCallResult,
    handleStateSnapshot,
    handleStateDelta,
  ])

  /**
   * Disconnect from SSE stream
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setConnectionStatus('disconnected')
    }
  }, [])

  /**
   * Reconnect to SSE stream
   */
  const reconnect = useCallback(() => {
    // Reset the stay disconnected flag when manually reconnecting
    shouldStayDisconnected.current = false
    disconnect()
    connect()
  }, [disconnect, connect])

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect()
    }

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
        setConnectionStatus('disconnected')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, executionId])

  return {
    connectionStatus,
    execution,
    messages,
    toolCalls,
    state,
    error,
    connect,
    disconnect,
    reconnect,
    isConnected: connectionStatus === 'connected',
  }
}
