/**
 * AgentTrajectory Component
 *
 * Displays the execution trajectory of an AI agent, showing messages and tool calls
 * in chronological order, similar to Claude Code's native experience.
 */

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2, MessageSquare, Wrench } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import type { MessageBuffer } from '@/hooks/useAgUiStream'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'

export interface AgentTrajectoryProps {
  /**
   * Map of messages to display
   */
  messages: Map<string, MessageBuffer>

  /**
   * Map of tool calls to display
   */
  toolCalls: Map<string, ToolCallTracking>

  /**
   * Whether to render markdown in messages (default: true)
   */
  renderMarkdown?: boolean

  /**
   * Whether to hide system messages (default: true)
   * System messages are those that start with [System]
   */
  hideSystemMessages?: boolean

  /**
   * Custom class name
   */
  className?: string
}

/**
 * Trajectory item representing either a message or a tool call
 */
type TrajectoryItem =
  | {
      type: 'message'
      timestamp: number
      index?: number
      data: MessageBuffer
    }
  | {
      type: 'tool_call'
      timestamp: number
      index?: number
      data: ToolCallTracking
    }

/**
 * AgentTrajectory Component
 *
 * Merges messages and tool calls into a single chronological timeline
 * to show the agent's execution path.
 *
 * @example
 * ```tsx
 * <AgentTrajectory
 *   messages={messages}
 *   toolCalls={toolCalls}
 *   renderMarkdown
 * />
 * ```
 */
export function AgentTrajectory({
  messages,
  toolCalls,
  renderMarkdown = true,
  hideSystemMessages = true,
  className = '',
}: AgentTrajectoryProps) {
  // Merge messages and tool calls into a chronological timeline
  const trajectory = useMemo(() => {
    const items: TrajectoryItem[] = []

    // Add messages (filtering out system messages if requested)
    messages.forEach((message) => {
      // Skip system messages if hideSystemMessages is true
      if (hideSystemMessages && message.content.trim().startsWith('[System]')) {
        return
      }

      items.push({
        type: 'message',
        timestamp: message.timestamp,
        index: message.index,
        data: message,
      })
    })

    // Add tool calls
    toolCalls.forEach((toolCall) => {
      items.push({
        type: 'tool_call',
        timestamp: toolCall.startTime,
        index: toolCall.index,
        data: toolCall,
      })
    })

    // Sort by timestamp, using index as secondary key for stable ordering
    return items.sort((a, b) => {
      const timeDiff = a.timestamp - b.timestamp
      if (timeDiff !== 0) return timeDiff
      // When timestamps are equal, use index for stable ordering
      // Items without index come after those with index
      if (a.index !== undefined && b.index !== undefined) {
        return a.index - b.index
      }
      return 0
    })
  }, [messages, toolCalls, hideSystemMessages])

  if (trajectory.length === 0) {
    return null
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {trajectory.map((item) => {
        if (item.type === 'message') {
          const message = item.data
          return (
            <div key={`msg-${message.messageId}`} className="flex items-start gap-3">
              {/* Icon */}
              <div className="mt-1 flex-shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {message.role}
                  </Badge>
                  {!message.complete && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  {renderMarkdown ? (
                    <ReactMarkdown
                      className="prose prose-sm dark:prose-invert max-w-none"
                      rehypePlugins={[rehypeHighlight]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        code: ({ inline, children, ...props }: any) =>
                          inline ? (
                            <code className="rounded bg-background px-1 py-0.5 text-xs" {...props}>
                              {children}
                            </code>
                          ) : (
                            <pre className="overflow-x-auto rounded bg-background p-2">
                              <code {...props}>{children}</code>
                            </pre>
                          ),
                        ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
                        ol: ({ children }) => (
                          <ol className="mb-2 list-decimal pl-4">{children}</ol>
                        ),
                        li: ({ children }) => <li className="mb-1">{children}</li>,
                        a: ({ children, href }) => (
                          <a
                            href={href}
                            className="text-primary hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  )}
                </div>
              </div>
            </div>
          )
        } else {
          // Tool call
          const toolCall = item.data
          return (
            <div key={`tool-${toolCall.toolCallId}`} className="flex items-start gap-3">
              {/* Icon */}
              <div className="mt-1 flex-shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10">
                  <Wrench className="h-4 w-4 text-blue-500" />
                </div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="rounded-lg border bg-card p-3 text-sm">
                  {/* Header */}
                  <div className="mb-2 flex items-center justify-between">
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
                    {toolCall.endTime && (
                      <span className="text-xs text-muted-foreground">
                        {((toolCall.endTime - toolCall.startTime) / 1000).toFixed(2)}s
                      </span>
                    )}
                  </div>

                  {/* Arguments */}
                  {toolCall.args && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Arguments
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-xs">
                        {toolCall.args}
                      </pre>
                    </details>
                  )}

                  {/* Result */}
                  {toolCall.result && (
                    <details className="mt-2" open={toolCall.status === 'completed'}>
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Result
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-x-auto rounded bg-muted/50 p-2 text-xs">
                        {toolCall.result}
                      </pre>
                    </details>
                  )}

                  {/* Error */}
                  {toolCall.error && (
                    <div className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                      {toolCall.error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        }
      })}
    </div>
  )
}
