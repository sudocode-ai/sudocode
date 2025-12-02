import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EntityBadge } from '@/components/entities/EntityBadge'
import { ExecutionMonitor, RunIndicator } from './ExecutionMonitor'
import { AgentConfigPanel } from './AgentConfigPanel'
import { TodoTracker } from './TodoTracker'
import { CodeChangesPanel } from './CodeChangesPanel'
import { buildTodoHistory } from '@/utils/todoExtractor'
import { executionsApi, type ExecutionChainResponse } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { Execution, ExecutionConfig } from '@/types/execution'
import type { WebSocketMessage } from '@/types/api'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'
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

  // Accumulated tool calls from all executions in the chain (for TodoTracker)
  const [allToolCalls, setAllToolCalls] = useState<Map<string, ToolCallTracking>>(new Map())

  // Extract todos from accumulated tool calls
  const allTodos = useMemo(() => buildTodoHistory(allToolCalls), [allToolCalls])

  // WebSocket context for real-time updates
  const { connected, subscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Track known execution IDs in this chain to detect relevant updates
  const chainExecutionIdsRef = useRef<Set<string>>(new Set())

  // Load execution chain
  const loadChain = useCallback(async () => {
    try {
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
      // Update the set of known execution IDs in this chain
      chainExecutionIdsRef.current = new Set(data.executions.map((e) => e.id))
    } catch (err) {
      console.error('Failed to load execution chain:', err)
    }
  }, [executionId])

  // Initial load
  useEffect(() => {
    let cancelled = false

    const initialLoad = async () => {
      setLoading(true)
      try {
        const data = await executionsApi.getChain(executionId)
        if (!cancelled) {
          setChainData(data)
          chainExecutionIdsRef.current = new Set(data.executions.map((e) => e.id))
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

    initialLoad()

    return () => {
      cancelled = true
    }
  }, [executionId])

  // WebSocket subscription for real-time updates
  useEffect(() => {
    const handlerId = `ExecutionChainTile-${executionId}`

    const handleMessage = (message: WebSocketMessage) => {
      // Only handle execution-related messages
      if (
        message.type !== 'execution_created' &&
        message.type !== 'execution_updated' &&
        message.type !== 'execution_status_changed'
      ) {
        return
      }

      // Extract execution data from message
      const executionData = message.data as Execution | undefined
      if (!executionData?.id) return

      // Reload if:
      // 1. The message is about an execution in our chain
      // 2. The message is about a new execution with our root as parent (new follow-up)
      const isInChain = chainExecutionIdsRef.current.has(executionData.id)
      const isNewFollowUp =
        message.type === 'execution_created' &&
        executionData.parent_execution_id &&
        chainExecutionIdsRef.current.has(executionData.parent_execution_id)

      if (isInChain || isNewFollowUp) {
        loadChain()
      }
    }

    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
    }
  }, [executionId, connected, subscribe, addMessageHandler, removeMessageHandler, loadChain])

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
        // Reload the chain (WebSocket will also trigger this, but we do it immediately for responsiveness)
        await loadChain()
      } catch (err) {
        console.error('Failed to create follow-up:', err)
      } finally {
        setSubmittingFollowUp(false)
      }
    },
    [chainData, loadChain]
  )

  // Handle tool calls update from ExecutionMonitor (for TodoTracker)
  const handleToolCallsUpdate = useCallback(
    (execId: string, toolCalls: Map<string, ToolCallTracking>) => {
      setAllToolCalls((prev) => {
        // Check if we need to update by comparing content
        let hasChanges = false
        const executionPrefix = `${execId}-`

        // Count existing entries for this execution
        let existingCount = 0
        prev.forEach((_, key) => {
          if (key.startsWith(executionPrefix)) {
            existingCount++
          }
        })

        // If sizes don't match, we have changes
        if (existingCount !== toolCalls.size) {
          hasChanges = true
        } else {
          // Check if any content changed
          toolCalls.forEach((toolCall, id) => {
            const key = `${executionPrefix}${id}`
            const existing = prev.get(key)
            if (!existing) {
              hasChanges = true
            } else if (
              existing.status !== toolCall.status ||
              existing.result !== toolCall.result
            ) {
              hasChanges = true
            }
          })
        }

        if (!hasChanges) {
          return prev
        }

        const next = new Map(prev)
        // Remove old entries for this execution
        Array.from(next.keys()).forEach((key) => {
          if (key.startsWith(executionPrefix)) {
            next.delete(key)
          }
        })
        // Add new entries
        toolCalls.forEach((toolCall, id) => {
          next.set(`${executionPrefix}${id}`, toolCall)
        })
        return next
      })
    },
    []
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
              onToolCallsUpdate={(toolCalls) => handleToolCallsUpdate(execution.id, toolCalls)}
            />
            {/* Separator between executions */}
            {index < executions.length - 1 && <div className="mx-4 my-2" />}
          </div>
        ))}

        {/* Accumulated Todo Tracker - shows todos from all executions in chain */}
        {allTodos.length > 0 && (
          <div className="mt-2 px-2">
            <TodoTracker todos={allTodos} />
          </div>
        )}

        {/* Code Changes Panel - shows file changes from the execution */}
        {(rootExecution.before_commit || rootExecution.after_commit) && (
          <div className="mt-2 px-2">
            <CodeChangesPanel
              executionId={rootExecution.id}
              autoRefreshInterval={
                executions.some((exec) => exec.status === 'running') ? 30000 : undefined
              }
              executionStatus={lastExecution.status}
              worktreePath={rootExecution.worktree_path}
            />
          </div>
        )}

        {/* Running indicator if any executions are running */}
        {executions.some((exec) => exec.status === 'running') && (
          <div className="mt-2 px-2">
            <RunIndicator />
          </div>
        )}
      </div>

      {/* Sticky Footer - AgentConfigPanel for follow-ups (compact mode) */}
      <div
        className="sticky bottom-0 z-10 border-t bg-card px-2 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <AgentConfigPanel
          variant="compact"
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
