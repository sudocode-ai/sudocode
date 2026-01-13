import type { Meta, StoryObj } from '@storybook/react'
import { WorkflowControls } from './WorkflowControls'
import type { Workflow } from '@/types/workflow'

const meta: Meta<typeof WorkflowControls> = {
  title: 'Workflows/WorkflowControls',
  component: WorkflowControls,
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof WorkflowControls>

const baseWorkflow: Workflow = {
  id: 'w-abc123',
  title: 'Test Workflow',
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export const Pending: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'pending' },
    onStart: () => console.log('Start'),
    onCancel: () => console.log('Cancel'),
  },
}

export const Running: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'running' },
    onPause: () => console.log('Pause'),
    onCancel: () => console.log('Cancel'),
  },
}

export const Paused: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'paused' },
    onResume: () => console.log('Resume'),
    onCancel: () => console.log('Cancel'),
  },
}

export const Completed: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'completed' },
    // No actions for completed
  },
}

export const Starting: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'pending' },
    onStart: () => console.log('Start'),
    onCancel: () => console.log('Cancel'),
    isStarting: true,
  },
}

export const Pausing: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'running' },
    onPause: () => console.log('Pause'),
    onCancel: () => console.log('Cancel'),
    isPausing: true,
  },
}

export const SmallSize: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'running' },
    onPause: () => console.log('Pause'),
    onCancel: () => console.log('Cancel'),
    size: 'sm',
  },
}

export const WithoutLabels: Story = {
  args: {
    workflow: { ...baseWorkflow, status: 'running' },
    onPause: () => console.log('Pause'),
    onCancel: () => console.log('Cancel'),
    showLabels: false,
  },
}

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Pending</p>
        <WorkflowControls
          workflow={{ ...baseWorkflow, status: 'pending' }}
          onStart={() => console.log('Start')}
          onCancel={() => console.log('Cancel')}
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Running</p>
        <WorkflowControls
          workflow={{ ...baseWorkflow, status: 'running' }}
          onPause={() => console.log('Pause')}
          onCancel={() => console.log('Cancel')}
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Paused</p>
        <WorkflowControls
          workflow={{ ...baseWorkflow, status: 'paused' }}
          onResume={() => console.log('Resume')}
          onCancel={() => console.log('Cancel')}
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Completed (no controls)</p>
        <WorkflowControls workflow={{ ...baseWorkflow, status: 'completed' }} />
      </div>
    </div>
  ),
}
