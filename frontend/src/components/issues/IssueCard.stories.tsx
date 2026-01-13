import type { Meta, StoryObj } from '@storybook/react'
import { IssueCard } from './IssueCard'
import type { Issue } from '@sudocode-ai/types'

const meta: Meta<typeof IssueCard> = {
  title: 'Issues/IssueCard',
  component: IssueCard,
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
type Story = StoryObj<typeof IssueCard>

const baseIssue: Issue = {
  id: 'i-abc123',
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Implement user authentication',
  content: 'Add OAuth2 login flow with Google and GitHub providers',
  status: 'open',
  priority: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export const Open: Story = {
  args: {
    issue: baseIssue,
    index: 0,
    status: 'open',
  },
}

export const InProgress: Story = {
  args: {
    issue: { ...baseIssue, status: 'in_progress' },
    index: 0,
    status: 'in_progress',
  },
}

export const Blocked: Story = {
  args: {
    issue: { ...baseIssue, status: 'blocked' },
    index: 0,
    status: 'blocked',
  },
}

export const Closed: Story = {
  args: {
    issue: { ...baseIssue, status: 'closed', closed_at: new Date().toISOString() },
    index: 0,
    status: 'closed',
  },
}

export const HighPriority: Story = {
  args: {
    issue: { ...baseIssue, priority: 0, title: 'Critical security vulnerability' },
    index: 0,
    status: 'open',
  },
}

export const LowPriority: Story = {
  args: {
    issue: { ...baseIssue, priority: 4, title: 'Nice to have feature' },
    index: 0,
    status: 'open',
  },
}

export const LongTitle: Story = {
  args: {
    issue: {
      ...baseIssue,
      title: 'This is a very long issue title that should be truncated when displayed in the card view',
    },
    index: 0,
    status: 'open',
  },
}

export const AllPriorities: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((priority) => (
        <IssueCard
          key={priority}
          issue={{ ...baseIssue, id: `i-${priority}`, priority, title: `Priority ${priority} issue` }}
          index={priority}
          status="open"
        />
      ))}
    </div>
  ),
}
