import { useState, useEffect, useCallback } from 'react'
import { executionsApi, type ExecutionChainResponse } from '@/lib/api'
import { ExecutionMonitor } from './ExecutionMonitor'
import { AgentConfigPanel } from './AgentConfigPanel'
import { DeleteWorktreeDialog } from './DeleteWorktreeDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Execution, ExecutionConfig } from '@/types/execution'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  AlertCircle,
  X,
  Trash2,
  Clock,
  PauseCircle,
} from 'lucide-react'

export interface ExecutionViewProps {
  /**
   * Execution ID to display (will load the full chain)
   */
  executionId: string

  /**
   * Callback when follow-up execution is created (optional - for external navigation if needed)
   */
  onFollowUpCreated?: (newExecutionId: string) => void
}

/**
 * ExecutionView Component
 *
 * Displays an execution chain (root + all follow-ups) with real-time progress.
 * Each execution in the chain is rendered inline with its own ExecutionMonitor.
 * The follow-up input panel appears after the last execution.
 */
export function ExecutionView({ executionId, onFollowUpCreated }: ExecutionViewProps) {
  const [chainData, setChainData] = useState<ExecutionChainResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteWorktree, setShowDeleteWorktree] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [worktreeExists, setWorktreeExists] = useState(false)
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false)

  // Load execution chain
  useEffect(() => {
    const loadChain = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await executionsApi.getChain(executionId)
        setChainData(data)

        // Check worktree status for the root execution
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
        setError(err instanceof Error ? err.message : 'Failed to load execution chain')
      } finally {
        setLoading(false)
      }
    }

    loadChain()
  }, [executionId])

  // Reload chain when an execution completes
  const handleExecutionComplete = useCallback(
    async (completedExecutionId: string) => {
      try {
        // Reload the full chain to get updated status
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
    },
    []
  )

  // Handle execution errors
  const handleExecutionError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  // Handle cancel action for a specific execution
  const handleCancel = async (execId: string) => {
    setCancelling(true)
    try {
      await executionsApi.cancel(execId)
      // Reload chain to get updated status
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel execution')
    } finally {
      setCancelling(false)
    }
  }

  // Handle follow-up submission - creates new execution and adds to chain
  const handleFollowUpStart = async (
    _config: ExecutionConfig,
    prompt: string,
    _agentType?: string
  ) => {
    if (!chainData || chainData.executions.length === 0) return

    // Get the last execution in the chain to create follow-up from
    const lastExecution = chainData.executions[chainData.executions.length - 1]

    setSubmittingFollowUp(true)
    try {
      const newExecution = await executionsApi.createFollowUp(lastExecution.id, { feedback: prompt })

      // Add the new execution to the chain immediately
      setChainData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          executions: [...prev.executions, newExecution],
        }
      })

      // Notify parent if callback provided (for URL updates, etc.)
      if (onFollowUpCreated) {
        onFollowUpCreated(newExecution.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create follow-up')
    } finally {
      setSubmittingFollowUp(false)
    }
  }

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
          <Badge variant="default" className="flex items-center gap-1 bg-green-600">
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
  const isChain = executions.length > 1

  // Determine if we can enable follow-up panel (last execution must be terminal)
  const lastExecutionTerminal =
    lastExecution.status === 'completed' ||
    lastExecution.status === 'failed' ||
    lastExecution.status === 'stopped' ||
    lastExecution.status === 'cancelled'
  const canEnableFollowUp = lastExecutionTerminal && rootExecution.issue_id

  // Can we cancel the last execution?
  const canCancelLast = lastExecution.status === 'running'
  const canDeleteWorktree = rootExecution.worktree_path && worktreeExists

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable content area with padding for sticky panel */}
      <div className="flex-1 overflow-auto py-6">
        <div className="mx-auto w-full max-w-7xl space-y-4 px-6 pb-32">
        {/* Execution Chain Header */}
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-3">
              {/* Title and Status */}
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold">
                  {isChain ? 'Execution Chain' : 'Execution'}
                </h2>
                {isChain && (
                  <Badge variant="outline" className="text-xs">
                    {executions.length} execution{executions.length > 1 ? 's' : ''}
                  </Badge>
                )}
                {renderStatusBadge(lastExecution.status)}
              </div>

              {/* Metadata Grid - from root execution */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Root ID:</span>
                  <span className="ml-2 font-mono">{rootExecution.id.slice(0, 8)}...</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Issue:</span>
                  <span className="ml-2 font-mono">{rootExecution.issue_id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Mode:</span>
                  <span className="ml-2 capitalize">{rootExecution.mode}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Model:</span>
                  <span className="ml-2">{rootExecution.model}</span>
                </div>
                {rootExecution.target_branch && (
                  <div>
                    <span className="text-muted-foreground">Base Branch:</span>
                    <span className="ml-2 font-mono">{rootExecution.target_branch}</span>
                  </div>
                )}
                {rootExecution.worktree_path && (
                  <div>
                    <span className="text-muted-foreground">Worktree:</span>
                    <span className="ml-2 font-mono text-xs">{rootExecution.worktree_path}</span>
                    {worktreeExists ? (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        exists
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                        deleted
                      </Badge>
                    )}
                  </div>
                )}
                {lastExecution.session_id && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Session:</span>
                    <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {lastExecution.session_id}
                    </code>
                    <span className="ml-2 text-xs text-muted-foreground">
                      (use with{' '}
                      <code className="rounded bg-muted px-1 py-0.5">
                        claude --resume {lastExecution.session_id}
                      </code>
                      )
                    </span>
                  </div>
                )}
              </div>

              {/* Timestamps - from root */}
              <div className="flex gap-4 text-xs text-muted-foreground">
                {rootExecution.created_at && (
                  <div>
                    Started:{' '}
                    {new Date(rootExecution.created_at).toLocaleString('en-US', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                )}
                {lastExecution.completed_at && (
                  <div>
                    Last completed:{' '}
                    {new Date(lastExecution.completed_at).toLocaleString('en-US', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="ml-4 flex gap-2">
              {canCancelLast && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleCancel(lastExecution.id)}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </>
                  )}
                </Button>
              )}
              {canDeleteWorktree && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteWorktree(true)}
                  disabled={deletingWorktree}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Worktree
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Execution chain contents with boundary */}
        <Card className="p-6">
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
                  compact
                />

                {/* Visual separator between executions (subtle spacing only) */}
                {showDivider && <div className="my-6" />}
              </div>
            )
          })}
        </Card>
        </div>
      </div>

      {/* Sticky Follow-up Input Panel - always rendered at bottom */}
      {rootExecution.issue_id && (
        <div className="sticky bottom-0 border-t bg-background shadow-lg">
          <div className="mx-auto w-full max-w-7xl">
            <AgentConfigPanel
              issueId={rootExecution.issue_id}
              onStart={handleFollowUpStart}
              isFollowUp
              disabled={!canEnableFollowUp || submittingFollowUp}
              parentExecution={{
                id: lastExecution.id,
                mode: rootExecution.mode || undefined,
                model: rootExecution.model || undefined,
                target_branch: rootExecution.target_branch || undefined,
                agent_type: rootExecution.agent_type || undefined,
                config: rootExecution.config
                  ? typeof rootExecution.config === 'string'
                    ? JSON.parse(rootExecution.config)
                    : rootExecution.config
                  : undefined,
              }}
            />
          </div>
        </div>
      )}

      {/* Delete Worktree Dialog */}
      <DeleteWorktreeDialog
        worktreePath={rootExecution.worktree_path}
        isOpen={showDeleteWorktree}
        onClose={() => setShowDeleteWorktree(false)}
        onConfirm={handleDeleteWorktree}
        isDeleting={deletingWorktree}
      />
    </div>
  )
}
