/**
 * Todo Extraction Utilities
 *
 * Provides utilities for extracting todo items from different agent tool call formats.
 * Agent-specific components can use these utilities to process tool calls and
 * convert them into the generic TodoItem format expected by TodoTracker.
 *
 * IMPORTANT: Claude Code's TodoWrite is an INTERNAL tool that does NOT emit tool_call events.
 * Instead, todo state is exposed via ACP "plan" session updates. Use buildTodoHistoryFromPlanUpdates
 * for Claude Code executions instead of buildTodoHistoryFromToolCalls.
 */

import type { ToolCallTracking } from '@/types/stream'
import type { ToolCall, PlanUpdateEvent, PlanEntry } from '@/hooks/useSessionUpdateStream'
import type { PlanUpdateEvent as LogsPlanUpdateEvent, PlanEntry as LogsPlanEntry } from '@/hooks/useExecutionLogs'
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
 * Check if a tool call is a TodoWrite call
 * ACP titles are human-readable (e.g., "Writing todos") not the tool name,
 * so we detect by checking if rawInput has a todos array with proper structure
 */
function isTodoWriteCall(toolCall: ToolCall): boolean {
  // Exact match for legacy compatibility
  if (toolCall.title === 'TodoWrite') return true

  // Title pattern matching (case-insensitive) for ACP human-readable titles
  const titleLower = toolCall.title.toLowerCase()

  // Match various patterns:
  // - "TodoWrite", "todowrite", "todo write"
  // - "Writing todos", "writing to-do", "updating todos"
  // - "Managing tasks", "task list", "todo list"
  if (
    titleLower.includes('todowrite') ||
    titleLower.includes('todo write') ||
    (titleLower.includes('writing') && titleLower.includes('todo')) ||
    (titleLower.includes('updating') && titleLower.includes('todo')) ||
    (titleLower.includes('managing') && titleLower.includes('todo')) ||
    (titleLower.includes('task') && titleLower.includes('list')) ||
    titleLower.includes('todo list')
  ) {
    return true
  }

  // Check rawInput for todos array (TodoWrite signature)
  try {
    const input = typeof toolCall.rawInput === 'string'
      ? JSON.parse(toolCall.rawInput)
      : toolCall.rawInput

    if (!input) return false

    const args = input.args || input
    if (args.todos && Array.isArray(args.todos)) {
      // Verify it has the TodoWrite structure (content + status)
      return args.todos.length === 0 || (
        args.todos[0] &&
        typeof args.todos[0] === 'object' &&
        ('content' in args.todos[0] || 'status' in args.todos[0])
      )
    }
  } catch {
    // Not valid JSON or structure
  }

  return false
}

/**
 * Check if a tool call is a TodoRead call
 * Detected by checking if result/rawOutput has a todos array
 */
function isTodoReadCall(toolCall: ToolCall): boolean {
  // Exact match for legacy compatibility
  if (toolCall.title === 'TodoRead') return true

  // Title pattern matching (case-insensitive) for ACP human-readable titles
  const titleLower = toolCall.title.toLowerCase()
  if (titleLower.includes('todoread') || titleLower.includes('todo read')) return true

  // Check result/rawOutput for todos array (TodoRead signature)
  const resultData = toolCall.result ?? toolCall.rawOutput
  if (!resultData) return false

  try {
    const result = typeof resultData === 'string'
      ? JSON.parse(resultData)
      : resultData

    if (!result) return false

    const data = result.result || result
    if (data.todos && Array.isArray(data.todos)) {
      // Verify it has the todo structure
      return data.todos.length === 0 || (
        data.todos[0] &&
        typeof data.todos[0] === 'object' &&
        ('content' in data.todos[0] || 'status' in data.todos[0])
      )
    }
  } catch {
    // Not valid JSON or structure
  }

  return false
}

/**
 * Extract todos from a ToolCall (ACP format)
 */
function extractTodosFromToolCall(toolCall: ToolCall): TodoItem[] | null {
  const argsString = valueToString(toolCall.rawInput)
  const resultString = valueToString(toolCall.result ?? toolCall.rawOutput)

  try {
    // For TodoWrite, parse args to get todos
    if (isTodoWriteCall(toolCall)) {
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
    if (isTodoReadCall(toolCall) && resultString) {
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
  // Use content-based detection since ACP titles are human-readable, not tool names
  const todoToolCalls = toolCalls
    .filter(
      (tc) =>
        (isTodoReadCall(tc) || isTodoWriteCall(tc)) &&
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

/**
 * Convert a PlanEntry to a TodoItem
 * Plan entries use 'high' | 'medium' | 'low' for priority but TodoItem doesn't use priority
 */
function planEntryToTodoItem(entry: PlanEntry | LogsPlanEntry, timestamp: number): TodoItem {
  return {
    content: entry.content,
    status: entry.status,
    activeForm: undefined, // Plan entries don't have activeForm
    firstSeen: timestamp,
    lastSeen: timestamp,
    wasCompleted: entry.status === 'completed',
    wasRemoved: false,
  }
}

/**
 * Build a historical view of todos from plan updates (ACP format)
 * This is the PRIMARY method for extracting todos from Claude Code executions,
 * since TodoWrite does NOT emit tool_call events - it exposes state via plan updates.
 *
 * @param planUpdates - Array of plan updates from streaming or logs
 * @returns Array of TodoItem with complete history
 */
export function buildTodoHistoryFromPlanUpdates(
  planUpdates: PlanUpdateEvent[] | LogsPlanUpdateEvent[]
): TodoItem[] {
  const todoMap = new Map<string, TodoItem>()

  // Sort plan updates by timestamp (oldest first)
  const sortedUpdates = [...planUpdates].sort((a, b) => {
    const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
    const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
    return timeA - timeB
  })

  // Process each plan update chronologically to build todo history
  sortedUpdates.forEach((planUpdate) => {
    const entries = planUpdate.entries
    if (!entries || entries.length === 0) return

    const timestamp = planUpdate.timestamp instanceof Date
      ? planUpdate.timestamp.getTime()
      : new Date(planUpdate.timestamp).getTime()

    // Track which todos are present in this snapshot
    const currentTodoContents = new Set(entries.map((e) => e.content))

    // Mark previously seen todos as removed if they're not in current list
    todoMap.forEach((existingTodo) => {
      if (!currentTodoContents.has(existingTodo.content)) {
        existingTodo.wasRemoved = true
      }
    })

    // Add or update todos from current snapshot
    entries.forEach((entry) => {
      const existing = todoMap.get(entry.content)
      if (existing) {
        // Update existing todo
        existing.status = entry.status
        existing.lastSeen = timestamp
        existing.wasCompleted = existing.wasCompleted || entry.status === 'completed'
        existing.wasRemoved = false // Un-mark as removed if it reappears
      } else {
        // Add new todo
        todoMap.set(entry.content, planEntryToTodoItem(entry, timestamp))
      }
    })
  })

  return Array.from(todoMap.values())
}

/**
 * Get the latest plan entries from plan updates
 * Returns the entries from the most recent plan update
 *
 * @param planUpdates - Array of plan updates
 * @returns Latest plan entries or null if no updates
 */
export function getLatestPlanEntries(
  planUpdates: PlanUpdateEvent[] | LogsPlanUpdateEvent[]
): (PlanEntry | LogsPlanEntry)[] | null {
  if (planUpdates.length === 0) return null

  // Sort by timestamp descending and take the most recent
  const sorted = [...planUpdates].sort((a, b) => {
    const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
    const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
    return timeB - timeA // Descending
  })

  return sorted[0]?.entries || null
}

/**
 * Convert latest plan entries directly to TodoItems (for simple display without history)
 *
 * @param latestPlan - Array of PlanEntry from latestPlan
 * @returns Array of TodoItem
 */
export function planEntriesToTodoItems(
  latestPlan: (PlanEntry | LogsPlanEntry)[] | null
): TodoItem[] {
  if (!latestPlan) return []

  const now = Date.now()
  return latestPlan.map((entry) => planEntryToTodoItem(entry, now))
}
