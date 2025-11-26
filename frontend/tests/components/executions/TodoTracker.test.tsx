/**
 * Tests for TodoTracker component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodoTracker } from '@/components/executions/TodoTracker'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'

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

    const { container } = render(<TodoTracker toolCalls={toolCalls} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render todos from TodoWrite tool call', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: JSON.stringify({
            todos: [
              { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
              { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
            ],
          }),
          status: 'completed',
          result: 'Todo list updated',
          startTime: 1000,
          endTime: 1200,
          index: 0,
        },
      ],
    ])

    render(<TodoTracker toolCalls={toolCalls} />)

    expect(screen.getByText(/Todo Progress/i)).toBeInTheDocument()
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

    render(<TodoTracker toolCalls={toolCalls} />)

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
          args: JSON.stringify({
            todos: [
              { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
              { content: 'Task 3', status: 'in_progress', activeForm: 'Task 3' },
              { content: 'Task 4', status: 'completed', activeForm: 'Task 4' },
              { content: 'Task 5', status: 'completed', activeForm: 'Task 5' },
            ],
          }),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
    ])

    render(<TodoTracker toolCalls={toolCalls} />)

    // Should show summary: 2 completed out of 5 total
    expect(screen.getByText(/2 \/ 5 completed/)).toBeInTheDocument()
    // Should show in progress count
    expect(screen.getByText(/2 in progress/)).toBeInTheDocument()
    // Should show pending count
    expect(screen.getByText(/1 pending/)).toBeInTheDocument()
  })

  it('should track completed todos even after removal', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: JSON.stringify({
            todos: [
              { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
              { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
            ],
          }),
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
          args: JSON.stringify({
            todos: [
              // Task 1 now completed, Task 3 removed from list
              { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
            ],
          }),
          status: 'completed',
          result: 'Updated',
          startTime: 2000,
          endTime: 2100,
          index: 1,
        },
      ],
    ])

    render(<TodoTracker toolCalls={toolCalls} />)

    // Should still track Task 3 as completed even though removed
    expect(screen.getByText('Task 3')).toBeInTheDocument()
    // Should show both completed tasks
    expect(screen.getByText(/2 \/ 3 completed/)).toBeInTheDocument()
  })

  it('should update todo status across multiple tool calls', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: JSON.stringify({
            todos: [
              { content: 'Build feature', status: 'pending', activeForm: 'Build feature' },
              { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
            ],
          }),
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
          args: JSON.stringify({
            todos: [
              { content: 'Build feature', status: 'in_progress', activeForm: 'Building feature' },
              { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
            ],
          }),
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
          args: JSON.stringify({
            todos: [
              { content: 'Build feature', status: 'completed', activeForm: 'Build feature' },
              { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
            ],
          }),
          status: 'completed',
          result: 'Updated',
          startTime: 3000,
          endTime: 3100,
          index: 2,
        },
      ],
    ])

    render(<TodoTracker toolCalls={toolCalls} />)

    // Should show final state
    expect(screen.getByText('Build feature')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    // Should show 1 completed, 1 in progress
    expect(screen.getByText(/1 \/ 2 completed/)).toBeInTheDocument()
    expect(screen.getByText(/1 in progress/)).toBeInTheDocument()
  })

  it('should limit completed todos display to last 5', () => {
    const todos = []
    for (let i = 1; i <= 10; i++) {
      todos.push({ content: `Completed task ${i}`, status: 'completed', activeForm: `Task ${i}` })
    }

    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: JSON.stringify({ todos }),
          status: 'completed',
          result: 'Updated',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
    ])

    render(<TodoTracker toolCalls={toolCalls} />)

    // Should show last 5 completed tasks
    expect(screen.getByText('Completed task 6')).toBeInTheDocument()
    expect(screen.getByText('Completed task 10')).toBeInTheDocument()
    // Should show indicator for hidden completed tasks
    expect(screen.getByText(/\+5 more completed/)).toBeInTheDocument()
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
          args: JSON.stringify({
            todos: [
              { content: 'Initial task', status: 'in_progress', activeForm: 'Initial task' },
              { content: 'New task', status: 'pending', activeForm: 'New task' },
            ],
          }),
          status: 'completed',
          result: 'Updated',
          startTime: 2000,
          endTime: 2100,
          index: 1,
        },
      ],
    ])

    render(<TodoTracker toolCalls={toolCalls} />)

    expect(screen.getByText('Initial task')).toBeInTheDocument()
    expect(screen.getByText('New task')).toBeInTheDocument()
    expect(screen.getByText(/1 in progress/)).toBeInTheDocument()
    expect(screen.getByText(/1 pending/)).toBeInTheDocument()
  })

  it('should only process completed tool calls', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: JSON.stringify({
            todos: [{ content: 'Task 1', status: 'pending', activeForm: 'Task 1' }],
          }),
          status: 'executing',
          startTime: 1000,
          index: 0,
        },
      ],
    ])

    const { container } = render(<TodoTracker toolCalls={toolCalls} />)
    // Should not render because tool call is not completed
    expect(container.firstChild).toBeNull()
  })
})
