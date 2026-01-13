import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import IssueKanbanBoard from './IssueKanbanBoard'
import type { Issue, IssueStatus } from '@sudocode-ai/types'
import type { DragEndEvent } from '@/components/ui/kanban'

const meta: Meta<typeof IssueKanbanBoard> = {
  title: 'Issues/IssueKanbanBoard',
  component: IssueKanbanBoard,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-screen p-4">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof IssueKanbanBoard>

// Helper to create mock issues
const createMockIssue = (
  id: string,
  title: string,
  status: IssueStatus,
  priority: number = 2
): Issue => ({
  id,
  uuid: `uuid-${id}`,
  title,
  content: `Description for ${title}`,
  status,
  priority,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived: false,
})

// Mock issues grouped by status
const mockGroupedIssues: Record<IssueStatus, Issue[]> = {
  blocked: [
    createMockIssue('i-blocked1', 'Waiting for API access', 'blocked', 1),
    createMockIssue('i-blocked2', 'Pending design approval', 'blocked', 2),
  ],
  open: [
    createMockIssue('i-open1', 'Implement user authentication', 'open', 0),
    createMockIssue('i-open2', 'Add dark mode support', 'open', 2),
    createMockIssue('i-open3', 'Create dashboard layout', 'open', 1),
    createMockIssue('i-open4', 'Setup CI/CD pipeline', 'open', 3),
  ],
  in_progress: [
    createMockIssue('i-progress1', 'Build navigation component', 'in_progress', 1),
    createMockIssue('i-progress2', 'Integrate payment gateway', 'in_progress', 0),
  ],
  needs_review: [createMockIssue('i-review1', 'Update user profile page', 'needs_review', 2)],
  closed: [
    createMockIssue('i-closed1', 'Fix login button alignment', 'closed', 3),
    createMockIssue('i-closed2', 'Add form validation', 'closed', 2),
    createMockIssue('i-closed3', 'Update documentation', 'closed', 4),
  ],
}

export const Default: Story = {
  args: {
    groupedIssues: mockGroupedIssues,
    onDragEnd: (event: DragEndEvent) => console.log('Drag ended:', event),
    onViewIssueDetails: (issue: Issue) => console.log('View issue:', issue.id),
  },
}

export const WithSelectedIssue: Story = {
  args: {
    groupedIssues: mockGroupedIssues,
    onDragEnd: (event: DragEndEvent) => console.log('Drag ended:', event),
    onViewIssueDetails: (issue: Issue) => console.log('View issue:', issue.id),
    selectedIssue: mockGroupedIssues.in_progress[0],
  },
}

export const EmptyBoard: Story = {
  args: {
    groupedIssues: {
      blocked: [],
      open: [],
      in_progress: [],
      needs_review: [],
      closed: [],
    },
    onDragEnd: (event: DragEndEvent) => console.log('Drag ended:', event),
    onViewIssueDetails: (issue: Issue) => console.log('View issue:', issue.id),
  },
}

export const WithCollapsedColumns: Story = {
  render: function CollapsedStory() {
    const [collapsed, setCollapsed] = useState<Set<IssueStatus>>(new Set(['closed', 'blocked']))

    return (
      <IssueKanbanBoard
        groupedIssues={mockGroupedIssues}
        onDragEnd={(event) => console.log('Drag ended:', event)}
        onViewIssueDetails={(issue) => console.log('View issue:', issue.id)}
        collapsedColumns={collapsed}
        onToggleColumnCollapse={(status) => {
          setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(status)) {
              next.delete(status)
            } else {
              next.add(status)
            }
            return next
          })
        }}
      />
    )
  },
}

export const WithArchiveAll: Story = {
  args: {
    groupedIssues: mockGroupedIssues,
    onDragEnd: (event: DragEndEvent) => console.log('Drag ended:', event),
    onViewIssueDetails: (issue: Issue) => console.log('View issue:', issue.id),
    onArchiveAllClosed: () => console.log('Archive all closed issues'),
  },
}

export const OnlyOpenIssues: Story = {
  args: {
    groupedIssues: {
      blocked: [],
      open: [
        createMockIssue('i-open1', 'Implement user authentication', 'open', 0),
        createMockIssue('i-open2', 'Add dark mode support', 'open', 2),
        createMockIssue('i-open3', 'Create dashboard layout', 'open', 1),
      ],
      in_progress: [],
      needs_review: [],
      closed: [],
    },
    onDragEnd: (event: DragEndEvent) => console.log('Drag ended:', event),
    onViewIssueDetails: (issue: Issue) => console.log('View issue:', issue.id),
  },
}

export const ManyIssues: Story = {
  args: {
    groupedIssues: {
      blocked: Array.from({ length: 3 }, (_, i) =>
        createMockIssue(`i-blocked-${i}`, `Blocked issue ${i + 1}`, 'blocked', i % 5)
      ),
      open: Array.from({ length: 8 }, (_, i) =>
        createMockIssue(`i-open-${i}`, `Open issue ${i + 1}`, 'open', i % 5)
      ),
      in_progress: Array.from({ length: 5 }, (_, i) =>
        createMockIssue(`i-progress-${i}`, `In progress issue ${i + 1}`, 'in_progress', i % 5)
      ),
      needs_review: Array.from({ length: 4 }, (_, i) =>
        createMockIssue(`i-review-${i}`, `Review issue ${i + 1}`, 'needs_review', i % 5)
      ),
      closed: Array.from({ length: 10 }, (_, i) =>
        createMockIssue(`i-closed-${i}`, `Closed issue ${i + 1}`, 'closed', i % 5)
      ),
    },
    onDragEnd: (event: DragEndEvent) => console.log('Drag ended:', event),
    onViewIssueDetails: (issue: Issue) => console.log('View issue:', issue.id),
  },
}
