import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { BranchSelector } from './BranchSelector'
import type { Execution } from '@/types/execution'

const meta: Meta<typeof BranchSelector> = {
  title: 'Executions/BranchSelector',
  component: BranchSelector,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[300px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof BranchSelector>

const mockBranches = [
  'main',
  'develop',
  'feature/user-auth',
  'feature/api-v2',
  'bugfix/login-issue',
  'release/1.0.0',
]

const mockWorktrees: Execution[] = [
  {
    id: 'exec-001',
    issue_id: 'i-abc123',
    issue_uuid: '123e4567-e89b-12d3-a456-426614174000',
    agent_type: 'claude-code',
    status: 'completed',
    mode: 'worktree',
    prompt: 'Implement feature',
    config: null,
    session_id: null,
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'sudocode/exec-001',
    before_commit: 'abc1234',
    after_commit: 'def5678',
    worktree_path: '/project/.sudocode/worktrees/exec-001',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4',
    summary: null,
    files_changed: null,
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
  },
]

export const Default: Story = {
  render: function DefaultStory() {
    const [value, setValue] = useState('main')
    return (
      <BranchSelector
        branches={mockBranches}
        value={value}
        onChange={(branch) => setValue(branch)}
      />
    )
  },
}

export const WithPlaceholder: Story = {
  render: function PlaceholderStory() {
    const [value, setValue] = useState('')
    return (
      <BranchSelector
        branches={mockBranches}
        value={value}
        onChange={(branch) => setValue(branch)}
        placeholder="Choose a branch..."
      />
    )
  },
}

export const Disabled: Story = {
  args: {
    branches: mockBranches,
    value: 'main',
    onChange: () => {},
    disabled: true,
  },
}

export const WithWorktrees: Story = {
  render: function WorktreesStory() {
    const [value, setValue] = useState('main')
    return (
      <BranchSelector
        branches={mockBranches}
        value={value}
        onChange={(branch, isNew, worktreePath) => {
          console.log('Selected:', branch, isNew, worktreePath)
          setValue(branch)
        }}
        worktrees={mockWorktrees}
      />
    )
  },
}

export const AllowCreate: Story = {
  render: function CreateStory() {
    const [value, setValue] = useState('')
    return (
      <BranchSelector
        branches={mockBranches}
        value={value}
        onChange={(branch, isNew) => {
          console.log('Selected:', branch, 'isNew:', isNew)
          setValue(branch)
        }}
        allowCreate={true}
        currentBranch="main"
        placeholder="Search or create..."
      />
    )
  },
}

export const NoCreate: Story = {
  render: function NoCreateStory() {
    const [value, setValue] = useState('main')
    return (
      <BranchSelector
        branches={mockBranches}
        value={value}
        onChange={(branch) => setValue(branch)}
        allowCreate={false}
      />
    )
  },
}

export const ManyBranches: Story = {
  render: function ManyBranchesStory() {
    const [value, setValue] = useState('main')
    const manyBranches = [
      'main',
      'develop',
      ...Array.from({ length: 20 }, (_, i) => `feature/task-${i + 1}`),
    ]
    return (
      <BranchSelector
        branches={manyBranches}
        value={value}
        onChange={(branch) => setValue(branch)}
      />
    )
  },
}
