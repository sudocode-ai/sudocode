/**
 * ExecutionMonitor Component
 *
 * Displays execution status using either:
 * - Real-time SSE streaming for active executions (running, pending, preparing, paused)
 * - Historical logs API for completed executions (completed, failed, cancelled, stopped)
 *
 * Shows execution progress, metrics, messages, and tool calls.
 * Supports multiple view modes: structured, terminal, and split (hybrid).
 */

import { useEffect, useMemo, useState } from 'react'
import { useAgUiStream } from '@/hooks/useAgUiStream'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentTrajectory } from './AgentTrajectory'
import { TerminalView } from './TerminalView'
import { AlertCircle, CheckCircle2, Loader2, XCircle, Monitor, Code, Columns } from 'lucide-react'
import type { Execution } from '@/types/execution'

/**
 * View mode for displaying execution output
 */
type ViewMode = 'structured' | 'terminal' | 'split'

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

  // View mode state - default based on execution mode
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (!executionProp?.execution_mode) return 'structured'
    if (executionProp.execution_mode === 'interactive') return 'terminal'
    if (executionProp.execution_mode === 'hybrid') return 'split'
    return 'structured'
  })

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
      // Transform events to messages/toolCalls format
      const messages = new Map()
      const toolCalls = new Map()
      const state: any = {}

      // Process events from logs
      if (logsResult.events) {
        logsResult.events.forEach((event: any) => {
          // Handle different event types
          if (event.type === 'TEXT_MESSAGE_CONTENT' || event.name === 'TEXT_MESSAGE_CONTENT') {
            const content = event.value || event
            messages.set(messages.size, {
              id: messages.size,
              content: content.content || content.text,
              timestamp: event.timestamp || Date.now(),
            })
          } else if (event.type === 'TOOL_CALL_START' || event.name === 'TOOL_CALL_START') {
            const value = event.value || event
            toolCalls.set(value.toolCallId, {
              id: value.toolCallId,
              name: value.name,
              status: 'running',
              timestamp: event.timestamp || Date.now(),
            })
          } else if (event.type === 'TOOL_CALL_RESULT' || event.name === 'TOOL_CALL_RESULT') {
            const value = event.value || event
            const existing = toolCalls.get(value.toolCallId)
            if (existing) {
              toolCalls.set(value.toolCallId, {
                ...existing,
                status: 'completed',
                result: value.result,
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

  // Determine available view modes based on execution mode
  const availableViewModes = useMemo(() => {
    const executionMode = executionProp?.execution_mode
    if (!executionMode || executionMode === 'structured') {
      // Structured mode: only structured view
      return ['structured'] as ViewMode[]
    } else if (executionMode === 'interactive') {
      // Interactive mode: only terminal view
      return ['terminal'] as ViewMode[]
    } else {
      // Hybrid mode: all views available
      return ['structured', 'terminal', 'split'] as ViewMode[]
    }
  }, [executionProp?.execution_mode])

  // Check if terminal is available for this execution
  const hasTerminal = useMemo(() => {
    return executionProp?.terminal_enabled === true
  }, [executionProp?.terminal_enabled])

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

        {/* View Mode Switcher */}
        {availableViewModes.length > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">View:</span>
            <div className="inline-flex rounded-md shadow-sm" role="group">
              <Button
                variant={viewMode === 'structured' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('structured')}
                disabled={!availableViewModes.includes('structured')}
                className="rounded-r-none"
              >
                <Code className="h-3 w-3 mr-1" />
                Structured
              </Button>
              <Button
                variant={viewMode === 'terminal' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('terminal')}
                disabled={!availableViewModes.includes('terminal') || !hasTerminal}
                className="rounded-none border-l-0"
              >
                <Monitor className="h-3 w-3 mr-1" />
                Terminal
              </Button>
              <Button
                variant={viewMode === 'split' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('split')}
                disabled={!availableViewModes.includes('split') || !hasTerminal}
                className="rounded-l-none border-l-0"
              >
                <Columns className="h-3 w-3 mr-1" />
                Split
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Main: Content based on view mode */}
      <div className="flex-1 overflow-auto">
        {/* Structured View */}
        {viewMode === 'structured' && (
          <div className="px-6 py-4">
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
        )}

        {/* Terminal View */}
        {viewMode === 'terminal' && (
          <div className="h-full">
            {hasTerminal ? (
              <TerminalView
                executionId={executionId}
                onError={(err) => onError?.(err)}
                className="h-full border-0"
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 px-6 text-center text-muted-foreground">
                <Monitor className="h-8 w-8 mb-2" />
                <p className="text-sm">Terminal not available</p>
                <p className="text-xs mt-1">
                  This execution was not started in interactive or hybrid mode
                </p>
              </div>
            )}
          </div>
        )}

        {/* Split View (Hybrid) */}
        {viewMode === 'split' && (
          <div className="flex h-full">
            {/* Structured content on the left */}
            <div className="flex-1 border-r overflow-auto px-6 py-4">
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

              {/* Agent Trajectory */}
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

            {/* Terminal on the right */}
            <div className="flex-1 overflow-hidden">
              {hasTerminal ? (
                <TerminalView
                  executionId={executionId}
                  onError={(err) => onError?.(err)}
                  className="h-full border-0"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full px-6 text-center text-muted-foreground">
                  <Monitor className="h-8 w-8 mb-2" />
                  <p className="text-sm">Terminal not available</p>
                  <p className="text-xs mt-1">
                    This execution was not started in hybrid mode
                  </p>
                </div>
              )}
            </div>
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
