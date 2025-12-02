import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EntityBadge } from '@/components/entities/EntityBadge'
import type { Execution, ExecutionStatus } from '@/types/execution'
import type { WebSocketMessage } from '@/types/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import {
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  PauseCircle,
  ListIcon,
  ChevronLeft,
  GitBranch,
} from 'lucide-react'

export interface ExecutionsSidebarProps {
  /**
   * All executions to display in the sidebar
   */
  executions: Execution[]

  /**
   * Set of execution IDs currently visible in the grid
   */
  visibleExecutionIds: Set<string>

  /**
   * Callback when user toggles execution visibility
   */
  onToggleVisibility: (executionId: string) => void

  /**
   * Whether all executions are checked
   */
  allChecked: boolean

  /**
   * Callback to toggle all executions
   */
  onToggleAll: () => void

  /**
   * Whether the sidebar is collapsed
   */
  collapsed?: boolean

  /**
   * Callback to toggle sidebar collapse
   */
  onToggleCollapse?: () => void
}

/**
 * Render status icon with tooltip for execution (icon-only, more compact)
 */
function renderStatusIcon(status: ExecutionStatus) {
  const getStatusConfig = () => {
    switch (status) {
      case 'preparing':
        return {
          icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
          label: 'Preparing',
        }
      case 'pending':
        return {
          icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
          label: 'Pending',
        }
      case 'running':
        return {
          icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />,
          label: 'Running',
        }
      case 'paused':
        return {
          icon: <PauseCircle className="h-3.5 w-3.5 text-muted-foreground" />,
          label: 'Paused',
        }
      case 'completed':
        return {
          icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />,
          label: 'Completed',
        }
      case 'failed':
        return {
          icon: <XCircle className="h-3.5 w-3.5 text-destructive" />,
          label: 'Failed',
        }
      case 'cancelled':
        return {
          icon: <X className="h-3.5 w-3.5 text-muted-foreground" />,
          label: 'Cancelled',
        }
      case 'stopped':
        return {
          icon: <X className="h-3.5 w-3.5 text-muted-foreground" />,
          label: 'Stopped',
        }
      default:
        return {
          icon: <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />,
          label: String(status).charAt(0).toUpperCase() + String(status).slice(1),
        }
    }
  }

  const { icon, label } = getStatusConfig()

  return (
    <div className="flex items-center justify-center" title={label}>
      {icon}
    </div>
  )
}

/**
 * ExecutionsSidebar Component
 *
 * Displays a list of all executions with checkboxes to toggle visibility in the grid.
 * Supports real-time updates via WebSocket.
 */
export function ExecutionsSidebar({
  executions: initialExecutions,
  visibleExecutionIds,
  onToggleVisibility,
  allChecked,
  onToggleAll,
  onToggleCollapse,
}: ExecutionsSidebarProps) {
  const [executions, setExecutions] = useState<Execution[]>(initialExecutions)
  const { subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Update local state when prop changes
  useEffect(() => {
    setExecutions(initialExecutions)
  }, [initialExecutions])

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'execution_created' && message.data) {
      const newExecution = message.data as Execution
      setExecutions((prev) => {
        // Check if execution already exists
        if (prev.some((e) => e.id === newExecution.id)) {
          return prev
        }
        // Add to list and sort by created_at (newest first)
        return [newExecution, ...prev].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      })
    } else if (message.type === 'execution_updated' && message.data) {
      const updatedExecution = message.data as Execution
      setExecutions((prev) =>
        prev.map((e) => (e.id === updatedExecution.id ? updatedExecution : e))
      )
    } else if (message.type === 'execution_status_changed' && message.data) {
      const { executionId, status } = message.data as {
        executionId: string
        status: ExecutionStatus
      }
      setExecutions((prev) => prev.map((e) => (e.id === executionId ? { ...e, status } : e)))
    } else if (message.type === 'execution_deleted' && message.data) {
      const { executionId } = message.data as { executionId: string }
      setExecutions((prev) => prev.filter((e) => e.id !== executionId))
    }
  }, [])

  // Subscribe to WebSocket events on mount
  useEffect(() => {
    const handlerId = 'executions-sidebar'

    subscribe('execution')
    addMessageHandler(handlerId, handleWebSocketMessage)

    return () => {
      unsubscribe('execution')
      removeMessageHandler(handlerId)
    }
  }, [subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleWebSocketMessage])

  // Handle checkbox toggle
  const handleToggle = useCallback(
    (executionId: string) => {
      onToggleVisibility(executionId)
    },
    [onToggleVisibility]
  )

  // Empty state
  if (executions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox checked={allChecked} onCheckedChange={onToggleAll} className="h-4 w-4" />
              <span className="text-sm text-muted-foreground">All</span>
            </div>
            {onToggleCollapse && (
              <Button variant="ghost" size="sm" onClick={onToggleCollapse} className="h-7 w-7 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Empty state */}
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <ListIcon className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No executions yet</p>
          <p className="mt-2 text-xs text-muted-foreground/70">
            Start by creating an execution from an issue.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox checked={allChecked} onCheckedChange={onToggleAll} className="h-4 w-4" />
            <span className="text-sm text-muted-foreground">All</span>
            <Badge variant="secondary" className="text-xs">
              {executions.length}
            </Badge>
          </div>
          {onToggleCollapse && (
            <Button variant="ghost" size="sm" onClick={onToggleCollapse} className="h-7 w-7 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Execution list */}
      <div className="flex-1 overflow-y-auto">
        {executions.map((execution) => {
          const isVisible = visibleExecutionIds.has(execution.id)
          const createdAt = new Date(execution.created_at)
          const relativeTime = formatDistanceToNow(createdAt, { addSuffix: true })

          return (
            <div
              key={execution.id}
              className="cursor-pointer border-b p-3 transition-colors hover:bg-accent/50"
              onClick={() => handleToggle(execution.id)}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <Checkbox
                  checked={isVisible}
                  onCheckedChange={() => handleToggle(execution.id)}
                  className="mt-1"
                  onClick={(e) => e.stopPropagation()}
                />

                {/* Execution info */}
                <div className="min-w-0 flex-1">
                  {/* Execution ID + Status */}
                  <div className="mb-1 flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-sm font-medium">
                      {execution.id}
                    </span>
                    {renderStatusIcon(execution.status)}
                  </div>

                  {/* Issue ID (if available) */}
                  {execution.issue_id && (
                    <div className="mb-1" onClick={(e) => e.stopPropagation()}>
                      <EntityBadge
                        entityId={execution.issue_id}
                        entityType="issue"
                        showHoverCard={true}
                        linkToEntity={true}
                        className="text-xs"
                      />
                    </div>
                  )}

                  {/* Branch name */}
                  {execution.branch_name && (
                    <div className="mb-1 flex min-w-0 items-center gap-1 text-muted-foreground">
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 truncate font-mono text-xs">
                        {execution.branch_name}
                      </span>
                    </div>
                  )}

                  {/* Relative timestamp */}
                  <div className="text-xs text-muted-foreground/70">{relativeTime}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
