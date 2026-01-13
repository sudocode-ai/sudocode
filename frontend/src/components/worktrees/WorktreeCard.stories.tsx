import type { Meta, StoryObj } from '@storybook/react'
import { WorktreeCard } from './WorktreeCard'
import type { Execution } from '@/types/execution'

const meta: Meta<typeof WorktreeCard> = {
  title: 'Worktrees/WorktreeCard',
  component: WorktreeCard,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof WorktreeCard>

const baseExecution: Execution = {
  id: 'exec-001',
  issue_id: 'i-abc123',
  issue_uuid: '123e4567-e89b-12d3-a456-426614174000',
  agent_type: 'claude-code',
  status: 'running',
  mode: 'worktree',
  prompt: 'Implement user authentication with OAuth2',
  config: null,
  session_id: null,
  workflow_execution_id: null,
  target_branch: 'main',
  branch_name: 'sudocode/exec-001',
  before_commit: 'abc1234',
  after_commit: null,
  worktree_path: '/home/user/project/.sudocode/worktrees/exec-001',
  created_at: new Date(Date.now() - 3600000).toISOString(),
  updated_at: new Date().toISOString(),
  started_at: new Date(Date.now() - 3000000).toISOString(),
  completed_at: null,
  cancelled_at: null,
  exit_code: null,
  error_message: null,
  error: null,
  model: 'claude-sonnet-4',
  summary: null,
  files_changed: null,
  parent_execution_id: null,
  step_type: null,
  step_index: null,
  step_config: null,
}

export const Running: Story = {
  args: {
    execution: baseExecution,
    onClick: () => console.log('Clicked'),
  },
}

export const Completed: Story = {
  args: {
    execution: {
      ...baseExecution,
      status: 'completed',
      after_commit: 'def5678',
      completed_at: new Date().toISOString(),
    },
    onClick: () => console.log('Clicked'),
  },
}

export const Failed: Story = {
  args: {
    execution: {
      ...baseExecution,
      status: 'failed',
      exit_code: 1,
      completed_at: new Date().toISOString(),
    },
    onClick: () => console.log('Clicked'),
  },
}

export const Paused: Story = {
  args: {
    execution: { ...baseExecution, status: 'paused' },
    onClick: () => console.log('Clicked'),
  },
}

export const Selected: Story = {
  args: {
    execution: baseExecution,
    isSelected: true,
    onClick: () => console.log('Clicked'),
  },
}

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(['preparing', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'stopped'] as const).map(
        (status) => (
          <WorktreeCard
            key={status}
            execution={{ ...baseExecution, id: `exec-${status}`, status }}
            onClick={() => console.log('Clicked:', status)}
          />
        )
      )}
    </div>
  ),
}

export const DifferentAgents: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(['claude-code', 'codex', 'copilot', 'cursor'] as const).map((agentType) => (
        <WorktreeCard
          key={agentType}
          execution={{ ...baseExecution, id: `exec-${agentType}`, agent_type: agentType }}
          onClick={() => console.log('Clicked:', agentType)}
        />
      ))}
    </div>
  ),
}
