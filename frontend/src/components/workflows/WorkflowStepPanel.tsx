/**
 * WorkflowStepPanel - Side panel for displaying workflow step details
 * Shows step info, dependencies, execution link, and actions
 */

import {
  X,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertCircle,
  Circle,
  ExternalLink,
  RefreshCw,
  SkipForward,
  Square,
  GitBranch,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { WorkflowStep, WorkflowStepStatus } from '@/types/workflow'
import type { Issue } from '@/types/api'
import { STEP_STATUS_LABELS } from '@/types/workflow'

// =============================================================================
// Types
// =============================================================================

export interface WorkflowStepPanelProps {
  /** The workflow step to display */
  step: WorkflowStep
  /** Optional issue data for enriched display */
  issue?: Issue
  /** All steps in workflow for dependency resolution */
  allSteps?: WorkflowStep[]
  /** Callback when panel is closed */
  onClose?: () => void
  /** Callback to retry a failed step */
  onRetry?: () => void
  /** Callback to skip a step */
  onSkip?: () => void
  /** Callback to cancel a running step */
  onCancel?: () => void
  /** Callback to view execution details */
  onViewExecution?: () => void
  /** Callback when a dependency is clicked */
  onDependencyClick?: (stepId: string) => void
  /** Additional class name */
  className?: string
}

// =============================================================================
// Status Configuration
// =============================================================================

const STATUS_CONFIG: Record<
  WorkflowStepStatus,
  {
    icon: typeof Clock
    iconClass: string
    bgClass: string
    textClass: string
  }
> = {
  pending: {
    icon: Clock,
    iconClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
  },
  ready: {
    icon: Circle,
    iconClass: 'text-blue-500 fill-blue-500/20',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  running: {
    icon: Loader2,
    iconClass: 'text-blue-500 animate-spin',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  completed: {
    icon: CheckCircle2,
    iconClass: 'text-green-500',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-700 dark:text-green-300',
  },
  failed: {
    icon: XCircle,
    iconClass: 'text-destructive',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-destructive',
  },
  skipped: {
    icon: MinusCircle,
    iconClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
  },
  blocked: {
    icon: AlertCircle,
    iconClass: 'text-yellow-500',
    bgClass: 'bg-yellow-100 dark:bg-yellow-900/30',
    textClass: 'text-yellow-700 dark:text-yellow-300',
  },
}

// =============================================================================
// Subcomponents
// =============================================================================

interface StatusDisplayProps {
  status: WorkflowStepStatus
}

function StatusDisplay({ status }: StatusDisplayProps) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  const label = STEP_STATUS_LABELS[status]

  return (
    <div className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5', config.bgClass)}>
      <Icon className={cn('h-4 w-4', config.iconClass)} />
      <span className={cn('text-sm font-medium', config.textClass)}>{label}</span>
    </div>
  )
}

interface SectionProps {
  title: string
  children: React.ReactNode
  className?: string
}

function Section({ title, children, className }: SectionProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function WorkflowStepPanel({
  step,
  issue,
  allSteps = [],
  onClose,
  onRetry,
  onSkip,
  onCancel,
  onViewExecution,
  onDependencyClick,
  className,
}: WorkflowStepPanelProps) {
  // Get title from issue or fallback
  const title = issue?.title || `Step ${step.index + 1}`

  // Resolve dependencies to steps
  const dependencies = step.dependencies
    .map((depId) => {
      const depStep = allSteps.find((s) => s.id === depId)
      return depStep
    })
    .filter((s): s is WorkflowStep => s !== undefined)

  // Determine which actions are available
  const canRetry = step.status === 'failed' || step.status === 'skipped'
  const canSkip = ['pending', 'blocked', 'failed'].includes(step.status)
  const canCancel = step.status === 'running'
  const hasExecution = !!step.executionId
  const hasFailed = step.status === 'failed' && step.error
  const hasActions = (canRetry && onRetry) || (canSkip && onSkip) || (canCancel && onCancel)

  return (
    <div className={cn('flex h-full flex-col bg-background border-l', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 border-b">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span className="font-mono font-medium">{step.issueId}</span>
            {step.agentType && (
              <>
                <span>•</span>
                <span className="rounded bg-muted px-1.5 py-0.5">{step.agentType}</span>
              </>
            )}
          </div>
          <h3 className="font-semibold text-lg leading-tight">{title}</h3>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Status */}
          <Section title="Status">
            <StatusDisplay status={step.status} />
          </Section>

          {/* Description */}
          {issue?.content && (
            <Section title="Description">
              <div className="text-sm text-muted-foreground leading-relaxed">
                {issue.content.length > 300
                  ? issue.content.slice(0, 300) + '...'
                  : issue.content}
              </div>
            </Section>
          )}

          {/* Dependencies */}
          {dependencies.length > 0 && (
            <Section title="Dependencies">
              <div className="space-y-1.5">
                {dependencies.map((dep) => (
                  <button
                    key={dep.id}
                    onClick={() => onDependencyClick?.(dep.id)}
                    className={cn(
                      'flex items-center gap-2 w-full rounded-md px-3 py-2 text-left text-sm',
                      'hover:bg-muted transition-colors',
                      onDependencyClick && 'cursor-pointer'
                    )}
                    disabled={!onDependencyClick}
                  >
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-mono text-xs">{dep.issueId}</span>
                    <span className="truncate flex-1 text-muted-foreground">
                      {allSteps.find((s) => s.id === dep.id)
                        ? `Step ${dep.index + 1}`
                        : dep.id}
                    </span>
                    <StatusDisplay status={dep.status} />
                    {onDependencyClick && (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Execution Link */}
          {hasExecution && (
            <Section title="Execution">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={onViewExecution}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Execution
                <span className="ml-auto text-xs text-muted-foreground font-mono">
                  {step.executionId?.slice(0, 8)}...
                </span>
              </Button>
            </Section>
          )}

          {/* Git Commit */}
          {step.commitSha && (
            <Section title="Commit">
              <div className="flex items-center gap-2 text-sm">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                  {step.commitSha.slice(0, 7)}
                </code>
              </div>
            </Section>
          )}

          {/* Error */}
          {hasFailed && (
            <Section title="Error">
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive">{step.error}</p>
                </div>
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      {hasActions && (
        <>
          <Separator />
          <div className="p-4 flex items-center justify-end gap-2">
            {canSkip && onSkip && (
              <Button variant="outline" size="sm" onClick={onSkip}>
                <SkipForward className="h-3.5 w-3.5 mr-1.5" />
                Skip
              </Button>
            )}
            {canRetry && onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            )}
            {canCancel && onCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="text-destructive hover:text-destructive"
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default WorkflowStepPanel
