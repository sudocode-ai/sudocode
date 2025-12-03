/**
 * WorkflowStepNode - Custom React Flow node for workflow steps
 * Displays step status, issue info, and provides interactive selection
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Clock,
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { WorkflowStep } from '@/types/workflow'
import type { Issue } from '@/types/api'
import { STEP_STATUS_STYLES, STEP_STATUS_LABELS } from '@/types/workflow'

// =============================================================================
// Types
// =============================================================================

export interface WorkflowStepNodeData {
  step: WorkflowStep
  issue?: Issue
  isSelected?: boolean
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate duration from timestamps or return elapsed time for running steps
 */
function getStepDuration(step: WorkflowStep): string | null {
  // For now, we don't have start/end timestamps on steps
  // This would need to be added to the WorkflowStep type
  // Return null to indicate no duration available
  if (step.status === 'running') {
    return 'running...'
  }
  if (step.status === 'completed' && step.executionId) {
    return 'done'
  }
  return null
}

// =============================================================================
// Status Icon Component
// =============================================================================

interface StatusIconProps {
  status: WorkflowStep['status']
  className?: string
}

function StatusIcon({ status, className }: StatusIconProps) {
  const iconClass = cn('h-4 w-4', className)

  switch (status) {
    case 'pending':
      return <Clock className={cn(iconClass, 'text-muted-foreground')} />
    case 'ready':
      return <Circle className={cn(iconClass, 'text-blue-500 fill-blue-500/20')} />
    case 'running':
      return <Loader2 className={cn(iconClass, 'text-blue-500 animate-spin')} />
    case 'completed':
      return <CheckCircle2 className={cn(iconClass, 'text-green-500')} />
    case 'failed':
      return <XCircle className={cn(iconClass, 'text-destructive')} />
    case 'skipped':
      return <MinusCircle className={cn(iconClass, 'text-muted-foreground')} />
    case 'blocked':
      return <AlertCircle className={cn(iconClass, 'text-yellow-500')} />
    default:
      return <Circle className={cn(iconClass, 'text-muted-foreground')} />
  }
}

// =============================================================================
// Status Badge Component
// =============================================================================

function StatusBadge({ status }: { status: WorkflowStep['status'] }) {
  const label = STEP_STATUS_LABELS[status] || status

  const badgeStyles: Record<WorkflowStep['status'], string> = {
    pending: 'bg-muted text-muted-foreground',
    ready: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    skipped: 'bg-muted text-muted-foreground',
    blocked: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        badgeStyles[status]
      )}
    >
      {label}
    </span>
  )
}

// =============================================================================
// Main Component
// =============================================================================

function WorkflowStepNodeComponent({ data }: NodeProps) {
  // Cast data to our expected type
  const nodeData = data as unknown as WorkflowStepNodeData
  const { step, issue, isSelected } = nodeData
  const styles = STEP_STATUS_STYLES[step.status] || STEP_STATUS_STYLES.pending

  // Get title and truncate if needed
  const title = issue?.title || `Step ${step.index + 1}`
  const needsTruncation = title.length > 32
  const displayTitle = needsTruncation ? `${title.slice(0, 32)}...` : title

  // Get duration
  const duration = getStepDuration(step)

  // Build tooltip content
  const tooltipContent = (
    <div className="max-w-[300px] space-y-1">
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{step.issueId}</span>
        {step.agentType && <span> • {step.agentType}</span>}
      </div>
      {issue?.content && (
        <div className="text-xs text-muted-foreground line-clamp-2">
          {issue.content.slice(0, 150)}
          {issue.content.length > 150 && '...'}
        </div>
      )}
      {step.error && (
        <div className="text-xs text-destructive">{step.error}</div>
      )}
    </div>
  )

  return (
    <TooltipProvider delayDuration={300}>
      {/* Input handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-background !rounded-full transition-colors',
          step.status === 'completed'
            ? '!bg-green-500'
            : step.status === 'running'
              ? '!bg-blue-500'
              : '!bg-muted-foreground'
        )}
      />

      {/* Node content */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'rounded-lg border-2 bg-background p-3 shadow-sm',
              'min-w-[220px] max-w-[280px]',
              'transition-all duration-150',
              'hover:shadow-md hover:scale-[1.02]',
              'cursor-pointer',
              styles.border,
              styles.background,
              isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
            )}
          >
            {/* Header: Status icon + Issue ID + Status badge */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <StatusIcon status={step.status} />
                <span className="font-mono font-medium">{step.issueId}</span>
              </div>
              <StatusBadge status={step.status} />
            </div>

            {/* Divider */}
            <div className="my-2 border-t border-border/50" />

            {/* Title */}
            <div
              className={cn(
                'text-sm font-medium leading-tight',
                styles.text,
                step.status === 'skipped' && 'line-through opacity-60'
              )}
            >
              {displayTitle}
            </div>

            {/* Footer: Agent + Duration */}
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                {step.agentType && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                    {step.agentType}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {duration && (
                  <span
                    className={cn(
                      step.status === 'running' && 'text-blue-500 animate-pulse'
                    )}
                  >
                    {duration}
                  </span>
                )}
                {step.executionId && (
                  <ExternalLink className="h-3 w-3 opacity-50" />
                )}
              </div>
            </div>

            {/* Error indicator (if failed) */}
            {step.status === 'failed' && step.error && (
              <div className="mt-2 flex items-start gap-1.5 rounded bg-destructive/10 p-2 text-xs text-destructive">
                <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="line-clamp-2">{step.error}</span>
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="max-w-[320px]">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>

      {/* Output handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-background !rounded-full transition-colors',
          step.status === 'completed'
            ? '!bg-green-500'
            : step.status === 'running'
              ? '!bg-blue-500'
              : '!bg-muted-foreground'
        )}
      />
    </TooltipProvider>
  )
}

export const WorkflowStepNode = memo(WorkflowStepNodeComponent)
