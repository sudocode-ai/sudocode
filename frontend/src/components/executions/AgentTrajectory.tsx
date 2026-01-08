/**
 * AgentTrajectory Component
 *
 * Unified trajectory visualization for all AI agent executions.
 * Uses terminal-style inline rendering with colored dots for a compact,
 * Claude Code-like experience.
 *
 * Consumes SessionUpdate events via useSessionUpdateStream hook (ACP-native types).
 */

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { JsonView, defaultStyles, darkStyles } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'
import type { AgentMessage, ToolCall, AgentThought } from '@/hooks/useSessionUpdateStream'
import { TodoTracker } from './TodoTracker'
import { buildTodoHistoryFromToolCalls } from '@/utils/todoExtractor'
import { DiffViewer } from './DiffViewer'
import { parseClaudeToolArgs } from '@/utils/claude'
import { useTheme } from '@/contexts/ThemeContext'

const MAX_CHARS_BEFORE_TRUNCATION = 500

export interface AgentTrajectoryProps {
  /**
   * Array of agent messages to display
   */
  messages: AgentMessage[]

  /**
   * Array of tool calls to display
   */
  toolCalls: ToolCall[]

  /**
   * Array of agent thoughts to display (thinking blocks)
   */
  thoughts?: AgentThought[]

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
   * Whether to show the TodoTracker (default: true)
   */
  showTodoTracker?: boolean

  /**
   * Custom class name
   */
  className?: string
}

/**
 * Trajectory item representing a message, thought, or tool call
 */
type TrajectoryItem =
  | {
      type: 'message'
      timestamp: number
      index?: number
      data: AgentMessage
    }
  | {
      type: 'thought'
      timestamp: number
      index?: number
      data: AgentThought
    }
  | {
      type: 'tool_call'
      timestamp: number
      index?: number
      data: ToolCall
    }

/**
 * Format tool arguments for compact display
 */
function formatToolArgs(toolName: string, rawInput: unknown): string {
  try {
    const parsed = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput
    if (!parsed || typeof parsed !== 'object') {
      return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput)
    }

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
      const statuses = parsed.todos.reduce((acc: Record<string, number>, todo: { status?: string }) => {
        if (todo.status) {
          acc[todo.status] = (acc[todo.status] || 0) + 1
        }
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
    const str = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput)
    return str.length > 60 ? str.slice(0, 60) + '...' : str
  }
}

/**
 * Format tool result summary for collapsed view
 */
function formatResultSummary(toolName: string, result: string, maxChars: number = 250): string | null {
  try {
    if (toolName === 'Bash') {
      const lines = result.split('\n').filter((line) => line.trim())
      if (lines.length === 0) return 'No output'
      if (lines.length <= 2 && result.length < maxChars) return null
      if (result.length > maxChars) return `${result.slice(0, maxChars)}...`
      return `${lines.length} line${lines.length !== 1 ? 's' : ''}`
    }

    if (toolName === 'Read') {
      const lines = result.split('\n')
      return `Read ${lines.length} lines`
    }

    if (toolName === 'Write') {
      if (result.includes('success') || result.includes('written') || result.includes('created')) {
        return 'File written successfully'
      }
      return 'File created'
    }

    if (toolName === 'Edit') {
      if (result.includes('success') || result.includes('updated') || result.includes('modified')) {
        return 'File edited successfully'
      }
      return 'File updated'
    }

    if (toolName === 'Glob') {
      const lines = result.split('\n').filter((line) => line.trim())
      return `Found ${lines.length} file${lines.length !== 1 ? 's' : ''}`
    }

    if (toolName === 'Search' || toolName === 'Grep') {
      const lines = result.split('\n').filter((line) => line.trim())
      return `Found ${lines.length} match${lines.length !== 1 ? 'es' : ''}`
    }

    if (toolName === 'WebSearch') {
      const resultMatch = result.match(/(\d+)\s+result/i)
      if (resultMatch) return `Found ${resultMatch[1]} results`
      return 'Search completed'
    }

    if (toolName === 'TodoWrite') {
      try {
        const parsed = JSON.parse(result)
        if (parsed.todos && Array.isArray(parsed.todos)) {
          return `Updated ${parsed.todos.length} todo${parsed.todos.length !== 1 ? 's' : ''}`
        }
      } catch {
        // Fallback
      }
      return 'Todo list updated'
    }

    if (toolName === 'TodoRead') {
      try {
        const parsed = JSON.parse(result)
        if (parsed.todos && Array.isArray(parsed.todos)) {
          const pending = parsed.todos.filter((t: { status?: string }) => t.status === 'pending').length
          const inProgress = parsed.todos.filter((t: { status?: string }) => t.status === 'in_progress').length
          const completed = parsed.todos.filter((t: { status?: string }) => t.status === 'completed').length
          const parts: string[] = []
          if (pending) parts.push(`${pending} pending`)
          if (inProgress) parts.push(`${inProgress} in progress`)
          if (completed) parts.push(`${completed} completed`)
          return parts.length > 0 ? parts.join(', ') : `${parsed.todos.length} todos`
        }
      } catch {
        // Fallback
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
 * Check if a string is valid JSON
 */
function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Truncate text with line count and character limit
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

  const exceedsLineLimit = lineCount > maxLines
  const exceedsCharLimit = text.length > maxChars

  if (exceedsLineLimit) {
    truncated = lines.slice(0, maxLines).join('\n')
    hasMore = true
  }

  if (truncated.length > maxChars) {
    let charTruncated = truncated.slice(0, maxChars)
    const lastNewline = charTruncated.lastIndexOf('\n')
    const lastSpace = charTruncated.lastIndexOf(' ')

    if (lastNewline > maxChars * 0.7) {
      charTruncated = charTruncated.slice(0, lastNewline)
    } else if (lastSpace > maxChars * 0.7) {
      charTruncated = charTruncated.slice(0, lastSpace)
    }

    truncated = charTruncated + '...'
    hasMore = true
  }

  if (!hasMore && (exceedsLineLimit || exceedsCharLimit)) {
    hasMore = true
  }

  return { truncated, hasMore, lineCount, charCount: text.length }
}

/**
 * Convert unknown value to string for display
 */
function valueToString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * AgentTrajectory Component
 *
 * Unified terminal-style rendering for all agent executions.
 *
 * @example
 * ```tsx
 * const { messages, toolCalls, thoughts } = useSessionUpdateStream(executionId)
 *
 * <AgentTrajectory
 *   messages={messages}
 *   toolCalls={toolCalls}
 *   thoughts={thoughts}
 * />
 * ```
 */
export function AgentTrajectory({
  messages,
  toolCalls,
  thoughts = [],
  renderMarkdown = true,
  hideSystemMessages = true,
  showTodoTracker = true,
  className = '',
}: AgentTrajectoryProps) {
  // Extract todos from tool calls for TodoTracker
  const todos = useMemo(() => buildTodoHistoryFromToolCalls(toolCalls), [toolCalls])

  // Merge messages, thoughts, and tool calls into a chronological timeline
  const trajectory = useMemo(() => {
    const items: TrajectoryItem[] = []

    // Add messages (filtering out system messages if requested)
    messages.forEach((message) => {
      if (hideSystemMessages && message.content.trim().startsWith('[System]')) {
        return
      }
      items.push({
        type: 'message',
        timestamp: message.timestamp.getTime(),
        index: message.index,
        data: message,
      })
    })

    // Add thoughts
    thoughts.forEach((thought) => {
      items.push({
        type: 'thought',
        timestamp: thought.timestamp.getTime(),
        index: thought.index,
        data: thought,
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

    // Sort by timestamp, using index as secondary key for stable ordering
    return items.sort((a, b) => {
      const timeDiff = a.timestamp - b.timestamp
      if (timeDiff !== 0) return timeDiff
      if (a.index !== undefined && b.index !== undefined) {
        return a.index - b.index
      }
      return 0
    })
  }, [messages, toolCalls, thoughts, hideSystemMessages])

  if (trajectory.length === 0) {
    return null
  }

  return (
    <div className={`space-y-1 font-mono text-sm ${className}`}>
      {trajectory.map((item, idx) => {
        if (item.type === 'message') {
          return <MessageItem key={`msg-${item.data.id}-${idx}`} message={item.data} renderMarkdown={renderMarkdown} />
        } else if (item.type === 'thought') {
          return <ThoughtItem key={`thought-${item.data.id}-${idx}`} thought={item.data} />
        } else {
          return <ToolCallItem key={`tool-${item.data.id}-${idx}`} toolCall={item.data} />
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
 * MessageItem - Terminal-style message rendering
 */
function MessageItem({ message, renderMarkdown }: { message: AgentMessage; renderMarkdown: boolean }) {
  return (
    <div className="group">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 select-none text-foreground ${message.isStreaming ? 'animate-pulse' : ''}`}>⏺</span>
        <div className="min-w-0 flex-1 py-0.5">
          {renderMarkdown ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              className="max-w-none font-light text-foreground/80 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              components={{
                p: ({ children }) => <>{children}</>,
                code: ({ inline, children, ...props }: any) => {
                  let codeText = ''
                  if (typeof children === 'string') {
                    codeText = children
                  } else if (Array.isArray(children)) {
                    codeText = children.map((c) => (typeof c === 'string' ? c : '')).join('')
                  } else {
                    codeText = String(children)
                  }
                  const isShortInline =
                    codeText.length < 100 && !codeText.includes('\n') && !codeText.includes('```')

                  if (inline || isShortInline) {
                    return (
                      <code
                        className="!inline rounded bg-muted px-1 py-0.5 font-mono text-xs"
                        style={{ display: 'inline', whiteSpace: 'nowrap', width: 'auto', maxWidth: 'none' }}
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
                ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
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
                h1: ({ children }) => <h1 className="mb-1 mt-2 text-base font-bold">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-1 mt-1 text-sm font-semibold">{children}</h3>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : (
            <div className="whitespace-pre-wrap text-xs leading-relaxed">{message.content}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * ThoughtItem - Terminal-style thinking/reasoning rendering
 */
function ThoughtItem({ thought }: { thought: AgentThought }) {
  return (
    <div className="group">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 select-none text-purple-500 ${thought.isStreaming ? 'animate-pulse' : ''}`}>⏺</span>
        <div className="min-w-0 flex-1 py-0.5">
          <div className="whitespace-pre-wrap text-xs italic leading-relaxed text-muted-foreground">
            {thought.content}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * ToolCallItem - Terminal-style tool call rendering
 */
function ToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const { actualTheme } = useTheme()
  const [showFullArgs, setShowFullArgs] = useState(false)
  const [showFullResult, setShowFullResult] = useState(false)

  const toolName = toolCall.title
  const formattedArgs = formatToolArgs(toolName, toolCall.rawInput)
  const argsString = valueToString(toolCall.rawInput)
  const resultString = valueToString(toolCall.result ?? toolCall.rawOutput)

  const argsData = argsString ? truncateText(argsString, 2) : null
  const resultData = resultString ? truncateText(resultString, 2) : null

  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'failed'
  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'

  const duration =
    toolCall.completedAt && toolCall.timestamp
      ? ((toolCall.completedAt.getTime() - toolCall.timestamp.getTime()) / 1000).toFixed(2)
      : null

  return (
    <div className="group">
      {/* Tool call header with colored dot */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 select-none ${isSuccess ? 'text-green-600' : isError ? 'text-red-600' : 'text-yellow-600'} ${isRunning ? 'animate-pulse' : ''}`}
        >
          ⏺
        </span>
        <div className="min-w-0 flex-1">
          {/* Tool name and args inline */}
          <div className="flex items-start gap-2">
            <span className="font-semibold">{toolName}</span>
            <span className="text-muted-foreground">({formattedArgs})</span>
            {duration && <span className="ml-auto text-xs text-muted-foreground">{duration}s</span>}
          </div>

          {/* Full args - expandable (hide for Edit/Write - diff viewer shows this) */}
          {argsData && toolName !== 'Edit' && (
            <div className="mt-0.5 flex items-start gap-2">
              <span className="select-none text-muted-foreground">∟</span>
              <div className="min-w-0 flex-1">
                {!showFullArgs ? (
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {argsData.truncated}
                  </pre>
                ) : isValidJSON(argsString) ? (
                  <div className="json-viewer-wrapper my-1 rounded border border-border bg-background/50 p-2 text-xs">
                    <JsonView
                      data={JSON.parse(argsString)}
                      clickToExpandNode={true}
                      style={actualTheme === 'dark' ? darkStyles : defaultStyles}
                    />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {argsString}
                  </pre>
                )}
                {argsData.hasMore && (
                  <button
                    onClick={() => setShowFullArgs(!showFullArgs)}
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showFullArgs ? (
                      <>
                        {'> Hide ('}
                        {argsData.lineCount > 2 ? `${argsData.lineCount} lines` : `${argsData.charCount} chars`}
                        {')'}
                      </>
                    ) : argsData.lineCount > 2 ? (
                      <>{'> +' + (argsData.lineCount - 2) + ' more lines'}</>
                    ) : (
                      <>{'> +' + (argsData.charCount - MAX_CHARS_BEFORE_TRUNCATION) + ' more chars'}</>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Diff viewer for Edit tools */}
          {toolName === 'Edit' &&
            (() => {
              try {
                const { oldContent, newContent, filePath } = parseClaudeToolArgs(toolName, argsString)
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
              } catch {
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

          {/* Tool result */}
          {resultString && (
            <div className="mt-0.5 flex items-start gap-2">
              <span className="select-none text-muted-foreground">∟</span>
              <div className="min-w-0 flex-1">
                {isError ? (
                  <div className="text-red-600">{resultString}</div>
                ) : resultData ? (
                  <div className="text-muted-foreground">
                    {!showFullResult &&
                      (() => {
                        const summary = formatResultSummary(toolName, resultString)
                        if (summary) {
                          return <div className="text-xs leading-relaxed">{summary}</div>
                        }
                        return (
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed">{resultData.truncated}</pre>
                        )
                      })()}
                    {showFullResult &&
                      (() => {
                        const hasSpecialRendering = toolName === 'Edit' || toolName === 'Write'
                        const isJSON = !hasSpecialRendering && isValidJSON(resultString)

                        if (isJSON) {
                          try {
                            const jsonData = JSON.parse(resultString)
                            return (
                              <div className="json-viewer-wrapper my-1 rounded border border-border bg-background/50 p-2 text-xs">
                                <JsonView
                                  data={jsonData}
                                  clickToExpandNode={true}
                                  style={actualTheme === 'dark' ? darkStyles : defaultStyles}
                                />
                              </div>
                            )
                          } catch {
                            return (
                              <pre className="whitespace-pre-wrap text-xs leading-relaxed">{resultString}</pre>
                            )
                          }
                        }
                        return <pre className="whitespace-pre-wrap text-xs leading-relaxed">{resultString}</pre>
                      })()}
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
                          <>{'> +' + (resultData.charCount - MAX_CHARS_BEFORE_TRUNCATION) + ' more chars'}</>
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
