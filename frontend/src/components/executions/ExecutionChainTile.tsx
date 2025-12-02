import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EntityBadge } from '@/components/entities/EntityBadge'
import { ExecutionMonitor } from './ExecutionMonitor'
import { AgentConfigPanel } from './AgentConfigPanel'
import { executionsApi, type ExecutionChainResponse } from '@/lib/api'
import type { Execution, ExecutionConfig } from '@/types/execution'
import { Loader2, Clock, CheckCircle2, XCircle, AlertCircle, X, PauseCircle } from 'lucide-react'

export interface ExecutionChainTileProps {
  /**
   * Root execution ID (will load the full chain)
   */
  executionId: string

  /**
   * Callback when user wants to hide this execution from the grid
   */
  onToggleVisibility?: (executionId: string) => void

  /**
   * Callback when user wants to delete this execution
   */
  onDelete?: (executionId: string) => void
}

/**
 * Render status icon with tooltip for execution (icon-only, more compact)
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

/**
 * ExecutionChainTile Component
 *
 * Displays an execution chain (root + follow-ups) in a grid tile with:
 * - Sticky header (execution ID, issue badge, status, hide button)
 * - Scrollable middle (ExecutionMonitor for each execution in compact mode)
 * - Sticky footer (AgentConfigPanel for follow-ups)
 * - Click anywhere on the tile to open full view
 */
export function ExecutionChainTile({ executionId, onToggleVisibility }: ExecutionChainTileProps) {
  const [chainData, setChainData] = useState<ExecutionChainResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false)

  // Load execution chain
  useEffect(() => {
    let cancelled = false

    const loadChain = async () => {
      setLoading(true)
      try {
        const data = await executionsApi.getChain(executionId)
        if (!cancelled) {
          setChainData(data)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load execution chain:', err)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadChain()

    return () => {
      cancelled = true
    }
  }, [executionId])

  // Handle follow-up submission
  const handleFollowUpStart = useCallback(
    async (_config: ExecutionConfig, prompt: string, _agentType?: string) => {
      if (!chainData || chainData.executions.length === 0) return

      const lastExecution = chainData.executions[chainData.executions.length - 1]

      setSubmittingFollowUp(true)
      try {
        await executionsApi.createFollowUp(lastExecution.id, {
          feedback: prompt,
        })
        // Reload the chain
        const data = await executionsApi.getChain(executionId)
        setChainData(data)
      } catch (err) {
        console.error('Failed to create follow-up:', err)
      } finally {
        setSubmittingFollowUp(false)
      }
    },
    [chainData, executionId]
  )

  // Handle close button
  const handleClose = useCallback(() => {
    if (onToggleVisibility) {
      onToggleVisibility(executionId)
    }
  }, [executionId, onToggleVisibility])

  if (loading || !chainData || chainData.executions.length === 0) {
    return (
      <div className="flex h-full flex-col border bg-card shadow-sm">
        <div className="flex h-full items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const executions = chainData.executions
  const rootExecution = executions[0]
  const lastExecution = executions[executions.length - 1]

  return (
    <div className="flex h-full cursor-pointer flex-col border bg-card shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:shadow-md">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-card px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            to={`/executions/${executionId}`}
            className="min-w-0 truncate font-mono text-sm font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {rootExecution.id}
          </Link>

          {/* Issue badge inline if available */}
          {rootExecution.issue_id && (
            <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <EntityBadge
                entityId={rootExecution.issue_id}
                entityType="issue"
                showHoverCard={true}
                linkToEntity={true}
                className="text-xs"
              />
            </div>
          )}

          {/* Status icon */}
          <div className="flex-shrink-0">{renderStatusIcon(lastExecution.status)}</div>
        </div>

        {/* Quick actions */}
        {onToggleVisibility && (
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleClose()
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Hide from grid</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      {/* Scrollable Middle - ExecutionMonitor for each execution */}
      <div className="flex-1 overflow-y-auto p-2">
        {executions.map((execution, index) => (
          <div key={execution.id}>
            <ExecutionMonitor
              executionId={execution.id}
              execution={execution}
              compact={true}
              hideTodoTracker={true}
            />
            {/* Separator between executions */}
            {index < executions.length - 1 && <div className="mx-4 my-2" />}
          </div>
        ))}
      </div>

      {/* Sticky Footer - AgentConfigPanel for follow-ups */}
      <div
        className="sticky bottom-0 z-10 border-t bg-card px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <AgentConfigPanel
          issueId={rootExecution.issue_id || ''}
          onStart={handleFollowUpStart}
          disabled={submittingFollowUp}
          isFollowUp={true}
          lastExecution={{
            id: lastExecution.id,
            mode: lastExecution.mode || undefined,
            model: lastExecution.model || undefined,
            target_branch: lastExecution.target_branch,
            agent_type: lastExecution.agent_type,
          }}
          promptPlaceholder="Send a follow-up message..."
          currentExecution={lastExecution}
          disableContextualActions={true}
        />
      </div>
    </div>
  )
}
