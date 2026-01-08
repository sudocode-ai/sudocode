/**
 * OrchestratorTrajectory Component
 *
 * Displays the orchestrator agent's execution trajectory with specialized
 * formatting for workflow MCP tools (execute_issue, escalate_to_user, etc.)
 */

import { useMemo, useEffect, useRef } from 'react'
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bell,
  Activity,
  Loader2,
  Wrench,
  MessageSquare,
  RefreshCw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSessionUpdateStream, type AgentMessage, type ToolCall } from '@/hooks/useSessionUpdateStream'
import type { EscalationData, EscalationResponseRequest } from '@/types/workflow'
import { EscalationPanel } from './EscalationPanel'

// =============================================================================
// Types
// =============================================================================

export interface OrchestratorTrajectoryProps {
  /** The orchestrator execution ID */
  executionId: string
  /** The workflow ID */
  workflowId: string
  /** Pending escalation data (if any) */
  escalation?: EscalationData
  /** Callback when user responds to escalation */
  onEscalationResponse?: (response: EscalationResponseRequest) => void
  /** Whether a response is being submitted */
  isRespondingToEscalation?: boolean
  /** Additional class name */
  className?: string
}

/**
 * Trajectory item representing either a message, tool call, or event
 */
type TrajectoryItem =
  | {
      type: 'message'
      timestamp: number
      index?: number
      data: AgentMessage
    }
  | {
      type: 'tool_call'
      timestamp: number
      index?: number
      data: ToolCall
    }
  | {
      type: 'wakeup'
      timestamp: number
      eventCount: number
    }

// =============================================================================
// Tool-specific Formatters
// =============================================================================

interface FormattedToolCall {
  icon: React.ReactNode
  title: string
  subtitle?: string
  variant: 'default' | 'primary' | 'success' | 'warning' | 'error'
  isEscalation?: boolean
}

function formatToolCall(toolCall: ToolCall): FormattedToolCall {
  let args: Record<string, unknown> = {}
  const rawInput = toolCall.rawInput
  if (rawInput) {
    try {
      args = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput as Record<string, unknown>
    } catch {
      // Args may be incomplete (still streaming) or malformed - use empty object
      args = {}
    }
  }

  switch (toolCall.title) {
    case 'execute_issue':
      return {
        icon: <Play className="h-4 w-4" />,
        title: `Starting issue ${args.issue_id || 'unknown'}`,
        subtitle: args.agent_type ? `Agent: ${args.agent_type}` : undefined,
        variant: 'primary',
      }

    case 'execution_status': {
      let result = null
      if (toolCall.result) {
        try {
          result = typeof toolCall.result === 'string' ? JSON.parse(toolCall.result) : toolCall.result
        } catch {
          // Result may be malformed - use null
        }
      }
      const resultData = result as Record<string, any> | null
      const status = resultData?.data?.status || 'checking'
      const execId = args.execution_id as string | undefined
      return {
        icon: <Activity className="h-4 w-4" />,
        title: `Checking execution ${execId?.slice(0, 8) || ''}...`,
        subtitle:
          status === 'completed'
            ? 'Completed successfully'
            : status === 'failed'
              ? 'Execution failed'
              : status === 'running'
                ? 'Still running...'
                : `Status: ${status}`,
        variant: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'default',
      }
    }

    case 'execution_cancel': {
      const cancelExecId = args.execution_id as string | undefined
      const reason = args.reason as string | undefined
      return {
        icon: <XCircle className="h-4 w-4" />,
        title: `Cancelling execution ${cancelExecId?.slice(0, 8) || ''}`,
        subtitle: reason,
        variant: 'warning',
      }
    }

    case 'escalate_to_user': {
      const escalateMessage = args.message as string | undefined
      return {
        icon: <AlertTriangle className="h-4 w-4" />,
        title: 'Requesting user input',
        subtitle: escalateMessage ? escalateMessage.slice(0, 50) + (escalateMessage.length > 50 ? '...' : '') : undefined,
        variant: 'warning',
        isEscalation: true,
      }
    }

    case 'notify_user': {
      const level = (args.level as string) || 'info'
      const notifyMessage = args.message as string | undefined
      return {
        icon: <Bell className="h-4 w-4" />,
        title: `Notification (${level})`,
        subtitle: notifyMessage ? notifyMessage.slice(0, 50) + (notifyMessage.length > 50 ? '...' : '') : undefined,
        variant: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'default',
      }
    }

    case 'workflow_complete': {
      const success = args.status !== 'failed'
      const summary = args.summary as string | undefined
      return {
        icon: success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />,
        title: success ? 'Workflow completed' : 'Workflow failed',
        subtitle: summary,
        variant: success ? 'success' : 'error',
      }
    }

    case 'workflow_status':
      return {
        icon: <Activity className="h-4 w-4" />,
        title: 'Checking workflow status',
        variant: 'default',
      }

    default:
      return {
        icon: <Wrench className="h-4 w-4" />,
        title: toolCall.title,
        variant: 'default',
      }
  }
}

const VARIANT_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  default: {
    bg: 'bg-muted/50',
    border: 'border-muted',
    icon: 'bg-muted text-muted-foreground',
  },
  primary: {
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/30',
    icon: 'bg-blue-500/10 text-blue-500',
  },
  success: {
    bg: 'bg-green-500/5',
    border: 'border-green-500/30',
    icon: 'bg-green-500/10 text-green-500',
  },
  warning: {
    bg: 'bg-yellow-500/5',
    border: 'border-yellow-500/30',
    icon: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  },
  error: {
    bg: 'bg-red-500/5',
    border: 'border-red-500/30',
    icon: 'bg-red-500/10 text-red-500',
  },
}

// =============================================================================
// Component
// =============================================================================

export function OrchestratorTrajectory({
  executionId,
  escalation,
  onEscalationResponse,
  isRespondingToEscalation = false,
  className,
}: OrchestratorTrajectoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Use the session update stream hook to get real-time execution data
  const { messages, toolCalls, isConnected, error } = useSessionUpdateStream({ executionId })

  // Build chronological trajectory
  const trajectory = useMemo(() => {
    const items: TrajectoryItem[] = []

    // Add messages (filtering out system messages)
    messages.forEach((message) => {
      if (message.content.trim().startsWith('[System]')) {
        return
      }
      items.push({
        type: 'message',
        timestamp: message.timestamp.getTime(),
        index: message.index,
        data: message,
      })
    })

    // Add tool calls
    toolCalls.forEach((toolCall) => {
      items.push({
        type: 'tool_call',
        timestamp: toolCall.timestamp.getTime(),
        index: toolCall.index,
        data: toolCall,
      })
    })

    // Sort by timestamp
    return items.sort((a, b) => {
      const timeDiff = a.timestamp - b.timestamp
      if (timeDiff !== 0) return timeDiff
      // Use index for stable ordering (only on message/tool_call types)
      const aIndex = a.type !== 'wakeup' ? a.index : undefined
      const bIndex = b.type !== 'wakeup' ? b.index : undefined
      if (aIndex !== undefined && bIndex !== undefined) {
        return aIndex - bIndex
      }
      return 0
    })
  }, [messages, toolCalls])

  // Auto-scroll to bottom on new items
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [trajectory.length])

  // Format relative time
  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(timestamp).toLocaleTimeString()
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-muted-foreground', className)}>
        <XCircle className="h-5 w-5 mr-2 text-destructive" />
        Failed to load trajectory
      </div>
    )
  }

  if (!isConnected && trajectory.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-muted-foreground', className)}>
        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
        Connecting to orchestrator...
      </div>
    )
  }

  return (
    <ScrollArea ref={scrollRef} className={cn('h-full', className)}>
      <div className="space-y-3 p-4">
        {trajectory.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            <RefreshCw className="h-5 w-5 mx-auto mb-2 animate-spin" />
            Waiting for orchestrator activity...
          </div>
        )}

        {trajectory.map((item, index) => {
          if (item.type === 'wakeup') {
            return (
              <div key={`wakeup-${index}`} className="flex items-center gap-2 py-2">
                <div className="flex-1 border-t border-dashed" />
                <span className="text-xs text-muted-foreground">
                  Orchestrator resumed ({item.eventCount} events)
                </span>
                <div className="flex-1 border-t border-dashed" />
              </div>
            )
          }

          if (item.type === 'message') {
            const message = item.data
            return (
              <div key={`msg-${message.id}`} className="flex items-start gap-3">
                <div className="mt-1 flex-shrink-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                    <MessageSquare className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      orchestrator
                    </Badge>
                    {message.isStreaming && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatTime(message.timestamp.getTime())}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                    {message.content}
                  </div>
                </div>
              </div>
            )
          }

          // Tool call
          const toolCall = item.data
          const formatted = formatToolCall(toolCall)
          const styles = VARIANT_STYLES[formatted.variant]

          // Get error from result if status is failed
          const toolError = toolCall.status === 'failed' && toolCall.result
            ? (typeof toolCall.result === 'object' && toolCall.result !== null
                ? (toolCall.result as Record<string, unknown>).error as string | undefined
                : undefined)
            : undefined

          return (
            <div key={`tool-${toolCall.id}`} className="flex items-start gap-3">
              <div className="mt-1 flex-shrink-0">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full',
                    styles.icon
                  )}
                >
                  {formatted.icon}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn('rounded-lg border p-3', styles.bg, styles.border)}>
                  {/* Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{formatted.title}</span>
                      {(toolCall.status === 'pending' || toolCall.status === 'running') && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(toolCall.timestamp.getTime())}
                    </span>
                  </div>

                  {/* Subtitle */}
                  {formatted.subtitle && (
                    <p className="mt-1 text-xs text-muted-foreground">{formatted.subtitle}</p>
                  )}

                  {/* Error */}
                  {toolError && (
                    <div className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                      {toolError}
                    </div>
                  )}
                </div>

                {/* Inline escalation panel for escalate_to_user */}
                {formatted.isEscalation && escalation && onEscalationResponse && (
                  <div className="mt-3">
                    <EscalationPanel
                      escalation={escalation}
                      onRespond={onEscalationResponse}
                      isResponding={isRespondingToEscalation}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Connection indicator */}
        {isConnected && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Connected
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

export default OrchestratorTrajectory
