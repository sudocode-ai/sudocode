/**
 * ExecutionMonitor Component
 *
 * Displays execution status using either:
 * - Real-time SSE streaming for active executions (running, pending, preparing, paused)
 * - Historical logs API for completed executions (completed, failed, cancelled, stopped)
 *
 * Shows execution progress, metrics, messages, and tool calls.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useAgUiStream } from '@/hooks/useAgUiStream'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AgentTrajectory } from './AgentTrajectory'
import { ClaudeCodeTrajectory } from './ClaudeCodeTrajectory'
import { TodoTracker } from './TodoTracker'
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { Execution } from '@/types/execution'

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
   * Compact mode - removes card wrapper and header for inline display
   */
  compact?: boolean

  /**
   * Custom class name
   */
  className?: string
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
  compact = false,
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

  // Use SSE streaming for active executions
  const sseStream = useAgUiStream({
    executionId,
    autoConnect: isActive,
  })

  // Use logs API for completed executions
  const logsResult = useExecutionLogs(executionId)

  // Process logs events into messages/toolCalls format
  const processedLogs = useMemo(() => {
    const messages = new Map()
    const toolCalls = new Map()
    const state: any = {}

    // Track sequence indices for stable ordering
    let messageIndex = 0
    let toolCallIndex = 0

    // Process events from logs (same logic as useAgUiStream)
    if (logsResult.events && logsResult.events.length > 0) {
      logsResult.events.forEach((event: any) => {
        // Handle TEXT_MESSAGE events
        if (event.type === 'TEXT_MESSAGE_START') {
          messages.set(event.messageId, {
            messageId: event.messageId,
            role: event.role || 'assistant',
            content: '',
            complete: false,
            timestamp: event.timestamp || Date.now(),
            index: messageIndex++,
          })
        } else if (event.type === 'TEXT_MESSAGE_CONTENT') {
          const existing = messages.get(event.messageId)
          if (existing) {
            messages.set(event.messageId, {
              ...existing,
              content: existing.content + (event.delta || ''),
            })
          }
        } else if (event.type === 'TEXT_MESSAGE_END') {
          const existing = messages.get(event.messageId)
          if (existing) {
            messages.set(event.messageId, {
              ...existing,
              complete: true,
            })
          }
        }
        // Handle TOOL_CALL events
        else if (event.type === 'TOOL_CALL_START') {
          toolCalls.set(event.toolCallId, {
            toolCallId: event.toolCallId,
            toolCallName: event.toolCallName || event.toolName,
            args: '',
            status: 'started',
            startTime: event.timestamp || Date.now(),
            index: toolCallIndex++,
          })
        } else if (event.type === 'TOOL_CALL_ARGS') {
          const existing = toolCalls.get(event.toolCallId)
          if (existing) {
            toolCalls.set(event.toolCallId, {
              ...existing,
              args: existing.args + (event.delta || ''),
            })
          }
        } else if (event.type === 'TOOL_CALL_END') {
          const existing = toolCalls.get(event.toolCallId)
          if (existing) {
            toolCalls.set(event.toolCallId, {
              ...existing,
              status: 'executing',
            })
          }
        } else if (event.type === 'TOOL_CALL_RESULT') {
          const existing = toolCalls.get(event.toolCallId)
          if (existing) {
            toolCalls.set(event.toolCallId, {
              ...existing,
              status: 'completed',
              result: event.result || event.content,
              endTime: event.timestamp || Date.now(),
            })
          }
        }
      })
    }

    return { messages, toolCalls, state }
  }, [logsResult.events])

  // Select the appropriate data source
  // Key insight: When transitioning from active to completed, keep showing SSE data
  // until logs are fully loaded to prevent flickering
  const { connectionStatus, execution, messages, toolCalls, state, error, isConnected } =
    useMemo(() => {
      // For active executions, always use SSE stream
      if (isActive) {
        return {
          connectionStatus: sseStream.connectionStatus,
          execution: sseStream.execution,
          messages: sseStream.messages,
          toolCalls: sseStream.toolCalls,
          state: sseStream.state,
          error: sseStream.error,
          isConnected: sseStream.isConnected,
        }
      }

      // For completed executions, use logs when available
      // But fall back to SSE data while logs are loading to prevent flicker
      const logsLoaded = !logsResult.loading && logsResult.events && logsResult.events.length > 0
      const hasSSEData = sseStream.messages.size > 0 || sseStream.toolCalls.size > 0

      // Use logs if loaded, otherwise fall back to SSE data if available
      if (logsLoaded) {
        return {
          connectionStatus: logsResult.error ? 'error' : 'connected',
          execution: {
            status: executionProp?.status || 'completed',
            runId: executionId,
            currentStep: undefined,
            error: logsResult.error?.message,
            startTime: undefined,
            endTime: undefined,
          },
          messages: processedLogs.messages,
          toolCalls: processedLogs.toolCalls,
          state: processedLogs.state,
          error: logsResult.error,
          isConnected: false,
        }
      } else if (hasSSEData) {
        // Logs still loading but we have SSE data - keep showing it
        return {
          connectionStatus: logsResult.loading ? 'connecting' : sseStream.connectionStatus,
          execution: {
            ...sseStream.execution,
            status: executionProp?.status || sseStream.execution.status,
          },
          messages: sseStream.messages,
          toolCalls: sseStream.toolCalls,
          state: sseStream.state,
          error: sseStream.error,
          isConnected: false, // Not live anymore since execution completed
        }
      } else {
        // No SSE data and logs not loaded yet - show loading state
        return {
          connectionStatus: logsResult.loading
            ? 'connecting'
            : logsResult.error
              ? 'error'
              : 'connected',
          execution: {
            status: executionProp?.status || 'completed',
            runId: executionId,
            currentStep: undefined,
            error: logsResult.error?.message,
            startTime: undefined,
            endTime: undefined,
          },
          messages: processedLogs.messages,
          toolCalls: processedLogs.toolCalls,
          state: processedLogs.state,
          error: logsResult.error,
          isConnected: false,
        }
      }
    }, [isActive, sseStream, logsResult, processedLogs, executionId, executionProp])

  // Track whether onComplete has already been called to prevent infinite loops
  // When an execution is already 'completed' on mount, we should not call onComplete
  // (it's only for when the status transitions TO completed during streaming)
  const hasCalledOnComplete = useRef(false)
  const previousStatus = useRef<string | undefined>(undefined)

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

  // Calculate metrics
  const toolCallCount = toolCalls.size
  const completedToolCalls = Array.from(toolCalls.values()).filter(
    (tc) => tc.status === 'completed'
  ).length
  const messageCount = messages.size

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
        {(messageCount > 0 || toolCallCount > 0) && (
          <>
            {executionProp?.agent_type === 'claude-code' ? (
              <ClaudeCodeTrajectory messages={messages} toolCalls={toolCalls} renderMarkdown />
            ) : (
              <AgentTrajectory messages={messages} toolCalls={toolCalls} renderMarkdown />
            )}
          </>
        )}

        {/* Empty state */}
        {messageCount === 0 && toolCallCount === 0 && !error && !execution.error && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p className="text-sm">No execution activity yet</p>
            <p className="mt-1 text-xs">
              {isConnected ? 'Waiting for events...' : 'Connecting...'}
            </p>
          </div>
        )}

        {/* Todo Tracker */}
        <TodoTracker toolCalls={toolCalls} className="mt-4" />
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

        {/* Current activity */}
        {execution.currentStep && (
          <div className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium">Current step:</span> {execution.currentStep}
          </div>
        )}

        {/* Progress from state */}
        {state.progress !== undefined && state.totalSteps && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-sm text-muted-foreground">
              <span>Progress</span>
              <span>
                {state.progress} / {state.totalSteps}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${(state.progress / state.totalSteps) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
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
        {/* Use Claude Code-specific rendering for claude-code agent type */}
        {(messageCount > 0 || toolCallCount > 0) && (
          <>
            {executionProp?.agent_type === 'claude-code' ? (
              <ClaudeCodeTrajectory messages={messages} toolCalls={toolCalls} renderMarkdown />
            ) : (
              <AgentTrajectory messages={messages} toolCalls={toolCalls} renderMarkdown />
            )}
          </>
        )}

        {/* Empty state */}
        {messageCount === 0 && toolCallCount === 0 && !error && !execution.error && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p className="text-sm">No execution activity yet</p>
            <p className="mt-1 text-xs">
              {isConnected ? 'Waiting for events...' : 'Connecting...'}
            </p>
          </div>
        )}

        {/* Todo Tracker - pinned at bottom of trajectory */}
        <TodoTracker toolCalls={toolCalls} className="mt-4" />
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

          {/* Custom state metrics */}
          {state.tokenUsage && (
            <div className="flex items-center gap-4">
              <span>
                <span className="font-medium">{state.tokenUsage}</span> tokens
              </span>
              {state.cost && (
                <span>
                  <span className="font-medium">${state.cost.toFixed(4)}</span>
                </span>
              )}
            </div>
          )}

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
