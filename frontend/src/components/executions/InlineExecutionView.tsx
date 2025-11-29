import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { executionsApi, type ExecutionChainResponse } from '@/lib/api'
import { ExecutionMonitor, RunIndicator } from './ExecutionMonitor'
import { DeleteWorktreeDialog } from './DeleteWorktreeDialog'
import { DeleteExecutionDialog } from './DeleteExecutionDialog'
import { TodoTracker } from './TodoTracker'
import { buildTodoHistory } from '@/utils/todoExtractor'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'
import type { Execution } from '@/types/execution'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  PauseCircle,
  X,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Trash2,
  PlayCircle,
  GitBranch,
} from 'lucide-react'

export interface InlineExecutionViewProps {
  /**
   * Execution ID to display (will load the full chain)
   */
  executionId: string

  /**
   * Callback when execution is deleted (optional - for parent to refresh)
   */
  onExecutionDeleted?: () => void

  /**
   * Initial expanded state (defaults to true)
   */
  defaultExpanded?: boolean
}

/**
 * InlineExecutionView Component
 *
 * Displays an execution chain inline without header metadata or follow-up controls.
 * Designed to be embedded in activity timelines and other compact contexts.
 */
export function InlineExecutionView({
  executionId,
  onExecutionDeleted,
  defaultExpanded = true,
}: InlineExecutionViewProps) {
  const navigate = useNavigate()
  const { subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()
  const [chainData, setChainData] = useState<ExecutionChainResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [showDeleteWorktree, setShowDeleteWorktree] = useState(false)
  const [showDeleteExecution, setShowDeleteExecution] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [deletingExecution, setDeletingExecution] = useState(false)
  const [worktreeExists, setWorktreeExists] = useState(false)
  const rootExecutionIdRef = useRef<string | null>(null)

  // Accumulated tool calls from all executions in the chain
  const [allToolCalls, setAllToolCalls] = useState<Map<string, ToolCallTracking>>(new Map())

  // Extract todos from accumulated tool calls
  const allTodos = useMemo(() => buildTodoHistory(allToolCalls), [allToolCalls])

  // Load execution chain and set up WebSocket subscription
  useEffect(() => {
    let rootExecutionId: string | null = null
    let handlerId: string | null = null

    const loadChain = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await executionsApi.getChain(executionId)
        setChainData(data)

        // Store the root execution ID for WebSocket subscription
        const rootExecution = data.executions[0]
        if (rootExecution) {
          rootExecutionIdRef.current = rootExecution.id
          rootExecutionId = rootExecution.id

          // Subscribe to the root execution for updates
          subscribe('execution', rootExecutionId)

          // Handle execution updates
          handlerId = `inline-execution-view-${rootExecutionId}`
          const handleMessage = async (message: any) => {
            if (
              message.type === 'execution_created' ||
              message.type === 'execution_updated' ||
              message.type === 'execution_status_changed'
            ) {
              // Reload the chain to get the latest status
              try {
                const data = await executionsApi.getChain(rootExecutionId!)
                setChainData(data)
              } catch (err) {
                // Don't show error on WebSocket reload failures - keep existing data
                console.error('Failed to reload execution chain:', err)
              }
            }
          }

          addMessageHandler(handlerId, handleMessage)
        }

        // Check worktree status for the root execution
        if (rootExecution?.worktree_path) {
          try {
            const worktreeStatus = await executionsApi.worktreeExists(rootExecution.id)
            setWorktreeExists(worktreeStatus.exists)
          } catch (err) {
            console.error('Failed to check worktree status:', err)
            setWorktreeExists(false)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load execution chain')
      } finally {
        setLoading(false)
      }
    }

    loadChain()

    // Cleanup function
    return () => {
      if (handlerId) {
        removeMessageHandler(handlerId)
      }
      if (rootExecutionId) {
        unsubscribe('execution', rootExecutionId)
      }
    }
  }, [executionId, subscribe, unsubscribe, addMessageHandler, removeMessageHandler])

  // Reload chain when an execution completes
  const handleExecutionComplete = useCallback(async (completedExecutionId: string) => {
    try {
      const data = await executionsApi.getChain(completedExecutionId)
      setChainData(data)

      // Re-check worktree status
      const rootExecution = data.executions[0]
      if (rootExecution?.worktree_path) {
        try {
          const worktreeStatus = await executionsApi.worktreeExists(rootExecution.id)
          setWorktreeExists(worktreeStatus.exists)
        } catch (err) {
          console.error('Failed to check worktree status:', err)
          setWorktreeExists(false)
        }
      }
    } catch (err) {
      console.error('Failed to reload execution chain:', err)
    }
  }, [])

  // Handle execution errors
  const handleExecutionError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  // Handle delete worktree action
  const handleDeleteWorktree = async () => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExecution = chainData.executions[0]
    if (!rootExecution.worktree_path) return

    setDeletingWorktree(true)
    try {
      await executionsApi.deleteWorktree(rootExecution.id)
      setWorktreeExists(false)
      // Reload chain
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
      setShowDeleteWorktree(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree')
    } finally {
      setDeletingWorktree(false)
    }
  }

  // Handle delete execution action
  const handleDeleteExecution = async () => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExecution = chainData.executions[0]

    setDeletingExecution(true)
    try {
      await executionsApi.delete(rootExecution.id)
      setShowDeleteExecution(false)
      // Notify parent to refresh
      if (onExecutionDeleted) {
        onExecutionDeleted()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete execution')
      setDeletingExecution(false)
    }
  }

  // Render status badge
  const renderStatusBadge = (status: Execution['status']) => {
    switch (status) {
      case 'preparing':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Preparing
          </Badge>
        )
      case 'pending':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        )
      case 'running':
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        )
      case 'paused':
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <PauseCircle className="h-3 w-3" />
            Paused
          </Badge>
        )
      case 'completed':
        return (
          <Badge
            variant="default"
            className="flex items-center gap-1 bg-green-600 hover:bg-green-600"
          >
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        )
      case 'cancelled':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <X className="h-3 w-3" />
            Cancelled
          </Badge>
        )
      case 'stopped':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <X className="h-3 w-3" />
            Stopped
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {String(status).charAt(0).toUpperCase() + String(status).slice(1)}
          </Badge>
        )
    }
  }

  // Handle tool calls update from ExecutionMonitor
  const handleToolCallsUpdate = useCallback(
    (executionId: string, toolCalls: Map<string, ToolCallTracking>) => {
      setAllToolCalls((prev) => {
        // Check if we need to update by comparing content, not just keys
        let hasChanges = false
        const executionPrefix = `${executionId}-`

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
          // Check if any keys are missing or if content changed
          toolCalls.forEach((toolCall, id) => {
            const key = `${executionPrefix}${id}`
            const existing = prev.get(key)
            if (!existing) {
              hasChanges = true
            } else if (
              existing.status !== toolCall.status ||
              existing.result !== toolCall.result ||
              existing.args !== toolCall.args
            ) {
              hasChanges = true
            }
          })
        }

        if (!hasChanges) {
          return prev // No changes, return same reference to prevent re-render
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

  // Memoize the most recent timestamp calculation (must be before early returns)
  const mostRecentTime = useMemo(() => {
    if (!chainData || chainData.executions.length === 0) {
      return null
    }

    const executions = chainData.executions
    let mostRecent: string | null = null

    for (const execution of executions) {
      // Check all possible timestamp fields
      const timestamps = [
        execution.updated_at,
        execution.completed_at,
        execution.cancelled_at,
        execution.started_at,
        execution.created_at,
      ].filter((t): t is string => !!t)

      for (const timestamp of timestamps) {
        if (!mostRecent || new Date(timestamp) > new Date(mostRecent)) {
          mostRecent = timestamp
        }
      }
    }

    return mostRecent
  }, [chainData])

  // Loading state
  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading execution...</span>
        </div>
      </Card>
    )
  }

  // Error state
  if (error || !chainData || chainData.executions.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-2 text-destructive">
          <XCircle className="mt-0.5 h-5 w-5" />
          <div>
            <h4 className="font-semibold">Error Loading Execution</h4>
            <p className="mt-1 text-sm">{error || 'Execution not found'}</p>
          </div>
        </div>
      </Card>
    )
  }

  const executions = chainData.executions
  const rootExecution = executions[0]
  const lastExecution = executions[executions.length - 1]
  const canDeleteWorktree = rootExecution.worktree_path && worktreeExists

  const truncateId = (id: string, length = 8) => id.substring(0, length)

  return (
    <>
      <Card className="overflow-hidden rounded-md border">
        {/* Header - clickable to expand/collapse */}
        <div
          className="cursor-pointer bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-1 items-start gap-3">
              {/* Expand/Collapse Icon */}
              <div className="mt-0.5">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Execution Icon and Info */}
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <PlayCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/executions/${rootExecution.id}`)
                  }}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Execution {truncateId(rootExecution.id)}
                </button>
                {renderStatusBadge(lastExecution.status)}
                {rootExecution.branch_name && (
                  <div className="flex items-center gap-1 rounded bg-muted px-2 py-0.5">
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">
                      {rootExecution.branch_name}
                      {rootExecution.worktree_path ? ' (worktree)' : ''}
                    </span>
                  </div>
                )}
                {mostRecentTime && (
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(mostRecentTime), { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>

            {/* Actions Menu */}
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canDeleteWorktree && (
                    <DropdownMenuItem onClick={() => setShowDeleteWorktree(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Worktree
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setShowDeleteExecution(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Execution
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Execution chain contents - collapsible */}
        {isExpanded && (
          <div className="p-4">
            {executions.map((execution, index) => {
              const isLast = index === executions.length - 1
              const showDivider = !isLast

              return (
                <div key={execution.id}>
                  {/* Error message for this execution */}
                  {execution.error && (
                    <div className="mb-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                        <div>
                          <h5 className="font-medium text-destructive">Execution Error</h5>
                          <p className="mt-1 text-destructive/90">{execution.error}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Execution Monitor - compact mode for seamless inline display */}
                  <ExecutionMonitor
                    executionId={execution.id}
                    execution={execution}
                    onComplete={() => handleExecutionComplete(execution.id)}
                    onError={handleExecutionError}
                    onToolCallsUpdate={(toolCalls) =>
                      handleToolCallsUpdate(execution.id, toolCalls)
                    }
                    compact
                    hideTodoTracker
                  />

                  {/* Visual separator between executions (subtle spacing only) */}
                  {showDivider && <div className="my-6" />}
                </div>
              )
            })}

            {/* Accumulated Todo Tracker - shows todos from all executions in chain */}
            {allTodos.length > 0 && (
              <>
                <div className="my-6" />
                <TodoTracker todos={allTodos} />
              </>
            )}

            {/* Running indicator if any executions are running */}
            {executions.some((exec) => exec.status === 'running') && (
              <>
                <div className="my-6" />
                <RunIndicator />
              </>
            )}
          </div>
        )}
      </Card>

      {/* Delete Worktree Dialog */}
      <DeleteWorktreeDialog
        worktreePath={rootExecution.worktree_path}
        isOpen={showDeleteWorktree}
        onClose={() => setShowDeleteWorktree(false)}
        onConfirm={handleDeleteWorktree}
        isDeleting={deletingWorktree}
      />

      {/* Delete Execution Dialog */}
      <DeleteExecutionDialog
        executionId={rootExecution.id}
        executionCount={executions.length}
        isOpen={showDeleteExecution}
        onClose={() => setShowDeleteExecution(false)}
        onConfirm={handleDeleteExecution}
        isDeleting={deletingExecution}
      />
    </>
  )
}
