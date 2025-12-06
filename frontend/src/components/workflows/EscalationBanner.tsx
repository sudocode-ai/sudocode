/**
 * EscalationBanner - Compact banner for pending escalation notifications
 *
 * Displays a sticky banner at the top of workflow pages when
 * the orchestrator has a pending escalation request.
 */

import { AlertTriangle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// =============================================================================
// Types
// =============================================================================

export interface EscalationBannerProps {
  /** The workflow ID with pending escalation */
  workflowId: string
  /** The workflow title for display */
  workflowTitle: string
  /** The escalation message (truncated) */
  message: string
  /** Callback when user clicks to respond */
  onRespond?: () => void
  /** Additional class name */
  className?: string
}

// =============================================================================
// Component
// =============================================================================

export function EscalationBanner({
  workflowTitle,
  message,
  onRespond,
  className,
}: EscalationBannerProps) {
  // Truncate long messages
  const truncatedMessage = message.length > 80 ? message.slice(0, 77) + '...' : message

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-md',
        'bg-yellow-500/10 border border-yellow-500/30',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-yellow-800 dark:text-yellow-200">
            Workflow "{workflowTitle}" needs your input
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          "{truncatedMessage}"
        </p>
      </div>

      {onRespond && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRespond}
          className="shrink-0 border-yellow-500/50 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/10"
        >
          Respond
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      )}
    </div>
  )
}

export default EscalationBanner
