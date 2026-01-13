/**
 * QueueEntryCard - Display a single queue entry
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  GripVertical,
  GitMerge,
  Clock,
  AlertCircle,
  Check,
  X,
  ChevronRight,
  Link2,
} from 'lucide-react'
import type { EnrichedQueueEntry, QueueStatus } from '@/types/queue'

interface QueueEntryCardProps {
  entry: EnrichedQueueEntry
  /** Allow drag-and-drop reordering */
  isDraggable?: boolean
  /** Called when promote button clicked */
  onPromote?: () => void
}

/**
 * Get badge styling for queue status
 */
function getStatusBadge(status: QueueStatus) {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
        icon: Clock,
      }
    case 'ready':
      return {
        label: 'Ready',
        className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        icon: Check,
      }
    case 'merging':
      return {
        label: 'Merging',
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        icon: GitMerge,
      }
    case 'merged':
      return {
        label: 'Merged',
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
        icon: GitMerge,
      }
    case 'failed':
      return {
        label: 'Failed',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        icon: X,
      }
    case 'cancelled':
      return {
        label: 'Cancelled',
        className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
        icon: X,
      }
    default:
      return {
        label: status,
        className: '',
        icon: AlertCircle,
      }
  }
}

export function QueueEntryCard({ entry, isDraggable = false, onPromote }: QueueEntryCardProps) {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled: !isDraggable })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const statusBadge = getStatusBadge(entry.status)
  const StatusIcon = statusBadge.icon
  const hasDependencies = entry.dependencies.length > 0

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`
          relative rounded-md border bg-card p-3 transition-colors
          ${isDragging ? 'border-primary shadow-md' : 'hover:border-primary/50'}
          ${entry.status === 'merged' ? 'opacity-60' : ''}
        `}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          {isDraggable && (
            <button
              className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}

          {/* Position indicator */}
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {entry.position}
          </div>

          {/* Entry content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <button
                className="flex items-center gap-2 text-left hover:underline"
                onClick={() => navigate(paths.issue(entry.issueId))}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.issueId}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>

              {/* Status badge */}
              <Badge className={statusBadge.className}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {statusBadge.label}
              </Badge>
            </div>

            {/* Issue title */}
            <p className="mt-1 truncate text-sm font-medium">{entry.issueTitle}</p>

            {/* Stack info */}
            {entry.stackName && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stack: {entry.stackName} (depth {entry.stackDepth})
              </p>
            )}

            {/* Dependencies indicator */}
            {hasDependencies && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Link2 className="h-3 w-3" />
                <span>Depends on: {entry.dependencies.join(', ')}</span>
              </div>
            )}

            {/* Actions */}
            {entry.canPromote && onPromote && (
              <div className="mt-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPromote()
                      }}
                    >
                      <GitMerge className="mr-1 h-3 w-3" />
                      Promote
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Merge this checkpoint to main</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* Error message */}
        {entry.error && (
          <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {entry.error}
          </div>
        )}
      </div>
    </div>
  )
}
