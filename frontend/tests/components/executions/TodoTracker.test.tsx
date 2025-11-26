/**
 * Tests for TodoTracker component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodoTracker } from '@/components/executions/TodoTracker'
import { buildTodoHistory } from '@/utils/todoExtractor'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'

/**
 * Helper to create TodoWrite args with nested structure
 */
function createTodoWriteArgs(todos: Array<{ content: string; status: string; activeForm: string }>) {
  return JSON.stringify({
    toolName: 'TodoWrite',
    args: { todos },
  })
}

describe('TodoTracker', () => {
  it('should not render when there are no todo tool calls', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Bash',
          args: JSON.stringify({ command: 'npm test' }),
          status: 'completed',
          result: 'Tests passed',
          startTime: 1000,
          endTime: 2000,
          index: 0,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    const { container } = render(<TodoTracker todos={todos} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render todos from TodoWrite tool call', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
            { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
          ]),
          status: 'completed',
          result: 'Todo list updated',
          startTime: 1000,
          endTime: 1200,
          index: 0,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    render(<TodoTracker todos={todos} />)

    expect(screen.getByText(/Todos/i)).toBeInTheDocument()
    expect(screen.getByText('Task 1')).toBeInTheDocument()
    expect(screen.getByText('Task 2')).toBeInTheDocument()
    expect(screen.getByText('Task 3')).toBeInTheDocument()
  })

  it('should render todos from TodoRead tool call', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoRead',
          args: JSON.stringify({}),
          status: 'completed',
          result: JSON.stringify({
            todos: [
              { content: 'Read task 1', status: 'pending' },
              { content: 'Read task 2', status: 'in_progress' },
            ],
          }),
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    render(<TodoTracker todos={todos} />)

    expect(screen.getByText('Read task 1')).toBeInTheDocument()
    expect(screen.getByText('Read task 2')).toBeInTheDocument()
  })

  it('should show correct summary stats', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
            { content: 'Task 3', status: 'in_progress', activeForm: 'Task 3' },
            { content: 'Task 4', status: 'completed', activeForm: 'Task 4' },
            { content: 'Task 5', status: 'completed', activeForm: 'Task 5' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    render(<TodoTracker todos={todos} />)

    // Should show summary: 2 completed out of 5 total
    expect(screen.getByText(/2\/5 completed/)).toBeInTheDocument()
  })

  it('should track completed todos even after removal', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
            { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
      [
        'tool-2',
        {
          toolCallId: 'tool-2',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            // Task 1 now completed, Task 3 removed from list
            { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 2000,
          endTime: 2100,
          index: 1,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    render(<TodoTracker todos={todos} />)

    // Should still track Task 3 as completed even though removed
    expect(screen.getByText('Task 3')).toBeInTheDocument()
    // Should show both completed tasks
    expect(screen.getByText(/2\/3 completed/)).toBeInTheDocument()
  })

  it('should update todo status across multiple tool calls', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Build feature', status: 'pending', activeForm: 'Build feature' },
            { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
      [
        'tool-2',
        {
          toolCallId: 'tool-2',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Build feature', status: 'in_progress', activeForm: 'Building feature' },
            { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 2000,
          endTime: 2100,
          index: 1,
        },
      ],
      [
        'tool-3',
        {
          toolCallId: 'tool-3',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Build feature', status: 'completed', activeForm: 'Build feature' },
            { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 3000,
          endTime: 3100,
          index: 2,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    render(<TodoTracker todos={todos} />)

    // Should show final state
    expect(screen.getByText('Build feature')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    // Should show 1 completed out of 2 total
    expect(screen.getByText(/1\/2 completed/)).toBeInTheDocument()
  })

  it('should render todos in creation order regardless of status', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'First task', status: 'pending', activeForm: 'First task' },
            { content: 'Second task', status: 'pending', activeForm: 'Second task' },
            { content: 'Third task', status: 'pending', activeForm: 'Third task' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
      [
        'tool-2',
        {
          toolCallId: 'tool-2',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'First task', status: 'completed', activeForm: 'First task' },
            { content: 'Second task', status: 'in_progress', activeForm: 'Second task' },
            { content: 'Third task', status: 'pending', activeForm: 'Third task' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 2000,
          endTime: 2100,
          index: 1,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    const { container } = render(<TodoTracker todos={todos} />)
    const todoItems = container.querySelectorAll('.space-y-1 > div')

    // Should render in creation order: First (completed), Second (in_progress), Third (pending)
    expect(todoItems).toHaveLength(3)
    expect(todoItems[0]).toHaveTextContent('First task')
    expect(todoItems[1]).toHaveTextContent('Second task')
    expect(todoItems[2]).toHaveTextContent('Third task')
  })

  it('should handle mixed TodoRead and TodoWrite calls', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoRead',
          args: JSON.stringify({}),
          status: 'completed',
          result: JSON.stringify({
            todos: [{ content: 'Initial task', status: 'pending' }],
          }),
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
      [
        'tool-2',
        {
          toolCallId: 'tool-2',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Initial task', status: 'in_progress', activeForm: 'Initial task' },
            { content: 'New task', status: 'pending', activeForm: 'New task' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 2000,
          endTime: 2100,
          index: 1,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    render(<TodoTracker todos={todos} />)

    expect(screen.getByText('Initial task')).toBeInTheDocument()
    expect(screen.getByText('New task')).toBeInTheDocument()
    // Should show 0 completed out of 2 total
    expect(screen.getByText(/0\/2 completed/)).toBeInTheDocument()
  })

  it('should only process completed tool calls', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([{ content: 'Task 1', status: 'pending', activeForm: 'Task 1' }]),
          status: 'executing',
          startTime: 1000,
          index: 0,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    const { container } = render(<TodoTracker todos={todos} />)
    // Should not render because tool call is not completed
    expect(container.firstChild).toBeNull()
  })

  it('should preserve order when todos are added at different times', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Early task', status: 'pending', activeForm: 'Early task' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
      [
        'tool-2',
        {
          toolCallId: 'tool-2',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Early task', status: 'in_progress', activeForm: 'Early task' },
            { content: 'Later task', status: 'pending', activeForm: 'Later task' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 5000,
          endTime: 5100,
          index: 1,
        },
      ],
      [
        'tool-3',
        {
          toolCallId: 'tool-3',
          toolCallName: 'TodoWrite',
          args: createTodoWriteArgs([
            { content: 'Early task', status: 'completed', activeForm: 'Early task' },
            { content: 'Later task', status: 'pending', activeForm: 'Later task' },
          ]),
          status: 'completed',
          result: 'Updated',
          startTime: 10000,
          endTime: 10100,
          index: 2,
        },
      ],
    ])

    const todos = buildTodoHistory(toolCalls)
    const { container } = render(<TodoTracker todos={todos} />)
    const todoItems = container.querySelectorAll('.space-y-1 > div')

    // Early task should appear first (created at 1000ms) even though it's completed
    // Later task should appear second (created at 5000ms)
    expect(todoItems).toHaveLength(2)
    expect(todoItems[0]).toHaveTextContent('Early task')
    expect(todoItems[1]).toHaveTextContent('Later task')
  })
})
