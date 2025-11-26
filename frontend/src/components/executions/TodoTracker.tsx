/**
 * TodoTracker Component
 *
 * Tracks and displays the todo list evolution during agent execution.
 * Monitors TodoRead and TodoWrite tool calls to maintain a historical view
 * of all todos, including completed and removed items.
 *
 * Features:
 * - Shows current todos with status indicators
 * - Tracks completed todos (even if removed from active list)
 * - Displays status changes over time
 * - Compact, pinned view at bottom of execution monitor
 */

import { useMemo } from 'react'
import { CheckCircle2, Circle, Clock } from 'lucide-react'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'

export interface TodoTrackerProps {
  /**
   * Map of tool calls to track
   */
  toolCalls: Map<string, ToolCallTracking>

  /**
   * Custom class name
   */
  className?: string
}

/**
 * Todo item with status and history tracking
 */
interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  firstSeen: number // Timestamp when first seen
  lastSeen: number // Timestamp when last seen
  wasCompleted: boolean // Track if ever completed (even if removed)
  wasRemoved: boolean // Track if removed from active list
}

/**
 * Extract todos from TodoRead or TodoWrite tool call result
 */
function extractTodos(toolCall: ToolCallTracking): TodoItem[] | null {
  if (!toolCall.result) return null

  try {
    // For TodoWrite, parse args to get todos
    if (toolCall.toolCallName === 'TodoWrite') {
      const args = JSON.parse(toolCall.args)
      if (args.todos && Array.isArray(args.todos)) {
        return args.todos.map((todo: any) => ({
          content: todo.content,
          status: todo.status,
          activeForm: todo.activeForm,
          firstSeen: toolCall.startTime,
          lastSeen: toolCall.endTime || toolCall.startTime,
          wasCompleted: todo.status === 'completed',
          wasRemoved: false,
        }))
      }
    }

    // For TodoRead, parse result to get todos
    if (toolCall.toolCallName === 'TodoRead') {
      const result = JSON.parse(toolCall.result)
      if (result.todos && Array.isArray(result.todos)) {
        return result.todos.map((todo: any) => ({
          content: todo.content,
          status: todo.status,
          activeForm: todo.activeForm,
          firstSeen: toolCall.startTime,
          lastSeen: toolCall.endTime || toolCall.startTime,
          wasCompleted: todo.status === 'completed',
          wasRemoved: false,
        }))
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * TodoTracker Component
 *
 * Displays a persistent, compact view of the todo list evolution during execution.
 * Tracks all todos seen during the execution, including completed and removed items.
 *
 * @example
 * ```tsx
 * <TodoTracker toolCalls={toolCalls} />
 * ```
 */
export function TodoTracker({ toolCalls, className = '' }: TodoTrackerProps) {
  // Build a historical view of all todos seen during execution
  const { allTodos, hasAnyTodos } = useMemo(() => {
    const todoMap = new Map<string, TodoItem>()

    // Get all TodoRead and TodoWrite tool calls, sorted by timestamp
    const todoToolCalls = Array.from(toolCalls.values())
      .filter(
        (tc) =>
          (tc.toolCallName === 'TodoRead' || tc.toolCallName === 'TodoWrite') &&
          tc.status === 'completed'
      )
      .sort((a, b) => a.startTime - b.startTime)

    // Process each tool call chronologically to build todo history
    todoToolCalls.forEach((toolCall) => {
      const todos = extractTodos(toolCall)
      if (!todos) return

      // Track which todos are present in this snapshot
      const currentTodoContents = new Set(todos.map((t) => t.content))

      // Mark previously seen todos as removed if they're not in current list
      todoMap.forEach((existingTodo) => {
        if (!currentTodoContents.has(existingTodo.content)) {
          existingTodo.wasRemoved = true
        }
      })

      // Add or update todos from current snapshot
      todos.forEach((todo) => {
        const existing = todoMap.get(todo.content)
        if (existing) {
          // Update existing todo
          existing.status = todo.status
          existing.activeForm = todo.activeForm
          existing.lastSeen = todo.lastSeen
          existing.wasCompleted = existing.wasCompleted || todo.status === 'completed'
          existing.wasRemoved = false // Un-mark as removed if it reappears
        } else {
          // Add new todo
          todoMap.set(todo.content, todo)
        }
      })
    })

    const allTodos = Array.from(todoMap.values())

    return {
      allTodos,
      hasAnyTodos: allTodos.length > 0,
    }
  }, [toolCalls])

  if (!hasAnyTodos) {
    return null
  }

  // Group todos by status
  const inProgressTodos = allTodos.filter((t) => t.status === 'in_progress' && !t.wasRemoved)
  const pendingTodos = allTodos.filter((t) => t.status === 'pending' && !t.wasRemoved)
  const completedTodos = allTodos.filter((t) => t.wasCompleted)

  return (
    <div
      className={`rounded-md border border-border bg-muted/30 p-3 font-mono text-xs ${className}`}
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Clock className="h-3 w-3" />
        Todo Progress
      </div>

      {/* Summary stats */}
      <div className="mb-2 flex gap-4 text-[10px] text-muted-foreground">
        <span>
          {completedTodos.length} / {allTodos.length} completed
        </span>
        {inProgressTodos.length > 0 && <span>{inProgressTodos.length} in progress</span>}
        {pendingTodos.length > 0 && <span>{pendingTodos.length} pending</span>}
      </div>

      {/* Todo list */}
      <div className="space-y-1">
        {/* In Progress */}
        {inProgressTodos.map((todo, idx) => (
          <div key={`progress-${idx}`} className="flex items-start gap-2">
            <Circle className="mt-0.5 h-3 w-3 flex-shrink-0 text-blue-500" />
            <span className="flex-1 leading-relaxed text-foreground">{todo.content}</span>
          </div>
        ))}

        {/* Pending */}
        {pendingTodos.map((todo, idx) => (
          <div key={`pending-${idx}`} className="flex items-start gap-2">
            <Circle className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
            <span className="flex-1 leading-relaxed text-muted-foreground">{todo.content}</span>
          </div>
        ))}

        {/* Completed (show last 5) */}
        {completedTodos.slice(-5).map((todo, idx) => (
          <div key={`completed-${idx}`} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-600" />
            <span className="flex-1 leading-relaxed text-muted-foreground line-through">
              {todo.content}
            </span>
          </div>
        ))}

        {completedTodos.length > 5 && (
          <div className="pl-5 text-[10px] text-muted-foreground">
            +{completedTodos.length - 5} more completed
          </div>
        )}
      </div>
    </div>
  )
}
