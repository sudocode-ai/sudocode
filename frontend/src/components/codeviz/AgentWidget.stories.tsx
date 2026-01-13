import type { Meta, StoryObj } from '@storybook/react'
import { AgentWidget, AgentBadge } from './AgentWidget'

const meta: Meta<typeof AgentWidget> = {
  title: 'CodeViz/AgentWidget',
  component: AgentWidget,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    agentType: {
      control: 'select',
      options: ['claude-code', 'codex', 'copilot', 'cursor'],
    },
    status: {
      control: 'select',
      options: ['preparing', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'stopped'],
    },
    isSelected: {
      control: 'boolean',
    },
  },
}

export default meta
type Story = StoryObj<typeof AgentWidget>

export const Default: Story = {
  args: {
    executionId: 'exec-001',
    agentType: 'claude-code',
    status: 'running',
    color: '#3b82f6',
    isSelected: false,
    fileCount: 3,
    prompt: 'Implement user authentication with OAuth2',
  },
}

export const ClaudeCodeRunning: Story = {
  args: {
    executionId: 'exec-001',
    agentType: 'claude-code',
    status: 'running',
    color: '#3b82f6',
    isSelected: false,
    fileCount: 5,
    prompt: 'Add error handling to API endpoints',
  },
}

export const CodexPending: Story = {
  args: {
    executionId: 'exec-002',
    agentType: 'codex',
    status: 'pending',
    color: '#22c55e',
    isSelected: false,
    fileCount: 2,
    prompt: 'Refactor database queries for performance',
  },
}

export const CopilotCompleted: Story = {
  args: {
    executionId: 'exec-003',
    agentType: 'copilot',
    status: 'completed',
    color: '#a855f7',
    isSelected: false,
    fileCount: 8,
    prompt: 'Write unit tests for user service',
  },
}

export const CursorFailed: Story = {
  args: {
    executionId: 'exec-004',
    agentType: 'cursor',
    status: 'failed',
    color: '#ef4444',
    isSelected: false,
    fileCount: 1,
    prompt: 'Fix type errors in component props',
  },
}

export const Selected: Story = {
  args: {
    executionId: 'exec-005',
    agentType: 'claude-code',
    status: 'running',
    color: '#3b82f6',
    isSelected: true,
    fileCount: 4,
    prompt: 'This is a longer prompt that demonstrates how text is truncated when the agent widget is selected and showing the prompt preview to the user.',
  },
}

export const Preparing: Story = {
  args: {
    executionId: 'exec-006',
    agentType: 'claude-code',
    status: 'preparing',
    color: '#eab308',
    isSelected: false,
    fileCount: 0,
  },
}

export const Paused: Story = {
  args: {
    executionId: 'exec-007',
    agentType: 'codex',
    status: 'paused',
    color: '#f97316',
    isSelected: false,
    fileCount: 3,
    prompt: 'Paused while waiting for user input',
  },
}

// AgentBadge stories
export const BadgeDefault: StoryObj<typeof AgentBadge> = {
  render: (args) => <AgentBadge {...args} />,
  args: {
    agentType: 'claude-code',
    status: 'running',
    color: '#3b82f6',
  },
}

export const BadgeCompleted: StoryObj<typeof AgentBadge> = {
  render: (args) => <AgentBadge {...args} />,
  args: {
    agentType: 'copilot',
    status: 'completed',
    color: '#22c55e',
  },
}

export const BadgeFailed: StoryObj<typeof AgentBadge> = {
  render: (args) => <AgentBadge {...args} />,
  args: {
    agentType: 'cursor',
    status: 'failed',
    color: '#ef4444',
  },
}

// Multiple agents comparison
export const AllAgentTypes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <AgentWidget
        executionId="exec-1"
        agentType="claude-code"
        status="running"
        color="#3b82f6"
        fileCount={3}
        prompt="Claude Code agent"
      />
      <AgentWidget
        executionId="exec-2"
        agentType="codex"
        status="pending"
        color="#22c55e"
        fileCount={2}
        prompt="Codex agent"
      />
      <AgentWidget
        executionId="exec-3"
        agentType="copilot"
        status="completed"
        color="#a855f7"
        fileCount={5}
        prompt="Copilot agent"
      />
      <AgentWidget
        executionId="exec-4"
        agentType="cursor"
        status="paused"
        color="#f97316"
        fileCount={1}
        prompt="Cursor agent"
      />
    </div>
  ),
}

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <AgentWidget executionId="1" agentType="claude-code" status="preparing" color="#eab308" />
      <AgentWidget executionId="2" agentType="claude-code" status="pending" color="#3b82f6" />
      <AgentWidget executionId="3" agentType="claude-code" status="running" color="#3b82f6" fileCount={3} />
      <AgentWidget executionId="4" agentType="claude-code" status="paused" color="#f97316" fileCount={2} />
      <AgentWidget executionId="5" agentType="claude-code" status="completed" color="#22c55e" fileCount={5} />
      <AgentWidget executionId="6" agentType="claude-code" status="failed" color="#ef4444" fileCount={1} />
      <AgentWidget executionId="7" agentType="claude-code" status="cancelled" color="#6b7280" fileCount={2} />
      <AgentWidget executionId="8" agentType="claude-code" status="stopped" color="#6b7280" fileCount={1} />
    </div>
  ),
}
