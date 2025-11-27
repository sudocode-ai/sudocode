/**
 * ClaudeCodeTrajectory Component
 *
 * Specialized rendering for Claude Code agent executions.
 * Mimics the Claude Code terminal interface with inline, compact rendering.
 *
 * Key differences from generic AgentTrajectory:
 * - Terminal-style inline rendering with colored dots (⏺ and ⎿)
 * - Compact tool call display with truncation and expand/collapse
 * - No card structure - everything flows inline like terminal output
 * - User messages have lighter background, assistant messages have dots
 */

import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { MessageBuffer } from '@/hooks/useAgUiStream'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'
import { TodoTracker } from './TodoTracker'
import { buildTodoHistory } from '@/utils/todoExtractor'
import { DiffViewer } from './DiffViewer'
import { parseClaudeToolArgs } from '@/utils/claude'

const MAX_CHARS_BEFORE_TRUNCATION = 500

export interface ClaudeCodeTrajectoryProps {
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
   * Whether to show the TodoTracker (default: false)
   */
  showTodoTracker?: boolean

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
 * Format tool arguments for compact display
 */
function formatToolArgs(toolName: string, args: string): string {
  try {
    const parsed = JSON.parse(args)

    // For Bash, show the command
    if (toolName === 'Bash' && parsed.command) {
      return parsed.command
    }

    // For Read, show the file path
    if (toolName === 'Read' && parsed.file_path) {
      return parsed.file_path
    }

    // For Write, show file path
    if (toolName === 'Write' && parsed.file_path) {
      return parsed.file_path
    }

    // For Edit, show file path
    if (toolName === 'Edit' && parsed.file_path) {
      return parsed.file_path
    }

    // For Glob, show pattern and optional path
    if (toolName === 'Glob') {
      const parts: string[] = []
      if (parsed.pattern) parts.push(`pattern: "${parsed.pattern}"`)
      if (parsed.path) parts.push(`path: "${parsed.path}"`)
      return parts.join(', ')
    }

    // For Search/Grep, show pattern and path
    if ((toolName === 'Search' || toolName === 'Grep') && parsed.pattern) {
      const parts: string[] = []
      parts.push(`pattern: "${parsed.pattern}"`)
      if (parsed.path) parts.push(`path: "${parsed.path}"`)
      if (parsed.output_mode) parts.push(`output_mode: "${parsed.output_mode}"`)
      return parts.join(', ')
    }

    // For WebSearch, show query
    if (toolName === 'WebSearch' && parsed.query) {
      return `query: "${parsed.query}"`
    }

    // For TodoWrite, show summary of todos
    if (toolName === 'TodoWrite' && parsed.todos && Array.isArray(parsed.todos)) {
      const count = parsed.todos.length
      const statuses = parsed.todos.reduce((acc: any, todo: any) => {
        acc[todo.status] = (acc[todo.status] || 0) + 1
        return acc
      }, {})
      const parts: string[] = [`${count} todo${count !== 1 ? 's' : ''}`]
      if (statuses.in_progress) parts.push(`${statuses.in_progress} in progress`)
      if (statuses.completed) parts.push(`${statuses.completed} completed`)
      return parts.join(', ')
    }

    // For TodoRead, show that it's reading the list
    if (toolName === 'TodoRead') {
      return 'reading todo list'
    }

    // For other tools, show first key-value pair
    const keys = Object.keys(parsed)
    if (keys.length > 0) {
      const firstKey = keys[0]
      const value = parsed[firstKey]
      if (typeof value === 'string') {
        return value.length > 60 ? value.slice(0, 60) + '...' : value
      }
    }

    return JSON.stringify(parsed)
  } catch {
    return args.length > 60 ? args.slice(0, 60) + '...' : args
  }
}

/**
 * Format tool result summary for collapsed view
 * Provides context-aware summaries for different tool types
 */
function formatResultSummary(
  toolName: string,
  result: string,
  maxChars: number = 250
): string | null {
  try {
    // For Bash, extract key info from output
    if (toolName === 'Bash') {
      const lines = result.split('\n').filter((line) => line.trim())
      if (lines.length === 0) return 'No output'

      // For short results (1-2 lines, under 100 chars), don't show summary - let truncation handle it
      if (lines.length <= 2 && result.length < maxChars) {
        return null
      }
      if (result.length > maxChars) {
        return `${result.slice(0, maxChars)}...`
      }
      return `${lines.length} line${lines.length !== 1 ? 's' : ''}`
    }

    // For Read, show line count if available
    if (toolName === 'Read') {
      const lines = result.split('\n')
      return `Read ${lines.length} lines`
    }

    // For Write, show success message
    if (toolName === 'Write') {
      // Typically Write returns success confirmation or file path
      if (result.includes('success') || result.includes('written') || result.includes('created')) {
        return 'File written successfully'
      }
      return 'File created'
    }

    // For Edit, show success message
    if (toolName === 'Edit') {
      // Typically Edit returns success confirmation
      if (result.includes('success') || result.includes('updated') || result.includes('modified')) {
        return 'File edited successfully'
      }
      return 'File updated'
    }

    // For Glob, show file count
    if (toolName === 'Glob') {
      const lines = result.split('\n').filter((line) => line.trim())
      return `Found ${lines.length} file${lines.length !== 1 ? 's' : ''}`
    }

    // For Search/Grep, show match count
    if (toolName === 'Search' || toolName === 'Grep') {
      const lines = result.split('\n').filter((line) => line.trim())
      return `Found ${lines.length} match${lines.length !== 1 ? 'es' : ''}`
    }

    // For WebSearch, show result count
    if (toolName === 'WebSearch') {
      // Try to extract number of results if mentioned
      const resultMatch = result.match(/(\d+)\s+result/i)
      if (resultMatch) {
        return `Found ${resultMatch[1]} results`
      }
      return `Search completed`
    }

    // For TodoWrite, show confirmation
    if (toolName === 'TodoWrite') {
      // Parse the result to see how many todos were written
      try {
        const parsed = JSON.parse(result)
        if (parsed.todos && Array.isArray(parsed.todos)) {
          return `Updated ${parsed.todos.length} todo${parsed.todos.length !== 1 ? 's' : ''}`
        }
      } catch {
        // Fallback to generic message
      }
      return 'Todo list updated'
    }

    // For TodoRead, show todo count
    if (toolName === 'TodoRead') {
      // Parse the result to count todos
      try {
        const parsed = JSON.parse(result)
        if (parsed.todos && Array.isArray(parsed.todos)) {
          const pending = parsed.todos.filter((t: any) => t.status === 'pending').length
          const inProgress = parsed.todos.filter((t: any) => t.status === 'in_progress').length
          const completed = parsed.todos.filter((t: any) => t.status === 'completed').length
          const parts: string[] = []
          if (pending) parts.push(`${pending} pending`)
          if (inProgress) parts.push(`${inProgress} in progress`)
          if (completed) parts.push(`${completed} completed`)
          return parts.length > 0 ? parts.join(', ') : `${parsed.todos.length} todos`
        }
      } catch {
        // Fallback to line count
      }
      const lines = result.split('\n').filter((line) => line.trim())
      return `${lines.length} todos`
    }

    return null
  } catch {
    return null
  }
}

/**
 * Truncate text with line count and character limit
 * Handles both multi-line text and long single-line text (like compact JSON)
 * Enforces BOTH line limit AND character limit strictly
 */
function truncateText(
  text: string,
  maxLines: number = 2,
  maxChars: number = MAX_CHARS_BEFORE_TRUNCATION
): { truncated: string; hasMore: boolean; lineCount: number; charCount: number } {
  const lines = text.split('\n')
  const lineCount = lines.length
  let truncated = text
  let hasMore = false

  // Check if we exceed EITHER limit
  const exceedsLineLimit = lineCount > maxLines
  const exceedsCharLimit = text.length > maxChars

  // If we exceed line limit, take only first maxLines
  if (exceedsLineLimit) {
    truncated = lines.slice(0, maxLines).join('\n')
    hasMore = true
  }

  // ALWAYS check character limit after line truncation
  // This ensures we never exceed maxChars regardless of line count
  if (truncated.length > maxChars) {
    // Truncate to maxChars, trying to break at a good spot
    let charTruncated = truncated.slice(0, maxChars)
    const lastNewline = charTruncated.lastIndexOf('\n')
    const lastSpace = charTruncated.lastIndexOf(' ')

    // Try to break at newline or space if close enough
    if (lastNewline > maxChars * 0.7) {
      charTruncated = charTruncated.slice(0, lastNewline)
    } else if (lastSpace > maxChars * 0.7) {
      charTruncated = charTruncated.slice(0, lastSpace)
    }

    truncated = charTruncated + '...'
    hasMore = true
  }

  // Set hasMore if we exceeded EITHER limit
  if (!hasMore && (exceedsLineLimit || exceedsCharLimit)) {
    hasMore = true
  }

  return {
    truncated,
    hasMore,
    lineCount,
    charCount: text.length,
  }
}

/**
 * ClaudeCodeTrajectory Component
 *
 * Provides Claude Code-specific rendering of execution trajectory,
 * with enhanced visualization for Claude's communication patterns.
 *
 * @example
 * ```tsx
 * <ClaudeCodeTrajectory
 *   messages={messages}
 *   toolCalls={toolCalls}
 *   renderMarkdown
 * />
 * ```
 */
export function ClaudeCodeTrajectory({
  messages,
  toolCalls,
  renderMarkdown = true,
  hideSystemMessages = true,
  showTodoTracker = true,
  className = '',
}: ClaudeCodeTrajectoryProps) {
  // Extract todos from tool calls for TodoTracker
  const todos = useMemo(() => buildTodoHistory(toolCalls), [toolCalls])

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
    <div className={`space-y-1 font-mono text-sm ${className}`}>
      {trajectory.map((item) => {
        if (item.type === 'message') {
          const message = item.data

          return (
            <div key={`msg-${message.messageId}`} className="group">
              {/* Message with dot indicator */}
              <div className="flex items-start gap-2">
                {/* Dot indicator for assistant messages */}
                <span className="mt-0.5 select-none text-foreground">⏺</span>

                {/* Message content */}
                <div className="min-w-0 flex-1 py-0.5">
                  {!message.complete && (
                    <Loader2 className="mb-1 inline h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                  {renderMarkdown ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      className="max-w-none text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      components={{
                        p: ({ children }) => <>{children}</>,
                        code: ({ inline, children, ...props }: any) => {
                          // Check if this should be treated as inline code
                          // ReactMarkdown sometimes mis-detects inline code as blocks
                          let codeText = ''
                          if (typeof children === 'string') {
                            codeText = children
                          } else if (Array.isArray(children)) {
                            codeText = children
                              .map((c) => (typeof c === 'string' ? c : ''))
                              .join('')
                          } else {
                            codeText = String(children)
                          }
                          // TODO: Update the parsing for this instead of having to split code blocks like this.
                          const isShortInline =
                            codeText.length < 100 &&
                            !codeText.includes('\n') &&
                            !codeText.includes('```')

                          if (inline || isShortInline) {
                            return (
                              <code
                                className="!inline rounded bg-muted px-1 py-0.5 font-mono text-xs"
                                style={{
                                  display: 'inline',
                                  whiteSpace: 'nowrap',
                                  width: 'auto',
                                  maxWidth: 'none',
                                }}
                                {...props}
                              >
                                {children}
                              </code>
                            )
                          }
                          return (
                            <pre className="m-0 my-1 block overflow-x-auto rounded border text-xs">
                              <code {...props}>{children}</code>
                            </pre>
                          )
                        },
                        ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
                        ol: ({ children }) => (
                          <ol className="my-1 list-decimal pl-5">{children}</ol>
                        ),
                        li: ({ children }) => <li className="mb-0.5">{children}</li>,
                        a: ({ children, href }) => (
                          <a
                            href={href}
                            className="text-primary underline-offset-2 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {children}
                          </a>
                        ),
                        h1: ({ children }) => (
                          <h1 className="mb-1 mt-2 text-base font-bold">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="mb-1 mt-1 text-sm font-semibold">{children}</h3>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <div className="whitespace-pre-wrap text-xs leading-relaxed">
                      {message.content}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        } else {
          // Tool call - terminal-style inline rendering
          return <ToolCallItem key={`tool-${item.data.toolCallId}`} toolCall={item.data} />
        }
      })}

      {/* Todo Tracker - show at bottom if enabled */}
      {showTodoTracker && todos.length > 0 && (
        <div className="mt-4">
          <TodoTracker todos={todos} />
        </div>
      )}
    </div>
  )
}

/**
 * ToolCallItem - Terminal-style tool call rendering
 */
function ToolCallItem({ toolCall }: { toolCall: ToolCallTracking }) {
  const [showFullArgs, setShowFullArgs] = useState(false)
  const [showFullResult, setShowFullResult] = useState(false)
  const formattedArgs = formatToolArgs(toolCall.toolCallName, toolCall.args)

  const argsData = toolCall.args ? truncateText(toolCall.args, 2) : null
  const resultData = toolCall.result ? truncateText(toolCall.result, 2) : null

  const isSuccess = toolCall.status === 'completed'
  const isError = toolCall.status === 'error'

  return (
    <div className="group">
      {/* Tool call header with colored dot */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 select-none ${isSuccess ? 'text-green-600' : isError ? 'text-red-600' : 'text-yellow-600'}`}
        >
          ⏺
        </span>
        <div className="min-w-0 flex-1">
          {/* Tool name and args inline */}
          <div className="flex items-start gap-2">
            <span className="font-semibold">{toolCall.toolCallName}</span>
            <span className="text-muted-foreground">({formattedArgs})</span>
            {toolCall.endTime && (
              <span className="ml-auto text-xs text-muted-foreground">
                {((toolCall.endTime - toolCall.startTime) / 1000).toFixed(2)}s
              </span>
            )}
          </div>

          {/* Full args - expandable (shown first, before results) */}
          {/* Hide args for Edit/Write tools - the diff viewer shows this info */}
          {argsData && toolCall.toolCallName !== 'Edit' && (
            <div className="mt-0.5 flex items-start gap-2">
              <span className="select-none text-muted-foreground">∟</span>
              <div className="min-w-0 flex-1">
                {/* Preview of first 2 lines */}
                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {showFullArgs ? toolCall.args : argsData.truncated}
                </pre>
                {/* Expand/collapse button */}
                {argsData.hasMore && (
                  <button
                    onClick={() => setShowFullArgs(!showFullArgs)}
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showFullArgs ? (
                      <>
                        {'> Hide ('}
                        {argsData.lineCount > 2
                          ? `${argsData.lineCount} lines`
                          : `${argsData.charCount} chars`}
                        {')'}
                      </>
                    ) : argsData.lineCount > 2 ? (
                      <>{'> +' + (argsData.lineCount - 2) + ' more lines'}</>
                    ) : (
                      <>
                        {'> +' + (argsData.charCount - MAX_CHARS_BEFORE_TRUNCATION) + ' more chars'}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Diff viewer for Edit and Write tools - show before result */}
          {toolCall.toolCallName === 'Edit' &&
            (() => {
              try {
                const { oldContent, newContent, filePath } = parseClaudeToolArgs(
                  toolCall.toolCallName,
                  toolCall.args
                )
                return (
                  <div className="mt-0.5 flex items-start gap-2">
                    <span className="select-none text-muted-foreground">∟</span>
                    <div className="min-w-0 flex-1">
                      <DiffViewer
                        oldContent={oldContent}
                        newContent={newContent}
                        filePath={filePath}
                        className="my-1"
                        maxLines={50}
                      />
                    </div>
                  </div>
                )
              } catch (error) {
                console.error('Failed to parse tool args:', error, toolCall.args)
                return (
                  <div className="mt-0.5 flex items-start gap-2">
                    <span className="select-none text-muted-foreground">∟</span>
                    <div className="min-w-0 flex-1">
                      <div className="rounded border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
                        Unable to display diff
                      </div>
                    </div>
                  </div>
                )
              }
            })()}

          {/* Tool result - show summary or first 2 lines when collapsed */}
          {(toolCall.result || toolCall.error) && (
            <div className="mt-0.5 flex items-start gap-2">
              <span className="select-none text-muted-foreground">∟</span>
              <div className="min-w-0 flex-1">
                {toolCall.error ? (
                  <div className="text-red-600">{toolCall.error}</div>
                ) : resultData ? (
                  <div className="text-muted-foreground">
                    {/* Show tool-specific summary or preview */}
                    {!showFullResult &&
                      (() => {
                        const summary = formatResultSummary(
                          toolCall.toolCallName,
                          toolCall.result || ''
                        )
                        if (summary) {
                          return <div className="text-xs leading-relaxed">{summary}</div>
                        }
                        return (
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed">
                            {resultData.truncated}
                          </pre>
                        )
                      })()}
                    {/* Full result when expanded */}
                    {showFullResult && (
                      <pre className="whitespace-pre-wrap text-xs leading-relaxed">
                        {toolCall.result}
                      </pre>
                    )}
                    {/* Expand/collapse button */}
                    {resultData.hasMore && (
                      <button
                        onClick={() => setShowFullResult(!showFullResult)}
                        className="mt-0.5 inline-flex items-center gap-1 text-xs hover:text-foreground"
                      >
                        {showFullResult ? (
                          <>
                            {'> Hide ('}
                            {resultData.lineCount > 2
                              ? `${resultData.lineCount} lines`
                              : `${resultData.charCount} chars`}
                            {')'}
                          </>
                        ) : resultData.lineCount > 2 ? (
                          <>{'> +' + (resultData.lineCount - 2) + ' more lines'}</>
                        ) : (
                          <>
                            {'> +' +
                              (resultData.charCount - MAX_CHARS_BEFORE_TRUNCATION) +
                              ' more chars'}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
