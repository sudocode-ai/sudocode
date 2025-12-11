/**
 * WorkflowControls - Reusable control buttons for workflow actions
 * Shows appropriate buttons based on workflow status
 */

import { Pause, Play, Square, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Workflow } from '@/types/workflow'
import { cn } from '@/lib/utils'

export interface WorkflowControlsProps {
  workflow: Workflow
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
  size?: 'sm' | 'default'
  showLabels?: boolean
  isStarting?: boolean
  isPausing?: boolean
  isResuming?: boolean
  isCancelling?: boolean
  className?: string
}

export function WorkflowControls({
  workflow,
  onStart,
  onPause,
  onResume,
  onCancel,
  size = 'default',
  showLabels = true,
  isStarting = false,
  isPausing = false,
  isResuming = false,
  isCancelling = false,
  className,
}: WorkflowControlsProps) {
  const { status } = workflow

  // Determine which buttons to show based on status
  const showStart = status === 'pending' && onStart
  const showPause = status === 'running' && onPause
  const showResume = status === 'paused' && onResume
  const showCancel = ['pending', 'running', 'paused'].includes(status) && onCancel

  // No buttons to show
  if (!showStart && !showPause && !showResume && !showCancel) {
    return null
  }

  const buttonSize = size === 'sm' ? 'sm' : 'default'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Start Button */}
      {showStart && (
        <Button
          variant="default"
          size={buttonSize}
          onClick={onStart}
          disabled={isStarting}
        >
          {isStarting ? (
            <Loader2 className={cn(iconSize, 'animate-spin', showLabels && 'mr-2')} />
          ) : (
            <Play className={cn(iconSize, showLabels && 'mr-2')} />
          )}
          {showLabels && (isStarting ? 'Starting...' : 'Start')}
        </Button>
      )}

      {/* Pause Button */}
      {showPause && (
        <Button
          variant="outline"
          size={buttonSize}
          onClick={onPause}
          disabled={isPausing}
        >
          {isPausing ? (
            <Loader2 className={cn(iconSize, 'animate-spin', showLabels && 'mr-2')} />
          ) : (
            <Pause className={cn(iconSize, showLabels && 'mr-2')} />
          )}
          {showLabels && (isPausing ? 'Pausing...' : 'Pause')}
        </Button>
      )}

      {/* Resume Button */}
      {showResume && (
        <Button
          variant="outline"
          size={buttonSize}
          onClick={onResume}
          disabled={isResuming}
        >
          {isResuming ? (
            <Loader2 className={cn(iconSize, 'animate-spin', showLabels && 'mr-2')} />
          ) : (
            <Play className={cn(iconSize, showLabels && 'mr-2')} />
          )}
          {showLabels && (isResuming ? 'Resuming...' : 'Resume')}
        </Button>
      )}

      {/* Cancel Button */}
      {showCancel && (
        <Button
          variant="outline"
          size={buttonSize}
          onClick={onCancel}
          disabled={isCancelling}
          className="text-destructive hover:text-destructive"
        >
          {isCancelling ? (
            <Loader2 className={cn(iconSize, 'animate-spin', showLabels && 'mr-2')} />
          ) : (
            <Square className={cn(iconSize, showLabels && 'mr-2')} />
          )}
          {showLabels && (isCancelling ? 'Cancelling...' : 'Cancel')}
        </Button>
      )}
    </div>
  )
}
