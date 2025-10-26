import { useCallback, useEffect, useRef } from 'react'
import { KanbanCard } from '@/components/ui/kanban'
import type { Issue } from '@sudocode/types'

// Priority badge colors - using darker shades for better contrast with white text
const priorityColors: Record<number, string> = {
  0: 'bg-red-600 dark:bg-red-700',
  1: 'bg-orange-600 dark:bg-orange-700',
  2: 'bg-yellow-600 dark:bg-yellow-700',
  3: 'bg-blue-600 dark:bg-blue-700',
  4: 'bg-gray-600 dark:bg-gray-700',
}

const priorityLabels: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'None',
}

interface IssueCardProps {
  issue: Issue
  index: number
  status: string
  onViewDetails: (issue: Issue) => void
  isOpen?: boolean
}

export function IssueCard({ issue, index, status, onViewDetails, isOpen }: IssueCardProps) {
  const handleClick = useCallback(() => {
    onViewDetails(issue)
  }, [issue, onViewDetails])

  const localRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen || !localRef.current) return
    const el = localRef.current
    requestAnimationFrame(() => {
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      })
    })
  }, [isOpen])

  return (
    <KanbanCard
      key={issue.id}
      id={issue.id}
      name={issue.title}
      index={index}
      parent={status}
      onClick={handleClick}
      isOpen={isOpen}
      forwardedRef={localRef}
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="flex w-full items-center gap-2">
          <h4 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{issue.title}</h4>
          {/* Priority Badge */}
          {issue.priority !== undefined && issue.priority <= 3 && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs text-white ${priorityColors[issue.priority]}`}
            >
              {priorityLabels[issue.priority]}
            </span>
          )}
        </div>
        {/* Issue ID */}
        <div className="text-xs text-muted-foreground">{issue.id}</div>
        {/* Description Preview */}
        {issue.description && (
          <p className="line-clamp-2 break-words text-sm text-secondary-foreground">
            {issue.description.length > 100
              ? `${issue.description.substring(0, 100)}...`
              : issue.description}
          </p>
        )}
      </div>
    </KanbanCard>
  )
}
