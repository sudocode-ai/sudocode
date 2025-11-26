/**
 * ExecutionPreview Component
 *
 * Compact, configurable preview of an agent execution.
 * Shows last N messages/tool calls with truncation.
 * Can be embedded in IssueCard, ActivityTimeline, IssuePanel, etc.
 *
 * Variants:
 * - compact: 1-2 lines, minimal info (badges/cards)
 * - standard: 3-10 lines, moderate detail (timelines)
 * - detailed: 10-20 lines, comprehensive view (panels)
 */

import { useMemo } from 'react'
import { useAgUiStream, type MessageBuffer, type ToolCallTracking } from '@/hooks/useAgUiStream'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { Execution } from '@/types/execution'
import { formatDistanceToNow } from 'date-fns'

export type ExecutionPreviewVariant = 'compact' | 'standard' | 'detailed'

export interface ExecutionPreviewProps {
  /**
   * Execution ID to preview
   */
  executionId: string

  /**
   * Execution metadata (optional, for status detection and display)
   */
  execution?: Execution

  /**
   * Display variant
   * - compact: 1-2 lines, minimal info
   * - standard: 3-10 lines, moderate detail
   * - detailed: 10-20 lines, comprehensive view
   */
  variant?: ExecutionPreviewVariant

  /**
   * Max lines to show per message (overrides variant default)
   */
  maxLines?: number

  /**
   * Max messages to show (overrides variant default)
   */
  maxMessages?: number

  /**
   * Max tool calls to show (overrides variant default)
   */
  maxToolCalls?: number

  /**
   * Show progress metrics
   */
  showMetrics?: boolean

  /**
   * Show execution status badge
   */
  showStatus?: boolean

  /**
   * Callback to view full execution
   */
  onViewFull?: () => void

  /**
   * Custom class name
   */
  className?: string
}

// Variant defaults
const VARIANT_DEFAULTS = {
  compact: {
    maxLines: 2,
    maxMessages: 1,
    maxToolCalls: 2,
    showMetrics: false,
    showStatus: true,
  },
  standard: {
    maxLines: 10,
    maxMessages: 3,
    maxToolCalls: 5,
    showMetrics: true,
    showStatus: true,
  },
  detailed: {
    maxLines: 20,
    maxMessages: 10,
    maxToolCalls: 10,
    showMetrics: true,
    showStatus: true,
  },
}

/**
 * ExecutionPreview Component
 *
 * @example
 * ```tsx
 * // Compact preview for IssueCard badge
 * <ExecutionPreview
 *   executionId="exec-123"
 *   execution={execution}
 *   variant="compact"
 * />
 *
 * // Standard preview for ActivityTimeline
 * <ExecutionPreview
 *   executionId="exec-456"
 *   execution={execution}
 *   variant="standard"
 *   onViewFull={() => navigate(`/executions/${execution.id}`)}
 * />
 *
 * // Detailed preview for IssuePanel
 * <ExecutionPreview
 *   executionId="exec-789"
 *   execution={execution}
 *   variant="detailed"
 *   showMetrics={true}
 * />
 * ```
 */
export function ExecutionPreview({
  executionId,
  execution: executionProp,
  variant = 'standard',
  maxLines: maxLinesProp,
  maxMessages: maxMessagesProp,
  maxToolCalls: maxToolCallsProp,
  showMetrics: showMetricsProp,
  showStatus: showStatusProp,
  onViewFull,
  className = '',
}: ExecutionPreviewProps) {
  // Get defaults for variant
  const defaults = VARIANT_DEFAULTS[variant]
  const maxLines = maxLinesProp ?? defaults.maxLines
  const maxMessages = maxMessagesProp ?? defaults.maxMessages
  const maxToolCalls = maxToolCallsProp ?? defaults.maxToolCalls
  const showMetrics = showMetricsProp ?? defaults.showMetrics
  const showStatus = showStatusProp ?? defaults.showStatus

  // Determine if execution is active or completed
  const isActive = useMemo(() => {
    if (!executionProp) return true
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
  const { execution, messages, toolCalls, state, error } = useMemo(() => {
    if (isActive) {
      return {
        execution: sseStream.execution,
        messages: sseStream.messages,
        toolCalls: sseStream.toolCalls,
        state: sseStream.state,
        error: sseStream.error,
      }
    } else {
      // Transform logs to messages/toolCalls format
      const messages = new Map<string, MessageBuffer>()
      const toolCalls = new Map<string, ToolCallTracking>()
      const state: any = {}

      if (logsResult.events) {
        logsResult.events.forEach((event: any) => {
          if (event.type === 'TEXT_MESSAGE_CONTENT' || event.name === 'TEXT_MESSAGE_CONTENT') {
            const content = event.value || event
            const messageId = `msg-${messages.size}`
            messages.set(messageId, {
              messageId,
              role: 'assistant',
              content: content.content || content.text || '',
              complete: true,
              timestamp: event.timestamp || Date.now(),
            })
          } else if (event.type === 'TOOL_CALL_START' || event.name === 'TOOL_CALL_START') {
            const value = event.value || event
            toolCalls.set(value.toolCallId, {
              toolCallId: value.toolCallId,
              toolCallName: value.name || '',
              args: '',
              status: 'started',
              startTime: event.timestamp || Date.now(),
            })
          } else if (event.type === 'TOOL_CALL_RESULT' || event.name === 'TOOL_CALL_RESULT') {
            const value = event.value || event
            const existing = toolCalls.get(value.toolCallId)
            if (existing) {
              toolCalls.set(value.toolCallId, {
                ...existing,
                status: 'completed',
                result: value.result,
                endTime: event.timestamp || Date.now(),
              })
            }
          }
        })
      }

      return {
        execution: {
          status: executionProp?.status || 'completed',
          runId: executionId,
          threadId: null,
          currentStep: null,
          error: logsResult.error?.message || null,
          startTime: null,
          endTime: null,
        },
        messages,
        toolCalls,
        state,
        error: logsResult.error,
      }
    }
  }, [isActive, sseStream, logsResult, executionId, executionProp])

  // Get last N messages
  const lastMessages = useMemo(() => {
    const allMessages = Array.from(messages.values())
    return allMessages.slice(-maxMessages)
  }, [messages, maxMessages])

  // Get last N tool calls
  const lastToolCalls = useMemo(() => {
    const allToolCalls = Array.from(toolCalls.values())
    return allToolCalls.slice(-maxToolCalls)
  }, [toolCalls, maxToolCalls])

  // Calculate metrics
  const toolCallCount = toolCalls.size
  const messageCount = messages.size
  const filesChanged = state.filesChanged || 0
  const tokenUsage = state.tokenUsage || 0
  const cost = state.cost || 0

  // Get execution status display
  const statusInfo = useMemo(() => {
    const status = executionProp?.status || execution.status
    switch (status) {
      case 'preparing':
        return { icon: Loader2, label: 'Preparing', color: 'text-yellow-600', spin: true }
      case 'pending':
        return { icon: Clock, label: 'Pending', color: 'text-blue-600', spin: false }
      case 'running':
        return { icon: Loader2, label: 'Running', color: 'text-blue-600', spin: true }
      case 'paused':
        return { icon: AlertCircle, label: 'Paused', color: 'text-yellow-600', spin: false }
      case 'completed':
        return { icon: CheckCircle2, label: 'Completed', color: 'text-green-600', spin: false }
      case 'failed':
        return { icon: XCircle, label: 'Failed', color: 'text-red-600', spin: false }
      case 'cancelled':
        return { icon: XCircle, label: 'Cancelled', color: 'text-gray-600', spin: false }
      case 'stopped':
        return { icon: XCircle, label: 'Stopped', color: 'text-gray-600', spin: false }
      default:
        return { icon: AlertCircle, label: 'Unknown', color: 'text-gray-600', spin: false }
    }
  }, [executionProp, execution])

  // Truncate text to N lines
  const truncateText = (text: string, lines: number): { text: string; truncated: boolean } => {
    const textLines = text.split('\n')
    if (textLines.length <= lines) {
      return { text, truncated: false }
    }
    return {
      text: textLines.slice(0, lines).join('\n'),
      truncated: true,
    }
  }

  // Render compact variant (single line badge-like)
  if (variant === 'compact') {
    const StatusIcon = statusInfo.icon

    return (
      <div className={`flex items-center gap-2 text-sm ${className}`}>
        {showStatus && (
          <Badge variant="outline" className="flex items-center gap-1">
            <StatusIcon
              className={`h-3 w-3 ${statusInfo.color} ${statusInfo.spin ? 'animate-spin' : ''}`}
            />
            {statusInfo.label}
          </Badge>
        )}
        {toolCallCount > 0 && (
          <span className="text-muted-foreground">
            {toolCallCount} tool call{toolCallCount !== 1 ? 's' : ''}
          </span>
        )}
        {filesChanged > 0 && (
          <span className="text-muted-foreground">{filesChanged} files</span>
        )}
        {executionProp?.created_at && (
          <span className="text-muted-foreground">
            {formatDistanceToNow(new Date(executionProp.created_at), { addSuffix: true })}
          </span>
        )}
        {onViewFull && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewFull}
            className="h-6 px-2 text-xs"
          >
            View
          </Button>
        )}
      </div>
    )
  }

  // Render standard/detailed variants
  const StatusIcon = statusInfo.icon

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header: Status and Metrics */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {showStatus && (
            <div className="flex items-center gap-1.5">
              <StatusIcon
                className={`h-4 w-4 ${statusInfo.color} ${statusInfo.spin ? 'animate-spin' : ''}`}
              />
              <span className="text-sm font-medium">{statusInfo.label}</span>
            </div>
          )}
          {executionProp?.agent_type && (
            <Badge variant="outline" className="text-xs">
              {executionProp.agent_type}
            </Badge>
          )}
        </div>
        {executionProp?.created_at && (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(executionProp.created_at), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Metrics */}
      {showMetrics && (toolCallCount > 0 || messageCount > 0 || filesChanged > 0) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {toolCallCount > 0 && (
            <span>
              <span className="font-medium">{toolCallCount}</span> tool call
              {toolCallCount !== 1 ? 's' : ''}
            </span>
          )}
          {filesChanged > 0 && (
            <span>
              <span className="font-medium">{filesChanged}</span> file
              {filesChanged !== 1 ? 's' : ''}
            </span>
          )}
          {tokenUsage > 0 && (
            <span>
              <span className="font-medium">{tokenUsage.toLocaleString()}</span> tokens
            </span>
          )}
          {cost > 0 && (
            <span>
              <span className="font-medium">${cost.toFixed(4)}</span>
            </span>
          )}
        </div>
      )}

      {/* Tool Calls Preview */}
      {lastToolCalls.length > 0 && (
        <div className="space-y-1">
          {lastToolCalls.map((toolCall) => {
            const statusBadge =
              toolCall.status === 'completed' ? (
                <CheckCircle2 className="h-3 w-3 text-green-600" />
              ) : toolCall.status === 'error' ? (
                <XCircle className="h-3 w-3 text-red-600" />
              ) : (
                <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />
              )

            const duration =
              toolCall.endTime && toolCall.startTime
                ? `${((toolCall.endTime - toolCall.startTime) / 1000).toFixed(1)}s`
                : null

            return (
              <div key={toolCall.toolCallId} className="flex items-start gap-2 text-xs">
                <Wrench className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {statusBadge}
                    <span className="font-mono font-medium truncate">
                      {toolCall.toolCallName}
                    </span>
                    {duration && (
                      <span className="text-muted-foreground">({duration})</span>
                    )}
                  </div>
                  {variant === 'detailed' && toolCall.result && (
                    <div className="mt-1 text-muted-foreground">
                      {truncateText(toolCall.result, 2).text}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {toolCallCount > maxToolCalls && (
            <div className="text-xs text-muted-foreground italic">
              +{toolCallCount - maxToolCalls} more tool call
              {toolCallCount - maxToolCalls !== 1 ? 's' : ''}...
            </div>
          )}
        </div>
      )}

      {/* Messages Preview */}
      {lastMessages.length > 0 && (
        <div className="space-y-1">
          {lastMessages.map((message) => {
            const { text, truncated } = truncateText(message.content, maxLines)
            return (
              <div key={message.messageId} className="flex items-start gap-2 text-xs">
                <MessageSquare className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="whitespace-pre-wrap break-words">{text}</div>
                  {truncated && (
                    <span className="text-muted-foreground italic">...</span>
                  )}
                </div>
              </div>
            )
          })}
          {messageCount > maxMessages && (
            <div className="text-xs text-muted-foreground italic">
              +{messageCount - maxMessages} more message
              {messageCount - maxMessages !== 1 ? 's' : ''}...
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <XCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {/* View Full Button */}
      {onViewFull && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewFull}
          className="h-7 text-xs gap-1 w-full justify-center"
        >
          View Full Execution
          <ChevronRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
