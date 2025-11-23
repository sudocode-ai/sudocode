/**
 * ExecutionMonitor Component
 *
 * Displays execution status using either:
 * - Real-time SSE streaming for active executions (running, pending, preparing, paused)
 * - Historical logs API for completed executions (completed, failed, cancelled, stopped)
 *
 * Shows execution progress, metrics, messages, and tool calls.
 */

import { useEffect, useMemo } from 'react'
import { useAgUiStream } from '@/hooks/useAgUiStream'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AgentTrajectory } from './AgentTrajectory'
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

  // Select the appropriate data source
  const {
    connectionStatus,
    execution,
    messages,
    toolCalls,
    state,
    error,
    isConnected,
  } = useMemo(() => {
    if (isActive) {
      // Use SSE stream for active executions
      return {
        connectionStatus: sseStream.connectionStatus,
        execution: sseStream.execution,
        messages: sseStream.messages,
        toolCalls: sseStream.toolCalls,
        state: sseStream.state,
        error: sseStream.error,
        isConnected: sseStream.isConnected,
      }
    } else {
      // Use logs API for completed executions
      // Transform events to messages/toolCalls format (matching SSE stream format)
      const messages = new Map()
      const toolCalls = new Map()
      const state: any = {}

      // Process events from logs (same logic as useAgUiStream)
      if (logsResult.events) {
        logsResult.events.forEach((event: any) => {
          // Handle TEXT_MESSAGE events
          if (event.type === 'TEXT_MESSAGE_START') {
            messages.set(event.messageId, {
              messageId: event.messageId,
              role: event.role || 'assistant',
              content: '',
              complete: false,
              timestamp: event.timestamp || Date.now(),
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

      return {
        connectionStatus: logsResult.loading ? 'connecting' : logsResult.error ? 'error' : 'connected',
        execution: {
          status: executionProp?.status || 'completed',
          runId: executionId,
          currentStep: undefined,
          error: logsResult.error?.message,
          startTime: undefined,
          endTime: undefined,
        },
        messages,
        toolCalls,
        state,
        error: logsResult.error,
        isConnected: false, // Not live for historical
      }
    }
  }, [isActive, sseStream, logsResult, executionId, executionProp])

  // Trigger callbacks when execution status changes
  useEffect(() => {
    if (execution.status === 'completed' && onComplete) {
      onComplete()
    }
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
    return (
      <Card className={`p-6 ${className}`}>
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Connecting to execution stream...</span>
        </div>
      </Card>
    )
  }

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
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
              <span>Progress</span>
              <span>
                {state.progress} / {state.totalSteps}
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
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
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 mb-4">
            <div className="flex items-start gap-2">
              <XCircle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-destructive">Error</h4>
                <p className="text-sm text-destructive/90 mt-1">
                  {execution.error || error?.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Agent Trajectory - unified messages and tool calls */}
        {(messageCount > 0 || toolCallCount > 0) && (
          <AgentTrajectory messages={messages} toolCalls={toolCalls} renderMarkdown />
        )}

        {/* Empty state */}
        {messageCount === 0 && toolCallCount === 0 && !error && !execution.error && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm">No execution activity yet</p>
            <p className="text-xs mt-1">
              {isConnected ? 'Waiting for events...' : 'Connecting...'}
            </p>
          </div>
        )}
      </div>

      {/* Footer: Metrics */}
      <div className="border-t px-6 py-3 bg-muted/30">
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
