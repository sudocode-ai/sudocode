/**
 * Todo Extraction Utilities
 *
 * Provides utilities for extracting todo items from different agent tool call formats.
 * Agent-specific components can use these utilities to process tool calls and
 * convert them into the generic TodoItem format expected by TodoTracker.
 */

import type { ToolCallTracking } from '@/types/stream'
import type { ToolCall } from '@/hooks/useSessionUpdateStream'
import type { TodoItem } from '@/components/executions/TodoTracker'

/**
 * Extract todos from Claude Code TodoRead or TodoWrite tool call
 * Handles the specific format used by Claude Code's todo tool calls
 */
export function extractClaudeCodeTodos(toolCall: ToolCallTracking): TodoItem[] | null {
  if (!toolCall.result) {
    return null
  }

  try {
    // For TodoWrite, parse args to get todos
    if (toolCall.toolCallName === 'TodoWrite') {
      const parsed = JSON.parse(toolCall.args)

      // Handle nested structure: {toolName: 'TodoWrite', args: {todos: [...]}}
      const args = parsed.args || parsed

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
      const parsed = JSON.parse(toolCall.result)

      // Result might be nested or direct
      const result = parsed.result || parsed

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
 * Build a historical view of todos from tool calls
 * Tracks todo state changes over time, including completions and removals
 *
 * @param toolCalls - Map of tool calls to process
 * @param extractFn - Function to extract todos from a tool call (agent-specific)
 * @returns Array of TodoItem with complete history
 */
export function buildTodoHistory(
  toolCalls: Map<string, ToolCallTracking>,
  extractFn: (toolCall: ToolCallTracking) => TodoItem[] | null = extractClaudeCodeTodos
): TodoItem[] {
  const todoMap = new Map<string, TodoItem>()

  // Get all todo-related tool calls, sorted by timestamp
  const todoToolCalls = Array.from(toolCalls.values())
    .filter(
      (tc) =>
        (tc.toolCallName === 'TodoRead' || tc.toolCallName === 'TodoWrite') &&
        tc.status === 'completed'
    )
    .sort((a, b) => a.startTime - b.startTime)

  // Process each tool call chronologically to build todo history
  todoToolCalls.forEach((toolCall) => {
    const todos = extractFn(toolCall)
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

  return Array.from(todoMap.values())
}

/**
 * Convert unknown value to string
 */
function valueToString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Extract todos from a ToolCall (ACP format)
 */
function extractTodosFromToolCall(toolCall: ToolCall): TodoItem[] | null {
  const argsString = valueToString(toolCall.rawInput)
  const resultString = valueToString(toolCall.result ?? toolCall.rawOutput)

  try {
    // For TodoWrite, parse args to get todos
    if (toolCall.title === 'TodoWrite') {
      const parsed = JSON.parse(argsString)
      const args = parsed.args || parsed

      if (args.todos && Array.isArray(args.todos)) {
        return args.todos.map((todo: { content?: string; status?: string; activeForm?: string }) => ({
          content: todo.content || '',
          status: todo.status || 'pending',
          activeForm: todo.activeForm,
          firstSeen: toolCall.timestamp.getTime(),
          lastSeen: toolCall.completedAt?.getTime() || toolCall.timestamp.getTime(),
          wasCompleted: todo.status === 'completed',
          wasRemoved: false,
        }))
      }
    }

    // For TodoRead, parse result to get todos
    if (toolCall.title === 'TodoRead' && resultString) {
      const parsed = JSON.parse(resultString)
      const result = parsed.result || parsed

      if (result.todos && Array.isArray(result.todos)) {
        return result.todos.map((todo: { content?: string; status?: string; activeForm?: string }) => ({
          content: todo.content || '',
          status: todo.status || 'pending',
          activeForm: todo.activeForm,
          firstSeen: toolCall.timestamp.getTime(),
          lastSeen: toolCall.completedAt?.getTime() || toolCall.timestamp.getTime(),
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
 * Build a historical view of todos from ToolCall array (ACP format)
 * Tracks todo state changes over time, including completions and removals
 *
 * @param toolCalls - Array of tool calls to process
 * @returns Array of TodoItem with complete history
 */
export function buildTodoHistoryFromToolCalls(toolCalls: ToolCall[]): TodoItem[] {
  const todoMap = new Map<string, TodoItem>()

  // Get all todo-related tool calls, sorted by timestamp
  const todoToolCalls = toolCalls
    .filter(
      (tc) =>
        (tc.title === 'TodoRead' || tc.title === 'TodoWrite') &&
        tc.status === 'success'
    )
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  // Process each tool call chronologically to build todo history
  todoToolCalls.forEach((toolCall) => {
    const todos = extractTodosFromToolCall(toolCall)
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
        existing.status = todo.status
        existing.activeForm = todo.activeForm
        existing.lastSeen = todo.lastSeen
        existing.wasCompleted = existing.wasCompleted || todo.status === 'completed'
        existing.wasRemoved = false
      } else {
        todoMap.set(todo.content, todo)
      }
    })
  })

  return Array.from(todoMap.values())
}
