import { memo } from 'react';
import {
  type DragEndEvent,
  KanbanBoard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from '@/components/ui/kanban';
import { IssueCard } from './IssueCard';
import type { Issue, IssueStatus } from '@sudocode/types';

// Status labels and colors
const statusLabels: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  needs_review: 'Needs Review',
  closed: 'Closed',
};

const statusColors: Record<IssueStatus, string> = {
  open: '--chart-1',
  in_progress: '--chart-2',
  blocked: '--chart-3',
  needs_review: '--chart-4',
  closed: '--chart-5',
};

interface IssueKanbanBoardProps {
  groupedIssues: Record<IssueStatus, Issue[]>;
  onDragEnd: (event: DragEndEvent) => void;
  onViewIssueDetails: (issue: Issue) => void;
  selectedIssue?: Issue;
  onCreateIssue?: (status?: IssueStatus) => void;
}

function IssueKanbanBoard({
  groupedIssues,
  onDragEnd,
  onViewIssueDetails,
  selectedIssue,
  onCreateIssue,
}: IssueKanbanBoardProps) {
  return (
    <KanbanProvider onDragEnd={onDragEnd}>
      {Object.entries(groupedIssues).map(([status, statusIssues]) => (
        <KanbanBoard key={status} id={status as IssueStatus}>
          <KanbanHeader
            name={statusLabels[status as IssueStatus]}
            color={statusColors[status as IssueStatus]}
            onAddIssue={
              onCreateIssue ? () => onCreateIssue(status as IssueStatus) : undefined
            }
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
      ))}
    </KanbanProvider>
  );
}

export default memo(IssueKanbanBoard);
