/**
 * WorkflowCard - Card component for displaying workflows in list view
 * Shows workflow status, progress, and provides action buttons
 */

import { formatDistanceToNow } from 'date-fns'
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  PauseCircle,
  StopCircle,
  Play,
  Pause,
  Square,
  Trash2,
  MoreVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Workflow, WorkflowStatus } from '@/types/workflow'

// =============================================================================
// Types
// =============================================================================

export interface WorkflowCardProps {
  /** The workflow to display */
  workflow: Workflow
  /** Callback when card is clicked/selected */
  onSelect?: () => void
  /** Callback to pause a running workflow */
  onPause?: () => void
  /** Callback to resume a paused workflow */
  onResume?: () => void
  /** Callback to cancel a workflow */
  onCancel?: () => void
  /** Callback to delete a workflow */
  onDelete?: () => void
  /** Additional class name */
  className?: string
}

// =============================================================================
// Status Utilities
// =============================================================================

const STATUS_CONFIG: Record<
  WorkflowStatus,
  {
    icon: typeof Clock
    label: string
    badgeClass: string
    iconClass: string
  }
> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    badgeClass: 'bg-muted text-muted-foreground',
    iconClass: 'text-muted-foreground',
  },
  running: {
    icon: Loader2,
    label: 'Running',
    badgeClass: 'bg-blue-500 text-white',
    iconClass: 'text-blue-500 animate-spin',
  },
  paused: {
    icon: PauseCircle,
    label: 'Paused',
    badgeClass: 'bg-yellow-500 text-white',
    iconClass: 'text-yellow-500',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    badgeClass: 'bg-green-500 text-white',
    iconClass: 'text-green-500',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    badgeClass: 'bg-destructive text-destructive-foreground',
    iconClass: 'text-destructive',
  },
  cancelled: {
    icon: StopCircle,
    label: 'Cancelled',
    badgeClass: 'bg-muted text-muted-foreground',
    iconClass: 'text-muted-foreground',
  },
}

// =============================================================================
// Subcomponents
// =============================================================================

interface StatusBadgeProps {
  status: WorkflowStatus
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        config.badgeClass
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', status === 'running' && 'animate-spin')} />
      {config.label}
    </div>
  )
}

interface ProgressIndicatorProps {
  completed: number
  total: number
}

function ProgressIndicator({ completed, total }: ProgressIndicatorProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="flex items-center gap-3">
      {/* Progress dots */}
      <div className="flex items-center gap-1">
        {Array.from({ length: Math.min(total, 10) }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-2 w-2 rounded-full transition-colors',
              i < completed
                ? 'bg-green-500'
                : i === completed
                  ? 'bg-blue-500 animate-pulse'
                  : 'bg-muted'
            )}
          />
        ))}
        {total > 10 && (
          <span className="text-xs text-muted-foreground ml-1">...</span>
        )}
      </div>

      {/* Text progress */}
      <span className="text-sm text-muted-foreground">
        {completed}/{total} steps ({percentage}%)
      </span>
    </div>
  )
}

// =============================================================================
// Source Display
// =============================================================================

function getSourceDisplay(workflow: Workflow): string {
  const { source } = workflow
  switch (source.type) {
    case 'spec':
      return `Spec: ${source.specId}`
    case 'issues':
      return `${source.issueIds.length} issues`
    case 'root_issue':
      return `From: ${source.issueId}`
    case 'goal':
      return source.goal.slice(0, 50) + (source.goal.length > 50 ? '...' : '')
    default:
      return 'Unknown source'
  }
}

// =============================================================================
// Main Component
// =============================================================================

export function WorkflowCard({
  workflow,
  onSelect,
  onPause,
  onResume,
  onCancel,
  onDelete,
  className,
}: WorkflowCardProps) {
  const { status, steps, config, createdAt, updatedAt } = workflow

  // Calculate progress
  const completedSteps = steps.filter((s) => s.status === 'completed').length
  const totalSteps = steps.length

  // Get running step if any
  const runningStep = steps.find((s) => s.status === 'running')

  // Determine which actions to show
  const showPause = status === 'running' && onPause
  const showResume = status === 'paused' && onResume
  const showCancel = (status === 'running' || status === 'paused') && onCancel
  const canDelete = onDelete // Delete is available for any workflow
  const hasFooterActions = showPause || showResume || showCancel

  // Format timestamps
  const timeAgo = formatDistanceToNow(new Date(updatedAt || createdAt), {
    addSuffix: true,
  })

  return (
    <Card
      className={cn(
        'border border-border transition-all duration-150 hover:bg-accent/50 hover:shadow-md',
        onSelect && 'cursor-pointer hover:border-primary/50',
        className
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">
              {workflow.source.type === 'goal'
                ? workflow.source.goal.slice(0, 40)
                : `Workflow ${workflow.id.slice(0, 8)}`}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {getSourceDisplay(workflow)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {canDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete()
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-3 space-y-3">
        {/* Progress */}
        <ProgressIndicator completed={completedSteps} total={totalSteps} />

        {/* Current step indicator */}
        {runningStep && (
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="truncate">Running: {runningStep.issueId}</span>
          </div>
        )}

        {/* Meta info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">Agent:</span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              {config?.defaultAgentType || 'claude-code'}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
        </div>
      </CardContent>

      {/* Actions for running/paused workflows */}
      {hasFooterActions && (
        <CardFooter className="pt-0 border-t">
          <div className="flex items-center justify-end gap-2 w-full pt-3">
            {showPause && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onPause()
                }}
              >
                <Pause className="h-3.5 w-3.5 mr-1.5" />
                Pause
              </Button>
            )}
            {showResume && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onResume()
                }}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Resume
              </Button>
            )}
            {showCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onCancel()
                }}
                className="text-destructive hover:text-destructive"
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  )
}

export default WorkflowCard
