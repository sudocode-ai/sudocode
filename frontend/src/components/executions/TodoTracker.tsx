/**
 * TodoTracker Component
 *
 * Generic component for displaying todo list evolution during agent execution.
 * Receives pre-processed todo items from agent-specific components.
 *
 * Features:
 * - Shows current todos with status indicators
 * - Tracks completed todos (even if removed from active list)
 * - Displays status changes over time
 * - Compact, collapsible view
 */

import { useState, useEffect } from 'react'
import { CheckCircle2, Circle, ChevronDown, ChevronUp } from 'lucide-react'

const TODO_TRACKER_STORAGE_KEY = 'todoTracker.isCollapsed'

/**
 * Todo item with status and history tracking
 */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  firstSeen: number // Timestamp when first seen
  lastSeen: number // Timestamp when last seen
  wasCompleted: boolean // Track if ever completed (even if removed)
  wasRemoved: boolean // Track if removed from active list
}

export interface TodoTrackerProps {
  /**
   * Array of todo items to display
   */
  todos: TodoItem[]

  /**
   * Custom class name
   */
  className?: string
}

/**
 * TodoTracker Component
 *
 * Displays a persistent, compact view of the todo list.
 * Expects pre-processed todo items from agent-specific components.
 *
 * @example
 * ```tsx
 * <TodoTracker todos={todos} />
 * ```
 */
export function TodoTracker({ todos, className = '' }: TodoTrackerProps) {
  // Initialize state from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(TODO_TRACKER_STORAGE_KEY)
      return stored ? JSON.parse(stored) : false
    } catch {
      return false
    }
  })

  // Save to localStorage whenever collapse state changes
  useEffect(() => {
    try {
      localStorage.setItem(TODO_TRACKER_STORAGE_KEY, JSON.stringify(isCollapsed))
    } catch {
      // Ignore localStorage errors (e.g., in incognito mode)
    }
  }, [isCollapsed])

  const hasAnyTodos = todos.length > 0

  if (!hasAnyTodos) {
    return null
  }

  // Sort all todos by creation time and filter out removed non-completed items
  const sortedTodos = todos
    .filter((t) => !t.wasRemoved || t.wasCompleted)
    .sort((a, b) => a.firstSeen - b.firstSeen)

  // Calculate stats
  const completedCount = todos.filter((t) => t.wasCompleted).length

  // Render todo item based on status
  const renderTodoItem = (todo: TodoItem, idx: number) => {
    // Completed (even if removed)
    if (todo.wasCompleted) {
      return (
        <div key={`completed-${idx}`} className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-600" />
          <span className="flex-1 leading-relaxed text-muted-foreground line-through">
            {todo.content}
          </span>
        </div>
      )
    }

    // In Progress
    if (todo.status === 'in_progress' && !todo.wasRemoved) {
      return (
        <div key={`progress-${idx}`} className="flex items-start gap-2">
          <Circle className="mt-0.5 h-3 w-3 flex-shrink-0 text-blue-500" />
          <span className="flex-1 leading-relaxed text-foreground">{todo.content}</span>
        </div>
      )
    }

    // Pending
    if (todo.status === 'pending' && !todo.wasRemoved) {
      return (
        <div key={`pending-${idx}`} className="flex items-start gap-2">
          <Circle className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
          <span className="flex-1 leading-relaxed text-muted-foreground">{todo.content}</span>
        </div>
      )
    }

    return null
  }

  return (
    <div
      className={`rounded-md border border-border bg-muted/30 p-3 font-mono text-xs ${className}`}
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        <div className="flex flex-1 flex-row items-center gap-4 text-left">
          <span className="font-semibold uppercase tracking-wide">TODOS</span>
          <span className="">
            {completedCount}/{todos.length} completed
          </span>
        </div>
      </button>

      {!isCollapsed && (
        <>
          {/* Todo list - unified, sorted by creation time */}
          <div className="mt-4 space-y-1">
            {sortedTodos.map((todo, idx) => renderTodoItem(todo, idx))}
          </div>
        </>
      )}
    </div>
  )
}
