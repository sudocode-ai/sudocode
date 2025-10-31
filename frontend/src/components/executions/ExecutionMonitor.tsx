/**
 * ExecutionMonitor Component
 *
 * Displays real-time execution status using the AG-UI event stream.
 * Shows execution progress, metrics, messages, and tool calls.
 */

import { useEffect } from 'react'
import { useAgUiStream } from '@/hooks/useAgUiStream'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'

export interface ExecutionMonitorProps {
  /**
   * Execution ID to monitor
   */
  executionId: string

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
 * <ExecutionMonitor
 *   executionId="exec-123"
 *   onComplete={() => console.log('Done!')}
 *   onError={(err) => console.error(err)}
 * />
 * ```
 */
export function ExecutionMonitor({
  executionId,
  onComplete,
  onError,
  className = '',
}: ExecutionMonitorProps) {
  const {
    connectionStatus,
    execution,
    messages,
    toolCalls,
    state,
    error,
    isConnected,
  } = useAgUiStream({
    executionId,
    autoConnect: true,
  })

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

      {/* Main: Messages and Tool Calls */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {/* Error display */}
        {(error || execution.error) && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
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

        {/* Messages */}
        {messageCount > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Messages</h4>
            {Array.from(messages.values()).map((message) => (
              <div
                key={message.messageId}
                className="rounded-md bg-muted/50 p-3 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {message.role}
                  </Badge>
                  {!message.complete && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="text-foreground/90 whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tool Calls */}
        {toolCallCount > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Tool Calls</h4>
            {Array.from(toolCalls.values()).map((toolCall) => (
              <div
                key={toolCall.toolCallId}
                className="rounded-md border bg-card p-3 text-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{toolCall.toolCallName}</span>
                    <Badge
                      variant={
                        toolCall.status === 'completed'
                          ? 'default'
                          : toolCall.status === 'error'
                          ? 'destructive'
                          : 'secondary'
                      }
                      className="text-xs"
                    >
                      {toolCall.status}
                    </Badge>
                  </div>
                  {toolCall.endTime && toolCall.startTime && (
                    <span className="text-xs text-muted-foreground">
                      {((toolCall.endTime - toolCall.startTime) / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>

                {/* Tool args */}
                {toolCall.args && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Arguments
                    </summary>
                    <pre className="mt-1 text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                      {toolCall.args}
                    </pre>
                  </details>
                )}

                {/* Tool result */}
                {toolCall.result && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Result
                    </summary>
                    <pre className="mt-1 text-xs bg-muted/50 p-2 rounded overflow-x-auto max-h-40">
                      {toolCall.result}
                    </pre>
                  </details>
                )}

                {/* Tool error */}
                {toolCall.error && (
                  <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
                    {toolCall.error}
                  </div>
                )}
              </div>
            ))}
          </div>
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
