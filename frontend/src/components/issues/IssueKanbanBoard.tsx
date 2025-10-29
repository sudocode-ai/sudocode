import { memo } from 'react'
import {
  type DragEndEvent,
  KanbanBoard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from '@/components/ui/kanban'
import { IssueCard } from './IssueCard'
import type { Issue, IssueStatus } from '@sudocode/types'

const columnOrder: IssueStatus[] = ['blocked', 'open', 'in_progress', 'needs_review', 'closed']

// Status labels and colors
const statusLabels: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  needs_review: 'Needs Review',
  closed: 'Closed',
}

const statusColors: Record<IssueStatus, string> = {
  open: '--chart-3',
  in_progress: '--chart-2',
  blocked: '--chart-1',
  needs_review: '--chart-4',
  closed: '--chart-5',
}

interface IssueKanbanBoardProps {
  groupedIssues: Record<IssueStatus, Issue[]>
  onDragEnd: (event: DragEndEvent) => void
  onViewIssueDetails: (issue: Issue) => void
  selectedIssue?: Issue
  onArchiveAllClosed?: () => void
}

function IssueKanbanBoard({
  groupedIssues,
  onDragEnd,
  onViewIssueDetails,
  selectedIssue,
  onArchiveAllClosed,
}: IssueKanbanBoardProps) {
  const renderDragOverlay = (activeId: string | null) => {
    if (!activeId) return null

    // Find the issue being dragged
    for (const [status, statusIssues] of Object.entries(groupedIssues)) {
      const issue = statusIssues.find((i) => i.id === activeId)
      if (issue) {
        const index = statusIssues.indexOf(issue)
        return (
          <IssueCard
            issue={issue}
            index={index}
            status={status}
            onViewDetails={onViewIssueDetails}
            isOpen={false}
          />
        )
      }
    }
    return null
  }

  return (
    <KanbanProvider onDragEnd={onDragEnd} renderDragOverlay={renderDragOverlay}>
      {columnOrder.map((status) => {
        const statusIssues = groupedIssues[status] || []
        return (
          <KanbanBoard key={status} id={status} data-column-id={status}>
            <KanbanHeader
              name={statusLabels[status]}
              color={statusColors[status]}
              count={statusIssues.length}
              onArchiveAll={status === 'closed' ? onArchiveAllClosed : undefined}
            />
            <KanbanCards>
              {statusIssues.map((issue, index) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  index={index}
                  status={status}
                  onViewDetails={onViewIssueDetails}
                  isOpen={selectedIssue?.id === issue.id}
                />
              ))}
            </KanbanCards>
          </KanbanBoard>
        )
      })}
    </KanbanProvider>
  )
}

export default memo(IssueKanbanBoard)
