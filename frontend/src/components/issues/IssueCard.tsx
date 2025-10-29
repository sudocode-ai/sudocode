import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
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
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
}

interface IssueCardProps {
  issue: Issue
  index: number
  status: string
  onViewDetails?: (issue: Issue) => void
  isOpen?: boolean
}

export function IssueCard({ issue, index, status, onViewDetails, isOpen }: IssueCardProps) {
  const navigate = useNavigate()

  const handleClick = useCallback(() => {
    // If onViewDetails is provided, use it (for backward compatibility)
    // Otherwise, navigate to the detail page
    if (onViewDetails) {
      onViewDetails(issue)
    } else {
      navigate(`/issues/${issue.id}`)
    }
  }, [issue, onViewDetails, navigate])

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
      className={issue.archived ? 'opacity-60' : ''}
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">{issue.id}</div>
          {/* Priority Badge */}
          {issue.priority !== undefined && issue.priority <= 3 && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs text-white ${priorityColors[issue.priority]}`}
            >
              {priorityLabels[issue.priority]}
            </span>
          )}
        </div>
        <h4 className="text-md line-clamp-2 min-w-0 flex-1 font-medium">{issue.title}</h4>
        {/* Content Preview */}
        {issue.content && (
          <p className="line-clamp-2 break-words text-xs text-muted-foreground">
            {(() => {
              // Simple markdown stripping - remove headers, formatting, etc.
              const plainText = issue.content
                .replace(/^#+ /gm, '') // Remove headers
                .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
                .replace(/\*(.+?)\*/g, '$1') // Remove italic
                .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
                .replace(/`(.+?)`/g, '$1') // Remove inline code
                .trim()

              return plainText.length > 100 ? `${plainText.substring(0, 100)}...` : plainText
            })()}
          </p>
        )}
      </div>
    </KanbanCard>
  )
}
