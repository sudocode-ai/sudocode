import { useState, useEffect, useCallback } from 'react'
import { executionsApi } from '@/lib/api'
import { ExecutionMonitor } from './ExecutionMonitor'
import { FollowUpDialog } from './FollowUpDialog'
import { ResumeSessionDialog } from './ResumeSessionDialog'
import { DeleteWorktreeDialog } from './DeleteWorktreeDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Execution } from '@/types/execution'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  AlertCircle,
  MessageSquarePlus,
  X,
  Trash2,
  Clock,
  PauseCircle,
  Play,
} from 'lucide-react'

export interface ExecutionViewProps {
  /**
   * Execution ID to display
   */
  executionId: string

  /**
   * Callback when follow-up execution is created
   */
  onFollowUpCreated?: (newExecutionId: string) => void
}

/**
 * ExecutionView Component
 *
 * Displays execution metadata and real-time progress using AG-UI streaming.
 * Provides actions for canceling and creating follow-up executions.
 */
export function ExecutionView({ executionId, onFollowUpCreated }: ExecutionViewProps) {
  const [execution, setExecution] = useState<Execution | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [showResumeSession, setShowResumeSession] = useState(false)
  const [showDeleteWorktree, setShowDeleteWorktree] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [worktreeExists, setWorktreeExists] = useState(false)

  // Load execution metadata and check worktree status
  useEffect(() => {
    const loadExecution = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await executionsApi.getById(executionId)
        setExecution(data)

        // Check if worktree exists if execution has a worktree path
        if (data.worktree_path) {
          try {
            const worktreeStatus = await executionsApi.worktreeExists(executionId)
            setWorktreeExists(worktreeStatus.exists)
          } catch (err) {
            console.error('Failed to check worktree status:', err)
            setWorktreeExists(false)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load execution')
      } finally {
        setLoading(false)
      }
    }

    loadExecution()
  }, [executionId])

  // Reload execution when monitor completes
  const handleExecutionComplete = useCallback(async () => {
    try {
      const data = await executionsApi.getById(executionId)
      setExecution(data)

      // Re-check worktree status
      if (data.worktree_path) {
        try {
          const worktreeStatus = await executionsApi.worktreeExists(executionId)
          setWorktreeExists(worktreeStatus.exists)
        } catch (err) {
          console.error('Failed to check worktree status:', err)
          setWorktreeExists(false)
        }
      }
    } catch (err) {
      console.error('Failed to reload execution:', err)
    }
  }, [executionId])

  // Handle execution errors
  const handleExecutionError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  // Handle cancel action
  const handleCancel = async () => {
    if (!execution) return

    setCancelling(true)
    try {
      await executionsApi.cancel(executionId)
      // Reload execution to get updated status
      const data = await executionsApi.getById(executionId)
      setExecution(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel execution')
    } finally {
      setCancelling(false)
    }
  }

  // Handle follow-up submission
  const handleFollowUpSubmit = async (feedback: string) => {
    const newExecution = await executionsApi.createFollowUp(executionId, { feedback })
    setShowFollowUp(false)

    if (onFollowUpCreated) {
      onFollowUpCreated(newExecution.id)
    }
  }

  // Handle resume session submission
  const handleResumeSessionSubmit = async (prompt: string) => {
    const newExecution = await executionsApi.resumeSession(executionId, { prompt })
    setShowResumeSession(false)

    if (onFollowUpCreated) {
      onFollowUpCreated(newExecution.id)
    }
  }

  // Handle delete worktree action
  const handleDeleteWorktree = async () => {
    if (!execution || !execution.worktree_path) return

    setDeletingWorktree(true)
    try {
      await executionsApi.deleteWorktree(executionId)
      // Update worktree exists state
      setWorktreeExists(false)
      // Reload execution to reflect changes
      const data = await executionsApi.getById(executionId)
      setExecution(data)
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
  if (error || !execution) {
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

  const canCancel = execution.status === 'running'
  const canFollowUp =
    execution.status === 'completed' ||
    execution.status === 'failed' ||
    execution.status === 'stopped'
  const canResumeSession =
    (execution.status === 'completed' ||
      execution.status === 'failed' ||
      execution.status === 'stopped') &&
    execution.session_id
  const canDeleteWorktree = execution.worktree_path && worktreeExists

  return (
    <div className="space-y-4">
      {/* Execution Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-3">
            {/* Title and Status */}
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold">Execution</h2>
              {renderStatusBadge(execution.status)}
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">ID:</span>
                <span className="ml-2 font-mono">{execution.id}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Issue:</span>
                <span className="ml-2 font-mono">{execution.issue_id}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Mode:</span>
                <span className="ml-2 capitalize">{execution.mode}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Model:</span>
                <span className="ml-2">{execution.model}</span>
              </div>
              {execution.session_id && (
                <div>
                  <span className="text-muted-foreground">Session ID:</span>
                  <span className="ml-2 font-mono text-xs">{execution.session_id}</span>
                </div>
              )}
              {execution.target_branch && (
                <div>
                  <span className="text-muted-foreground">Base Branch:</span>
                  <span className="ml-2 font-mono">{execution.target_branch}</span>
                </div>
              )}
              {execution.worktree_path && (
                <div>
                  <span className="text-muted-foreground">Worktree:</span>
                  <span className="ml-2 font-mono text-xs">{execution.worktree_path}</span>
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
            </div>

            {/* Timestamps */}
            <div className="flex gap-4 text-xs text-muted-foreground">
              {execution.created_at && (
                <div>
                  Created:{' '}
                  {new Date(execution.created_at).toLocaleString('en-US', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              )}
              {execution.started_at && (
                <div>
                  Started:{' '}
                  {new Date(execution.started_at).toLocaleString('en-US', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              )}
              {execution.completed_at && (
                <div>
                  Completed:{' '}
                  {new Date(execution.completed_at).toLocaleString('en-US', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              )}
            </div>

            {/* Error message */}
            {execution.error && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div>
                    <h5 className="font-medium text-destructive">Execution Error</h5>
                    <p className="mt-1 text-destructive/90">{execution.error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="ml-4 flex gap-2">
            {canCancel && (
              <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelling}>
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
            {canFollowUp && (
              <Button variant="default" size="sm" onClick={() => setShowFollowUp(true)}>
                <MessageSquarePlus className="mr-2 h-4 w-4" />
                Follow Up
              </Button>
            )}
            {canResumeSession && (
              <Button variant="default" size="sm" onClick={() => setShowResumeSession(true)}>
                <Play className="mr-2 h-4 w-4" />
                Continue Session
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

      {/* Execution Monitor - uses SSE for active, logs API for completed */}
      {(execution.status === 'running' ||
        execution.status === 'preparing' ||
        execution.status === 'pending' ||
        execution.status === 'paused' ||
        execution.status === 'completed' ||
        execution.status === 'failed' ||
        execution.status === 'cancelled' ||
        execution.status === 'stopped') && (
        <ExecutionMonitor
          executionId={executionId}
          execution={execution}
          onComplete={handleExecutionComplete}
          onError={handleExecutionError}
        />
      )}

      {/* Follow-up Dialog */}
      <FollowUpDialog
        open={showFollowUp}
        onSubmit={handleFollowUpSubmit}
        onCancel={() => setShowFollowUp(false)}
      />

      {/* Resume Session Dialog */}
      <ResumeSessionDialog
        open={showResumeSession}
        onSubmit={handleResumeSessionSubmit}
        onCancel={() => setShowResumeSession(false)}
        sessionId={execution.session_id}
      />

      {/* Delete Worktree Dialog */}
      <DeleteWorktreeDialog
        worktreePath={execution.worktree_path}
        isOpen={showDeleteWorktree}
        onClose={() => setShowDeleteWorktree(false)}
        onConfirm={handleDeleteWorktree}
        isDeleting={deletingWorktree}
      />
    </div>
  )
}
