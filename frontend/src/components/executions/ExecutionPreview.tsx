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
import { useSessionUpdateStream, type AgentMessage, type ToolCall } from '@/hooks/useSessionUpdateStream'
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
   * Show status label text in badge (only icon if false)
   */
  showStatusLabel?: boolean

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
  showStatusLabel = true,
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

  // Use WebSocket streaming for active executions
  const wsStream = useSessionUpdateStream({
    executionId: isActive ? executionId : null,
  })

  // Use logs API for completed executions
  const logsResult = useExecutionLogs(executionId)

  // Process logs into messages and tool calls format
  const processedLogs = useMemo(() => {
    const messages: AgentMessage[] = []
    const toolCalls: ToolCall[] = []
    const messageMap = new Map<string, AgentMessage>()
    const toolCallMap = new Map<string, ToolCall>()
    let messageIndex = 0
    let toolCallIndex = 0

    if (logsResult.events) {
      logsResult.events.forEach((event: any) => {
        const eventType = event.type || event.name

        // Handle messages
        if (eventType === 'TEXT_MESSAGE_START') {
          const messageId = event.messageId || `msg-${messageIndex}`
          messageMap.set(messageId, {
            id: messageId,
            content: '',
            timestamp: new Date(event.timestamp || Date.now()),
            isStreaming: true,
            index: messageIndex++,
          })
        } else if (eventType === 'TEXT_MESSAGE_CONTENT') {
          const messageId = event.messageId
          const existing = messageMap.get(messageId)
          if (existing) {
            messageMap.set(messageId, {
              ...existing,
              content: existing.content + (event.delta || ''),
            })
          }
        } else if (eventType === 'TEXT_MESSAGE_END') {
          const messageId = event.messageId
          const existing = messageMap.get(messageId)
          if (existing) {
            messageMap.set(messageId, {
              ...existing,
              isStreaming: false,
            })
          }
        }
        // Handle tool calls
        else if (eventType === 'TOOL_CALL_START') {
          const toolCallId = event.toolCallId
          toolCallMap.set(toolCallId, {
            id: toolCallId,
            title: event.toolCallName || event.name || 'Unknown',
            status: 'running',
            timestamp: new Date(event.timestamp || Date.now()),
            rawInput: '',
            index: toolCallIndex++,
          })
        } else if (eventType === 'TOOL_CALL_ARGS') {
          const toolCallId = event.toolCallId
          const existing = toolCallMap.get(toolCallId)
          if (existing) {
            const currentInput = existing.rawInput || ''
            toolCallMap.set(toolCallId, {
              ...existing,
              rawInput: currentInput + (event.delta || ''),
            })
          }
        } else if (eventType === 'TOOL_CALL_END') {
          const toolCallId = event.toolCallId
          const existing = toolCallMap.get(toolCallId)
          if (existing) {
            toolCallMap.set(toolCallId, {
              ...existing,
              status: 'success',
              completedAt: new Date(event.timestamp || Date.now()),
            })
          }
        } else if (eventType === 'TOOL_CALL_RESULT') {
          const toolCallId = event.toolCallId
          const existing = toolCallMap.get(toolCallId)
          if (existing) {
            toolCallMap.set(toolCallId, {
              ...existing,
              status: 'success',
              result: event.result,
              completedAt: new Date(event.timestamp || Date.now()),
            })
          }
        }
      })
    }

    messages.push(...messageMap.values())
    toolCalls.push(...toolCallMap.values())

    return { messages, toolCalls }
  }, [logsResult.events])

  // Select the appropriate data source
  const { messages, toolCalls, executionStatus, error } = useMemo(() => {
    if (isActive && wsStream.messages.length > 0) {
      return {
        messages: wsStream.messages,
        toolCalls: wsStream.toolCalls,
        executionStatus: wsStream.execution.status,
        error: wsStream.error,
      }
    } else {
      return {
        messages: processedLogs.messages,
        toolCalls: processedLogs.toolCalls,
        executionStatus: executionProp?.status || 'completed',
        error: logsResult.error,
      }
    }
  }, [isActive, wsStream, processedLogs, executionProp, logsResult.error])

  // Get last N messages
  const lastMessages = useMemo(() => {
    return messages.slice(-maxMessages)
  }, [messages, maxMessages])

  // Get last N tool calls
  const lastToolCalls = useMemo(() => {
    return toolCalls.slice(-maxToolCalls)
  }, [toolCalls, maxToolCalls])

  // Calculate metrics
  const toolCallCount = toolCalls.length
  const messageCount = messages.length

  // Get execution status display
  const statusInfo = useMemo(() => {
    const status = executionProp?.status || executionStatus
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
  }, [executionProp, executionStatus])

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
          <>
            {showStatusLabel ? (
              <Badge variant="outline" className="flex items-center gap-1">
                <StatusIcon
                  className={`h-3 w-3 ${statusInfo.color} ${statusInfo.spin ? 'animate-spin' : ''}`}
                />
                {statusInfo.label}
              </Badge>
            ) : (
              <StatusIcon
                className={`h-3.5 w-3.5 ${statusInfo.color} ${statusInfo.spin ? 'animate-spin' : ''}`}
              />
            )}
          </>
        )}
        {executionProp?.agent_type && (
          <span className="text-xs text-muted-foreground">{executionProp.agent_type}</span>
        )}
        {executionProp?.created_at && (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(executionProp.created_at), { addSuffix: true })}
          </span>
        )}
        {onViewFull && (
          <Button variant="ghost" size="sm" onClick={onViewFull} className="h-6 px-2 text-xs">
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
      {showMetrics && (toolCallCount > 0 || messageCount > 0) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {toolCallCount > 0 && (
            <span>
              <span className="font-medium">{toolCallCount}</span> tool call
              {toolCallCount !== 1 ? 's' : ''}
            </span>
          )}
          {messageCount > 0 && (
            <span>
              <span className="font-medium">{messageCount}</span> message
              {messageCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Tool Calls Preview */}
      {lastToolCalls.length > 0 && (
        <div className="space-y-1">
          {lastToolCalls.map((toolCall) => {
            const statusBadge =
              toolCall.status === 'success' ? (
                <CheckCircle2 className="h-3 w-3 text-green-600" />
              ) : toolCall.status === 'failed' ? (
                <XCircle className="h-3 w-3 text-red-600" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
              )

            const duration =
              toolCall.completedAt && toolCall.timestamp
                ? `${((toolCall.completedAt.getTime() - toolCall.timestamp.getTime()) / 1000).toFixed(1)}s`
                : null

            const resultText = toolCall.result
              ? typeof toolCall.result === 'string'
                ? toolCall.result
                : JSON.stringify(toolCall.result)
              : null

            return (
              <div key={toolCall.id} className="flex items-start gap-2 text-xs">
                <Wrench className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {statusBadge}
                    <span className="truncate font-mono font-medium">{toolCall.title}</span>
                    {duration && <span className="text-muted-foreground">({duration})</span>}
                  </div>
                  {variant === 'detailed' && resultText && (
                    <div className="mt-1 text-muted-foreground">
                      {truncateText(resultText, 2).text}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {toolCallCount > maxToolCalls && (
            <div className="text-xs italic text-muted-foreground">
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
              <div key={message.id} className="flex items-start gap-2 text-xs">
                <MessageSquare className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap break-words">{text}</div>
                  {truncated && <span className="italic text-muted-foreground">...</span>}
                </div>
              </div>
            )
          })}
          {messageCount > maxMessages && (
            <div className="text-xs italic text-muted-foreground">
              +{messageCount - maxMessages} more message
              {messageCount - maxMessages !== 1 ? 's' : ''}...
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {/* View Full Button */}
      {onViewFull && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewFull}
          className="h-7 w-full justify-center gap-1 text-xs"
        >
          View Full Execution
          <ChevronRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
