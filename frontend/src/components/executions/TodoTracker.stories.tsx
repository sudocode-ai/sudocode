import type { Meta, StoryObj } from '@storybook/react'
import { TodoTracker, type TodoItem } from './TodoTracker'

const meta: Meta<typeof TodoTracker> = {
  title: 'Executions/TodoTracker',
  component: TodoTracker,
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof TodoTracker>

const now = Date.now()

const sampleTodos: TodoItem[] = [
  {
    content: 'Set up project structure',
    status: 'completed',
    activeForm: 'Setting up project structure',
    firstSeen: now - 10000,
    lastSeen: now,
    wasCompleted: true,
    wasRemoved: false,
  },
  {
    content: 'Implement user authentication',
    status: 'in_progress',
    activeForm: 'Implementing user authentication',
    firstSeen: now - 8000,
    lastSeen: now,
    wasCompleted: false,
    wasRemoved: false,
  },
  {
    content: 'Add database migrations',
    status: 'pending',
    activeForm: 'Adding database migrations',
    firstSeen: now - 5000,
    lastSeen: now,
    wasCompleted: false,
    wasRemoved: false,
  },
  {
    content: 'Write unit tests',
    status: 'pending',
    activeForm: 'Writing unit tests',
    firstSeen: now - 3000,
    lastSeen: now,
    wasCompleted: false,
    wasRemoved: false,
  },
]

export const Default: Story = {
  args: {
    todos: sampleTodos,
  },
}

export const Empty: Story = {
  args: {
    todos: [],
  },
}

export const AllCompleted: Story = {
  args: {
    todos: sampleTodos.map((todo) => ({
      ...todo,
      status: 'completed' as const,
      wasCompleted: true,
    })),
  },
}

export const AllPending: Story = {
  args: {
    todos: sampleTodos.map((todo) => ({
      ...todo,
      status: 'pending' as const,
      wasCompleted: false,
    })),
  },
}

export const SingleInProgress: Story = {
  args: {
    todos: [
      {
        content: 'Currently working on this task',
        status: 'in_progress',
        activeForm: 'Working on current task',
        firstSeen: now,
        lastSeen: now,
        wasCompleted: false,
        wasRemoved: false,
      },
    ],
  },
}

export const LongList: Story = {
  args: {
    todos: Array.from({ length: 10 }, (_, i) => ({
      content: `Task ${i + 1}: ${['Setup', 'Implement', 'Test', 'Deploy', 'Review'][i % 5]} feature ${Math.floor(i / 5) + 1}`,
      status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : ('pending' as const),
      activeForm: `Working on task ${i + 1}`,
      firstSeen: now - (10 - i) * 1000,
      lastSeen: now,
      wasCompleted: i < 3,
      wasRemoved: false,
    })),
  },
}
