/**
 * ExecutionMonitor Component
 *
 * Displays execution status using either:
 * - Real-time WebSocket streaming for active executions (running, pending, preparing, paused)
 * - Historical logs API for completed executions (completed, failed, cancelled, stopped)
 *
 * Shows execution progress, metrics, messages, and tool calls.
 *
 * Consumes SessionUpdate events via useSessionUpdateStream hook (ACP-native).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useSessionUpdateStream,
  type AgentMessage,
  type ToolCall,
  type ConnectionStatus,
  type ExecutionState,
} from '@/hooks/useSessionUpdateStream'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AgentTrajectory } from './AgentTrajectory'
import { TodoTracker } from './TodoTracker'
import { buildTodoHistoryFromPlanUpdates, planEntriesToTodoItems } from '@/utils/todoExtractor'
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { Execution } from '@/types/execution'
import type { ToolCallTracking } from '@/types/stream'
import api from '@/lib/api'

export interface ExecutionMonitorProps {
  /**
   * Execution ID to monitor
   */
  executionId: string

  /**
   * Execution metadata (optional, for status detection)
   */
  execution?: Execution

  /**
   * Callback when execution completes successfully
   */
  onComplete?: () => void

  /**
   * Callback when execution errors
   */
  onError?: (error: Error) => void

  /**
   * Callback when content changes (new messages/tool calls)
   */
  onContentChange?: () => void

  /**
   * Callback when tool calls are updated (for aggregating todos across executions)
   */
  onToolCallsUpdate?: (
    toolCalls: Map<string, ToolCallTracking>
  ) => void

  /**
   * Callback when todos are updated (computed from plan updates)
   * Use this instead of onToolCallsUpdate for Claude Code executions
   */
  onTodosUpdate?: (
    executionId: string,
    todos: import('./TodoTracker').TodoItem[]
  ) => void

  /**
   * Callback when execution is cancelled (ESC key pressed)
   */
  onCancel?: () => void

  /**
   * Callback when skip-all-permissions completes successfully
   * Called with the new execution ID that was created
   */
  onSkipAllPermissionsComplete?: (newExecutionId: string) => void

  /**
   * Compact mode - removes card wrapper and header for inline display
   */
  compact?: boolean

  /**
   * Hide the TodoTracker in this monitor (for when it's shown elsewhere)
   */
  hideTodoTracker?: boolean

  /**
   * Show running indicator (dots) when execution is running
   */
  showRunIndicator?: boolean

  /**
   * Custom class name
   */
  className?: string
}

export function RunIndicator() {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev % 3) + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 text-muted-foreground">Running{'.'.repeat(dots)}</span>
      <span className="text-muted-foreground/70">(esc to cancel)</span>
    </div>
  )
}

/**
 * Convert ToolCall array to ToolCallTracking Map for onToolCallsUpdate callback
 * Bridge function for backwards compatibility with consumers expecting Map format.
 * TODO: Migrate consumers to use ToolCall[] and remove this bridge
 */
function convertToolCallsToMap(toolCalls: ToolCall[]): Map<string, ToolCallTracking> {
  const map = new Map<string, ToolCallTracking>()
  toolCalls.forEach((tc) => {
    const statusMap: Record<string, 'started' | 'executing' | 'completed' | 'error'> = {
      success: 'completed',
      failed: 'error',
      running: 'executing',
      pending: 'started',
    }
    map.set(tc.id, {
      toolCallId: tc.id,
      toolCallName: tc.title,
      args: tc.rawInput ? (typeof tc.rawInput === 'string' ? tc.rawInput : JSON.stringify(tc.rawInput)) : '',
      status: statusMap[tc.status] || 'started',
      result: tc.result !== undefined ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)) : undefined,
      error: tc.status === 'failed' && tc.result && typeof tc.result === 'object' ? (tc.result as Record<string, unknown>).error as string : undefined,
      startTime: tc.timestamp.getTime(),
      endTime: tc.completedAt?.getTime(),
      index: tc.index,
    })
  })
  return map
}


/**
 * ExecutionMonitor Component
 *
 * @example
 * ```tsx
 * // Active execution (SSE streaming)
 * <ExecutionMonitor
 *   executionId="exec-123"
 *   execution={{ status: 'running', ... }}
 *   onComplete={() => console.log('Done!')}
 *   onError={(err) => console.error(err)}
 * />
 *
 * // Historical execution (logs API)
 * <ExecutionMonitor
 *   executionId="exec-456"
 *   execution={{ status: 'completed', ... }}
 * />
 * ```
 */
export function ExecutionMonitor({
  executionId,
  execution: executionProp,
  onComplete,
  onError,
  onContentChange,
  onToolCallsUpdate,
  onTodosUpdate,
  onCancel,
  onSkipAllPermissionsComplete,
  compact = false,
  hideTodoTracker = false,
  showRunIndicator = false,
  className = '',
}: ExecutionMonitorProps) {
  // Determine if execution is active or completed
  // Active: preparing, pending, running, paused
  // Completed: completed, failed, cancelled, stopped
  const isActive = useMemo(() => {
    if (!executionProp) return true // Default to active if no execution prop
    const activeStatuses = ['preparing', 'pending', 'running', 'paused']
    return activeStatuses.includes(executionProp.status)
  }, [executionProp])

  // Use WebSocket streaming for real-time SessionUpdate events
  const wsStream = useSessionUpdateStream({
    executionId: isActive ? executionId : null, // Only connect for active executions
  })

  // Use logs API for completed executions
  // Also preload logs for active executions as a fallback in case WebSocket disconnects
  const logsResult = useExecutionLogs(executionId)

  // Use pre-processed logs from hook (already converted from CoalescedSessionUpdate)
  const processedLogs = useMemo(() => {
    console.log('[ExecutionMonitor] Processing logs:', {
      messagesCount: logsResult.processed.messages.length,
      toolCallsCount: logsResult.processed.toolCalls.length,
      wsToolCallsCount: wsStream.toolCalls.length,
    })
    if (logsResult.processed.toolCalls.length > 0) {
      console.log('[ExecutionMonitor] First 3 processed log tool calls:', logsResult.processed.toolCalls.slice(0, 3).map(tc => ({
        id: tc.id,
        title: tc.title,
        status: tc.status,
      })))
    }
    return {
      messages: logsResult.processed.messages,
      toolCalls: logsResult.processed.toolCalls,
    }
  }, [logsResult.processed, wsStream.toolCalls.length])

  // Select the appropriate data source
  // Key insight: When transitioning from active to completed, keep showing WebSocket data
  // until logs are fully loaded to prevent flickering
  // IMPORTANT: If WebSocket disconnects unexpectedly, fall back to saved logs
  const { connectionStatus, execution, messages, toolCalls, error, isConnected } =
    useMemo((): {
      connectionStatus: ConnectionStatus
      execution: ExecutionState
      messages: AgentMessage[]
      toolCalls: ToolCall[]
      error: Error | null
      isConnected: boolean
    } => {
      const logsLoaded = !logsResult.loading && logsResult.events.length > 0
      const hasWsData = wsStream.messages.length > 0 || wsStream.toolCalls.length > 0
      const hasLogsData = processedLogs.messages.length > 0 || processedLogs.toolCalls.length > 0

      console.log('[ExecutionMonitor] Data source selection:', {
        isActive,
        logsLoaded,
        hasWsData,
        hasLogsData,
        wsToolCalls: wsStream.toolCalls.length,
        logsToolCalls: processedLogs.toolCalls.length,
        wsConnectionStatus: wsStream.connectionStatus,
        logsLoading: logsResult.loading,
        logsEventsCount: logsResult.events.length,
      })

      // For active executions, use WebSocket stream if available
      // BUT: If WebSocket has disconnected/errored and we have no data, fall back to logs
      if (isActive) {
        // If WebSocket disconnected/errored unexpectedly and we have saved logs, use those
        if (
          (wsStream.connectionStatus === 'disconnected' ||
            wsStream.connectionStatus === 'error') &&
          !hasWsData &&
          hasLogsData
        ) {
          console.warn(
            '[ExecutionMonitor] WebSocket disconnected unexpectedly, falling back to saved logs'
          )
          return {
            connectionStatus: logsLoaded ? 'connected' : 'connecting',
            execution: {
              status: (executionProp?.status || 'running') as ExecutionState['status'],
              runId: executionId,
              error: logsResult.error?.message || null,
              startTime: null,
              endTime: null,
            },
            messages: processedLogs.messages,
            toolCalls: processedLogs.toolCalls,
            error: logsResult.error || null,
            isConnected: false,
          }
        }

        // Otherwise use WebSocket stream normally
        return {
          connectionStatus: wsStream.connectionStatus,
          execution: wsStream.execution,
          messages: wsStream.messages,
          toolCalls: wsStream.toolCalls,
          error: wsStream.error,
          isConnected: wsStream.isConnected,
        }
      }

      // For completed executions, use logs when available
      // But fall back to WebSocket data while logs are loading to prevent flicker
      // Use logs if loaded, otherwise fall back to WebSocket data if available
      if (logsLoaded) {
        return {
          connectionStatus: logsResult.error ? 'error' : 'connected',
          execution: {
            status: (executionProp?.status || 'completed') as ExecutionState['status'],
            runId: executionId,
            error: logsResult.error?.message || null,
            startTime: null,
            endTime: null,
          },
          messages: processedLogs.messages,
          toolCalls: processedLogs.toolCalls,
          error: logsResult.error || null,
          isConnected: false,
        }
      } else if (hasWsData) {
        // Logs still loading but we have WebSocket data - keep showing it
        return {
          connectionStatus: logsResult.loading ? 'connecting' : wsStream.connectionStatus,
          execution: {
            ...wsStream.execution,
            status: (executionProp?.status || wsStream.execution.status) as ExecutionState['status'],
          },
          messages: wsStream.messages,
          toolCalls: wsStream.toolCalls,
          error: wsStream.error,
          isConnected: false, // Not live anymore since execution completed
        }
      } else {
        // No WebSocket data and logs not loaded yet - show loading or saved logs
        return {
          connectionStatus: logsResult.loading
            ? 'connecting'
            : logsResult.error
              ? 'error'
              : 'connected',
          execution: {
            status: (executionProp?.status || 'completed') as ExecutionState['status'],
            runId: executionId,
            error: logsResult.error?.message || null,
            startTime: null,
            endTime: null,
          },
          messages: processedLogs.messages,
          toolCalls: processedLogs.toolCalls,
          error: logsResult.error || null,
          isConnected: false,
        }
      }
    }, [isActive, wsStream, logsResult, processedLogs, executionId, executionProp])

  // Debug: Log selected toolCalls
  useEffect(() => {
    console.log('[ExecutionMonitor] Selected toolCalls:', toolCalls.length, 'isActive:', isActive)
    if (toolCalls.length > 0) {
      const todoLikeTools = toolCalls.filter(tc =>
        tc.title.toLowerCase().includes('todo') ||
        (tc.rawInput && JSON.stringify(tc.rawInput).includes('todos'))
      )
      console.log('[ExecutionMonitor] Todo-like tool calls:', todoLikeTools.length)
    }
  }, [toolCalls, isActive])

  // Track whether onComplete has already been called to prevent infinite loops
  // When an execution is already 'completed' on mount, we should not call onComplete
  // (it's only for when the status transitions TO completed during streaming)
  const hasCalledOnComplete = useRef(false)
  const previousStatus = useRef<string | undefined>(undefined)

  // Track last tool calls hash to detect actual changes (not just size)
  const lastToolCallsHashRef = useRef<string>('')

  // ESC key to cancel execution
  useEffect(() => {
    if (!onCancel) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only cancel if execution is active (not completed/failed/cancelled)
      const activeStatuses = ['preparing', 'pending', 'running', 'paused']
      if (event.key === 'Escape' && activeStatuses.includes(execution.status)) {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, execution.status])

  // Trigger callbacks when execution status changes TO completed (not when already completed)
  useEffect(() => {
    // Only call onComplete if:
    // 1. Status is now 'completed'
    // 2. We haven't already called it
    // 3. Previous status was something other than 'completed' (i.e., a transition happened)
    if (
      execution.status === 'completed' &&
      onComplete &&
      !hasCalledOnComplete.current &&
      previousStatus.current !== undefined &&
      previousStatus.current !== 'completed'
    ) {
      hasCalledOnComplete.current = true
      onComplete()
    }
    previousStatus.current = execution.status
  }, [execution.status, onComplete])

  useEffect(() => {
    if (error && onError) {
      onError(error)
    }
  }, [error, onError])

  // Notify parent when content changes (for auto-scroll)
  useEffect(() => {
    if (onContentChange) {
      onContentChange()
    }
  }, [messages.length, toolCalls.length, onContentChange])

  // Notify parent when tool calls update (for aggregating todos)
  // Create a hash of tool call IDs and statuses to detect actual changes
  useEffect(() => {
    if (!onToolCallsUpdate) return

    // Create a simple hash of tool call IDs and their statuses
    const toolCallsHash = toolCalls
      .map((tc) => `${tc.id}:${tc.status}`)
      .sort()
      .join('|')

    if (toolCallsHash !== lastToolCallsHashRef.current) {
      lastToolCallsHashRef.current = toolCallsHash
      // Convert to Map for backwards compatibility with existing callback consumers
      onToolCallsUpdate(convertToolCallsToMap(toolCalls))
    }
  }, [toolCalls, onToolCallsUpdate, executionId])

  // Calculate metrics
  const toolCallCount = toolCalls.length
  const completedToolCalls = toolCalls.filter((tc) => tc.status === 'success').length
  const messageCount = messages.length

  // Get thoughts from WebSocket stream (logs don't have them yet)
  const thoughts = wsStream.thoughts

  // Get permission requests from WebSocket stream (only for active executions)
  const permissionRequests = wsStream.permissionRequests
  const markPermissionResponded = wsStream.markPermissionResponded

  // Handle permission response - calls API and updates local state
  const handlePermissionRespond = async (requestId: string, optionId: string) => {
    try {
      await api.post(`/executions/${executionId}/permission/${requestId}`, { optionId })
      // Update local state to mark as responded
      markPermissionResponded(requestId, optionId)
    } catch (err) {
      console.error('[ExecutionMonitor] Error responding to permission:', err)
    }
  }

  // State for skip-all-permissions action
  const [isSkippingAllPermissions, setIsSkippingAllPermissions] = useState(false)

  // Handle skip-all-permissions - cancels current execution and creates follow-up with skip enabled
  const handleSkipAllPermissions = async () => {
    try {
      setIsSkippingAllPermissions(true)
      const response = await api.post(`/executions/${executionId}/skip-all-permissions`, {
        feedback: 'Continue from where you left off.',
      })
      const newExecutionId = response.data?.data?.newExecution?.id
      if (newExecutionId && onSkipAllPermissionsComplete) {
        onSkipAllPermissionsComplete(newExecutionId)
      }
    } catch (err) {
      console.error('[ExecutionMonitor] Error skipping all permissions:', err)
      setIsSkippingAllPermissions(false)
    }
  }

  // Extract todos from plan updates for TodoTracker
  // Note: Claude Code's TodoWrite does NOT emit tool_call events - it uses ACP plan session updates
  const todos = useMemo(() => {
    // For active executions, prefer WebSocket plan data (real-time)
    // For completed executions, prefer logs plan data (historical)
    if (isActive && wsStream.planUpdates.length > 0) {
      return buildTodoHistoryFromPlanUpdates(wsStream.planUpdates)
    }

    // Use logs plan data for completed executions or when WebSocket has no plans yet
    if (logsResult.processed.planUpdates.length > 0) {
      return buildTodoHistoryFromPlanUpdates(logsResult.processed.planUpdates)
    }

    // If we have latestPlan directly, convert it to TodoItems
    if (isActive && wsStream.latestPlan) {
      return planEntriesToTodoItems(wsStream.latestPlan)
    }

    if (logsResult.processed.latestPlan) {
      return planEntriesToTodoItems(logsResult.processed.latestPlan)
    }

    return []
  }, [isActive, wsStream.planUpdates, wsStream.latestPlan, logsResult.processed.planUpdates, logsResult.processed.latestPlan])

  // Notify parent of todos updates (for aggregating across executions)
  useEffect(() => {
    if (onTodosUpdate && todos.length > 0) {
      onTodosUpdate(executionId, todos)
    }
  }, [executionId, todos, onTodosUpdate])

  // Render status badge
  const renderStatusBadge = () => {
    if (connectionStatus === 'connecting') {
      return (
        <Badge variant="outline" className="flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Connecting...
        </Badge>
      )
    }

    if (connectionStatus === 'error' || execution.status === 'error') {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          Error
        </Badge>
      )
    }

    if (execution.status === 'completed') {
      return (
        <Badge variant="default" className="flex items-center gap-1 bg-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </Badge>
      )
    }

    if (execution.status === 'running') {
      return (
        <Badge variant="default" className="flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </Badge>
      )
    }

    return (
      <Badge variant="secondary" className="flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        Idle
      </Badge>
    )
  }

  // Render loading state
  if (connectionStatus === 'connecting' && execution.status === 'idle') {
    const loadingContent = (
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Connecting to execution stream...</span>
      </div>
    )

    if (compact) {
      return <div className={`p-6 ${className}`}>{loadingContent}</div>
    }

    return <Card className={`p-6 ${className}`}>{loadingContent}</Card>
  }

  // Compact mode: no card wrapper, no header, just content
  if (compact) {
    return (
      <div className={`space-y-4 ${className}`}>
        {/* User prompt - show what the user asked */}
        {executionProp?.prompt && (
          <div className="rounded-md bg-primary/30 p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 whitespace-pre-wrap font-mono text-sm text-foreground">
                {executionProp.prompt}
              </div>
            </div>
          </div>
        )}

        {/* Error display */}
        {(error || execution.error) && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
              <div className="flex-1">
                <h4 className="font-semibold text-destructive">Error</h4>
                <p className="mt-1 text-sm text-destructive/90">
                  {execution.error || error?.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Agent Trajectory */}
        {(messageCount > 0 || toolCallCount > 0 || permissionRequests.length > 0) && (
          <AgentTrajectory
            messages={messages}
            toolCalls={toolCalls}
            thoughts={thoughts}
            permissionRequests={permissionRequests}
            onPermissionRespond={handlePermissionRespond}
            onSkipAllPermissions={onSkipAllPermissionsComplete ? handleSkipAllPermissions : undefined}
            isSkippingAllPermissions={isSkippingAllPermissions}
            renderMarkdown
            showTodoTracker={false}
          />
        )}

        {/* Empty state */}
        {messageCount === 0 &&
          toolCallCount === 0 &&
          !error &&
          !execution.error &&
          execution.status !== 'running' && (
            <div className="flex flex-col items-center justify-center py-2 text-center text-muted-foreground">
              {!isActive && !isConnected && (
                <>
                  <AlertCircle className="mb-2 h-8 w-8" />
                  <p className="text-sm">No execution activity</p>
                </>
              )}
            </div>
          )}

        {/* Todo Tracker - only show if not hidden */}
        {!hideTodoTracker && <TodoTracker todos={todos} className="mt-4" />}

        {/* Running indicator */}
        {showRunIndicator && execution.status === 'running' && <RunIndicator />}
      </div>
    )
  }

  // Full mode: card wrapper with header and footer
  return (
    <Card className={`flex flex-col ${className}`}>
      {/* Header: Status and Progress */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold">Execution Monitor</h3>
            {renderStatusBadge()}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {execution.runId && (
              <span className="font-mono text-xs">Run: {execution.runId.slice(0, 8)}</span>
            )}
            {isConnected && (
              <Badge variant="outline" className="text-xs">
                Live
              </Badge>
            )}
          </div>
        </div>

      </div>

      {/* Main: Agent Trajectory */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Error display */}
        {(error || execution.error) && (
          <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
              <div className="flex-1">
                <h4 className="font-semibold text-destructive">Error</h4>
                <p className="mt-1 text-sm text-destructive/90">
                  {execution.error || error?.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Agent Trajectory - unified messages and tool calls */}
        {(messageCount > 0 || toolCallCount > 0 || permissionRequests.length > 0) && (
          <AgentTrajectory
            messages={messages}
            toolCalls={toolCalls}
            thoughts={thoughts}
            permissionRequests={permissionRequests}
            onPermissionRespond={handlePermissionRespond}
            onSkipAllPermissions={onSkipAllPermissionsComplete ? handleSkipAllPermissions : undefined}
            isSkippingAllPermissions={isSkippingAllPermissions}
            renderMarkdown
            showTodoTracker={false}
          />
        )}

        {/* Empty state */}
        {messageCount === 0 && toolCallCount === 0 && !error && !execution.error && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            {isActive || isConnected ? (
              <>
                <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                <p className="text-sm">Waiting for events...</p>
              </>
            ) : (
              <>
                <AlertCircle className="mb-2 h-8 w-8" />
                <p className="text-sm">No execution activity</p>
              </>
            )}
          </div>
        )}

        {/* Todo Tracker - pinned at bottom of trajectory - only show if not hidden */}
        {!hideTodoTracker && <TodoTracker todos={todos} className="mt-4" />}

        {/* Running indicator */}
        {showRunIndicator && execution.status === 'running' && <RunIndicator />}
      </div>

      {/* Footer: Metrics */}
      <div className="border-t bg-muted/30 px-6 py-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              <span className="font-medium">{toolCallCount}</span> tool calls
            </span>
            <span>
              <span className="font-medium">{completedToolCalls}</span> completed
            </span>
            <span>
              <span className="font-medium">{messageCount}</span> messages
            </span>
          </div>

          {/* Execution time */}
          {execution.startTime && execution.endTime && (
            <span>
              Duration:{' '}
              <span className="font-medium">
                {((execution.endTime - execution.startTime) / 1000).toFixed(2)}s
              </span>
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
