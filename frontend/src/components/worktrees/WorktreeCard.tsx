import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EntityBadge } from '@/components/entities/EntityBadge'
import {
  GitBranch,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  PauseCircle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Execution } from '@/types/execution'
import { cn } from '@/lib/utils'

interface WorktreeCardProps {
  execution: Execution
  isSelected?: boolean
  onClick?: () => void
}

/**
 * Render status icon with tooltip for execution
 */
function renderStatusIcon(status: Execution['status']) {
  const getStatusConfig = () => {
    switch (status) {
      case 'preparing':
        return {
          icon: <Clock className="h-4 w-4 text-muted-foreground" />,
          label: 'Preparing',
        }
      case 'pending':
        return {
          icon: <Clock className="h-4 w-4 text-muted-foreground" />,
          label: 'Pending',
        }
      case 'running':
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin text-blue-600" />,
          label: 'Running',
        }
      case 'paused':
        return {
          icon: <PauseCircle className="h-4 w-4 text-muted-foreground" />,
          label: 'Paused',
        }
      case 'completed':
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
          label: 'Completed',
        }
      case 'failed':
        return {
          icon: <XCircle className="h-4 w-4 text-destructive" />,
          label: 'Failed',
        }
      case 'cancelled':
        return {
          icon: <X className="h-4 w-4 text-muted-foreground" />,
          label: 'Cancelled',
        }
      case 'stopped':
        return {
          icon: <X className="h-4 w-4 text-muted-foreground" />,
          label: 'Stopped',
        }
      default:
        return {
          icon: <AlertCircle className="h-4 w-4 text-muted-foreground" />,
          label: String(status).charAt(0).toUpperCase() + String(status).slice(1),
        }
    }
  }

  const { icon, label } = getStatusConfig()

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center">{icon}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function WorktreeCard({ execution, isSelected, onClick }: WorktreeCardProps) {
  return (
    <Card
      className={cn(
        'group cursor-pointer border border-border transition-all hover:bg-accent/50 hover:shadow-md',
        isSelected && 'ring-2 ring-primary'
      )}
      onClick={onClick}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Branch Name - Primary identifier */}
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-base font-semibold">{execution.branch_name}</span>
        </div>

        {/* Worktree Path - truncated */}
        {execution.worktree_path && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate font-mono">{execution.worktree_path}</span>
          </div>
        )}

        {/* Execution Info - Inline: ID, Issue Badge, Status Icon */}
        <div className="flex flex-col border-t pt-3">
          <div className="flex items-center gap-2">
            <Link
              to={`/executions/${execution.id}`}
              className="min-w-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {execution.id}
            </Link>

            {/* Issue badge if available */}
            {execution.issue_id && (
              <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <EntityBadge
                  entityId={execution.issue_id}
                  entityType="issue"
                  showHoverCard={true}
                  linkToEntity={true}
                  className="text-xs"
                />
              </div>
            )}

            {/* Status icon */}
            <div className="flex-shrink-0">{renderStatusIcon(execution.status)}</div>
          </div>

          {/* Last Updated - on second line */}
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(execution.updated_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </Card>
  )
}
