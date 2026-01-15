/**
 * StackPanel - Display a stack of related issues
 *
 * Shows issue order (depth=0 at top/leaf), checkpoint status,
 * promotion status, and stack health indicator.
 */

import { useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Layers,
  MoreVertical,
  ArrowDown,
  GripVertical,
  GitMerge,
  Check,
  Clock,
  AlertCircle,
  X,
  FileText,
} from 'lucide-react'
import type { StackInfo, StackEntry, StackHealth } from '@/types/stack'
import type { CheckpointReviewStatus } from '@/types/execution'

interface StackPanelProps {
  stackInfo: StackInfo
  onReorder?: (issueOrder: string[]) => void
  onPromote?: (issueId: string) => void
  onRemove?: (issueId: string) => void
  /** Show edit controls for manual stacks */
  isManual?: boolean
  /** Issue titles map for displaying titles instead of just IDs */
  issueTitles?: Record<string, string>
}

/**
 * Get badge styling for stack health
 */
function getHealthBadge(health: StackHealth) {
  switch (health) {
    case 'ready':
      return {
        label: 'Ready',
        className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        icon: Check,
      }
    case 'pending':
      return {
        label: 'Pending Review',
        className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
        icon: Clock,
      }
    case 'blocked':
      return {
        label: 'Blocked',
        className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
        icon: AlertCircle,
      }
    case 'conflicts':
      return {
        label: 'Conflicts',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        icon: X,
      }
    default:
      return {
        label: health,
        className: '',
        icon: AlertCircle,
      }
  }
}

/**
 * Get badge styling for checkpoint review status
 */
function getReviewStatusBadge(status: CheckpointReviewStatus | undefined) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      }
    case 'pending':
      return {
        label: 'Pending',
        className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      }
    case 'rejected':
      return {
        label: 'Rejected',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      }
    case 'merged':
      return {
        label: 'Merged',
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      }
    default:
      return null
  }
}

/**
 * Single sortable entry in the stack
 */
interface SortableEntryProps {
  entry: StackEntry
  isManual?: boolean
  isFirst: boolean
  issueTitle?: string
  onNavigate: () => void
  onPromote?: () => void
  onRemove?: () => void
}

function SortableEntry({
  entry,
  isManual,
  isFirst,
  issueTitle,
  onNavigate,
  onPromote,
  onRemove,
}: SortableEntryProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.issue_id, disabled: !isManual })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const reviewBadge = getReviewStatusBadge(entry.checkpoint_status)
  const canPromote = entry.has_checkpoint && entry.checkpoint_status === 'approved' && !entry.is_promoted

  return (
    <div ref={setNodeRef} style={style}>
      {/* Dependency arrow (except for first item) */}
      {!isFirst && (
        <div className="flex justify-center py-1">
          <div className="flex flex-col items-center text-muted-foreground">
            <ArrowDown className="h-4 w-4" />
            <span className="text-[10px]">depends on</span>
          </div>
        </div>
      )}

      {/* Entry card */}
      <div
        className={`
          relative rounded-md border bg-card p-3 transition-colors
          ${isDragging ? 'border-primary shadow-md' : 'hover:border-primary/50'}
          ${entry.is_promoted ? 'opacity-60' : ''}
        `}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle for manual stacks */}
          {isManual && (
            <button
              className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}

          {/* Entry content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <button
                className="flex items-center gap-2 text-left hover:underline"
                onClick={onNavigate}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.issue_id}
                </span>
              </button>

              {/* Status badges */}
              <div className="flex items-center gap-1">
                {entry.is_promoted && (
                  <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                    <GitMerge className="mr-1 h-3 w-3" />
                    Merged
                  </Badge>
                )}
                {entry.has_checkpoint && reviewBadge && !entry.is_promoted && (
                  <Badge className={reviewBadge.className}>
                    {reviewBadge.label}
                  </Badge>
                )}
                {!entry.has_checkpoint && !entry.is_promoted && (
                  <Badge variant="outline" className="text-muted-foreground">
                    No checkpoint
                  </Badge>
                )}
              </div>
            </div>

            {/* Issue title if available */}
            {issueTitle && (
              <p className="mt-1 truncate text-sm">{issueTitle}</p>
            )}

            {/* Actions */}
            {(canPromote || (isManual && onRemove)) && (
              <div className="mt-2 flex items-center gap-2">
                {canPromote && onPromote && (
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
                )}
                {isManual && onRemove && !entry.is_promoted && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove()
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Depth indicator */}
        <div className="absolute -left-2 top-1/2 -translate-y-1/2">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {entry.depth}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * StackPanel component
 */
export function StackPanel({
  stackInfo,
  onReorder,
  onPromote,
  onRemove,
  isManual,
  issueTitles = {},
}: StackPanelProps) {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const { stack, entries, health } = stackInfo

  // Local state for drag-and-drop reordering
  const [localOrder, setLocalOrder] = useState<string[]>(
    entries.map((e) => e.issue_id)
  )

  // Re-sync local order when entries change
  useMemo(() => {
    setLocalOrder(entries.map((e) => e.issue_id))
  }, [entries])

  // Sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = localOrder.indexOf(active.id as string)
      const newIndex = localOrder.indexOf(over.id as string)
      const newOrder = arrayMove(localOrder, oldIndex, newIndex)
      setLocalOrder(newOrder)
      onReorder?.(newOrder)
    }
  }

  // Get entries in display order (depth=0 first)
  const sortedEntries = useMemo(() => {
    const entryMap = new Map(entries.map((e) => [e.issue_id, e]))
    return localOrder
      .map((id) => entryMap.get(id))
      .filter((e): e is StackEntry => e !== undefined)
  }, [entries, localOrder])

  const healthBadge = getHealthBadge(health)
  const HealthIcon = healthBadge.icon

  return (
    <TooltipProvider>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              {stack.name || `Stack ${stack.id}`}
              {stack.is_auto && (
                <Badge variant="outline" className="text-xs">
                  Auto
                </Badge>
              )}
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    // Navigate to first issue in stack
                    if (entries[0]) {
                      navigate(paths.issue(entries[0].issue_id))
                    }
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={healthBadge.className}>
              <HealthIcon className="mr-1 h-3 w-3" />
              {healthBadge.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {entries.length} issue{entries.length !== 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Layers className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No issues in this stack
              </p>
            </div>
          ) : isManual ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={localOrder}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0">
                  {sortedEntries.map((entry, index) => (
                    <SortableEntry
                      key={entry.issue_id}
                      entry={entry}
                      isManual={isManual}
                      isFirst={index === 0}
                      issueTitle={issueTitles[entry.issue_id]}
                      onNavigate={() => navigate(paths.issue(entry.issue_id))}
                      onPromote={onPromote ? () => onPromote(entry.issue_id) : undefined}
                      onRemove={onRemove ? () => onRemove(entry.issue_id) : undefined}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="space-y-0">
              {sortedEntries.map((entry, index) => (
                <SortableEntry
                  key={entry.issue_id}
                  entry={entry}
                  isManual={false}
                  isFirst={index === 0}
                  issueTitle={issueTitles[entry.issue_id]}
                  onNavigate={() => navigate(paths.issue(entry.issue_id))}
                  onPromote={onPromote ? () => onPromote(entry.issue_id) : undefined}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
