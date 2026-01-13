import type { Meta, StoryObj } from '@storybook/react'
import { WorkflowCard } from './WorkflowCard'
import type { Workflow } from '@/types/workflow'

const meta: Meta<typeof WorkflowCard> = {
  title: 'Workflows/WorkflowCard',
  component: WorkflowCard,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[400px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof WorkflowCard>

const baseWorkflow: Workflow = {
  id: 'w-abc123',
  title: 'Implement Authentication System',
  source: {
    type: 'spec',
    specId: 's-xyz789',
  },
  status: 'pending',
  steps: [],
  baseBranch: 'main',
  currentStepIndex: 0,
  config: {
    engineType: 'sequential',
    parallelism: 'sequential',
    onFailure: 'pause',
    autoCommitAfterStep: true,
    defaultAgentType: 'claude-code',
    autonomyLevel: 'human_in_the_loop',
  },
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
}

export const Pending: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'pending' },
    onSelect: () => console.log('Selected'),
    onPause: () => console.log('Pause'),
    onResume: () => console.log('Resume'),
    onCancel: () => console.log('Cancel'),
    onDelete: () => console.log('Delete'),
  },
}

export const Running: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'running' },
    onSelect: () => console.log('Selected'),
    onPause: () => console.log('Pause'),
    onCancel: () => console.log('Cancel'),
  },
}

export const Paused: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'paused' },
    onSelect: () => console.log('Selected'),
    onResume: () => console.log('Resume'),
    onCancel: () => console.log('Cancel'),
  },
}

export const Completed: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'completed' },
    onSelect: () => console.log('Selected'),
    onDelete: () => console.log('Delete'),
  },
}

export const Failed: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'failed' },
    onSelect: () => console.log('Selected'),
    onDelete: () => console.log('Delete'),
  },
}

export const Cancelled: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'cancelled' },
    onSelect: () => console.log('Selected'),
    onDelete: () => console.log('Delete'),
  },
}

export const LongTitle: Story = {
  args: {
    workflow: {
      ...baseWorkflow,
      title: 'This is a very long workflow title that demonstrates how text wrapping works in the workflow card component',
    },
    onSelect: () => console.log('Selected'),
  },
}

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const).map((status) => (
        <WorkflowCard
          key={status}
          workflow={{ ...baseWorkflow, id: `w-${status}`, status, title: `${status.charAt(0).toUpperCase() + status.slice(1)} Workflow` }}
          onSelect={() => console.log('Selected:', status)}
        />
      ))}
    </div>
  ),
}
