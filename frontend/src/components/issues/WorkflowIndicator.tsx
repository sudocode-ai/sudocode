/**
 * WorkflowIndicator - Shows workflow membership on issue cards
 * Displays a badge indicating the issue is part of an active workflow
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Clock, CheckCircle2, XCircle, SkipForward, Lock } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WorkflowStepStatus } from '@/types/workflow'
import { getColorFromId } from '@/utils/colors'

export interface WorkflowIndicatorProps {
  /** ID of the workflow */
  workflowId: string
  /** Title of the workflow (for tooltip) */
  workflowTitle?: string
  /** Status of this issue's step within the workflow */
  stepStatus: WorkflowStepStatus
  /** Click handler (defaults to navigation) */
  onClick?: () => void
  /** Optional className */
  className?: string
}

// Status configuration
const STATUS_CONFIG: Record<
  WorkflowStepStatus,
  {
    icon: typeof Loader2
    color: string
    bgColor: string
    label: string
  }
> = {
  pending: {
    icon: Clock,
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    label: 'Pending',
  },
  ready: {
    icon: Clock,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900',
    label: 'Ready',
  },
  running: {
    icon: Loader2,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900',
    label: 'Running',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-100 dark:bg-green-900',
    label: 'Completed',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-100 dark:bg-red-900',
    label: 'Failed',
  },
  skipped: {
    icon: SkipForward,
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    label: 'Skipped',
  },
  blocked: {
    icon: Lock,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900',
    label: 'Blocked',
  },
}

// Statuses that should use the workflow color instead of hardcoded colors
const WORKFLOW_COLOR_STATUSES: Set<WorkflowStepStatus> = new Set(['running', 'completed'])

export function WorkflowIndicator({
  workflowId,
  workflowTitle,
  stepStatus,
  onClick,
  className,
}: WorkflowIndicatorProps) {
  const navigate = useNavigate()
  const config = STATUS_CONFIG[stepStatus]
  const Icon = config.icon

  // Compute workflow-based color style for running/completed statuses
  const workflowColorStyle = useMemo(() => {
    if (!WORKFLOW_COLOR_STATUSES.has(stepStatus)) return undefined
    const color = getColorFromId(workflowId)
    return {
      backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
      color: color,
    }
  }, [workflowId, stepStatus])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click
    if (onClick) {
      onClick()
    } else {
      navigate(`/workflows/${workflowId}`)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80',
              // Only apply default colors if not using workflow color
              !workflowColorStyle && config.bgColor,
              !workflowColorStyle && config.color,
              className
            )}
            style={workflowColorStyle}
          >
            <Icon
              className={cn('h-3 w-3', stepStatus === 'running' && 'animate-spin')}
            />
            <span className="hidden sm:inline">{config.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <p className="font-medium">{workflowTitle || 'Workflow'}</p>
            <p className="text-muted-foreground">Step: {config.label}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
