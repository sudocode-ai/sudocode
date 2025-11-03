import { useState, useEffect } from 'react'
import { executionsApi } from '@/lib/api'
import { ExecutionMonitor } from './ExecutionMonitor'
import { FollowUpDialog } from './FollowUpDialog'
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
  const [cancelling, setCancelling] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)

  // Load execution metadata
  useEffect(() => {
    const loadExecution = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await executionsApi.getById(executionId)
        setExecution(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load execution')
      } finally {
        setLoading(false)
      }
    }

    loadExecution()
  }, [executionId])

  // Reload execution when monitor completes
  const handleExecutionComplete = async () => {
    try {
      const data = await executionsApi.getById(executionId)
      setExecution(data)
    } catch (err) {
      console.error('Failed to reload execution:', err)
    }
  }

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

  // Handle delete worktree action
  const handleDeleteWorktree = async () => {
    if (!execution || !execution.worktreePath) return

    const confirmed = window.confirm(
      'Are you sure you want to delete the worktree? This action cannot be undone.\n\n' +
        `Worktree path: ${execution.worktreePath}`
    )

    if (!confirmed) return

    setDeletingWorktree(true)
    try {
      await executionsApi.deleteWorktree(executionId)
      // Reload execution to reflect changes
      const data = await executionsApi.getById(executionId)
      setExecution(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree')
    } finally {
      setDeletingWorktree(false)
    }
  }

  // Render status badge
  const renderStatusBadge = (status: Execution['status']) => {
    switch (status) {
      case 'running':
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {status.charAt(0).toUpperCase() + status.slice(1)}
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
      case 'stopped':
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <X className="h-3 w-3" />
            Stopped
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {status}
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
  // TODO: Check if the worktree is still present before allowing deletion.
  const canDeleteWorktree = execution.worktreePath && execution.status !== 'running'

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
                <span className="ml-2 font-mono">{execution.issueId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Mode:</span>
                <span className="ml-2 capitalize">{execution.mode}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Model:</span>
                <span className="ml-2">{execution.model}</span>
              </div>
              {execution.baseBranch && (
                <div>
                  <span className="text-muted-foreground">Base Branch:</span>
                  <span className="ml-2 font-mono">{execution.baseBranch}</span>
                </div>
              )}
              {execution.worktreePath && (
                <div>
                  <span className="text-muted-foreground">Worktree:</span>
                  <span className="ml-2 font-mono text-xs">{execution.worktreePath}</span>
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div className="flex gap-4 text-xs text-muted-foreground">
              {execution.createdAt && (
                <div>
                  Created:{' '}
                  {new Date(execution.createdAt).toLocaleString('en-US', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              )}
              {execution.startedAt && (
                <div>
                  Started:{' '}
                  {new Date(execution.startedAt).toLocaleString('en-US', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              )}
              {execution.completedAt && (
                <div>
                  Completed:{' '}
                  {new Date(execution.completedAt).toLocaleString('en-US', {
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
            {canDeleteWorktree && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteWorktree}
                disabled={deletingWorktree}
              >
                {deletingWorktree ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Worktree
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Real-time Execution Monitor */}
      {(execution.status === 'running' ||
        execution.status === 'completed' ||
        execution.status === 'failed') && (
        <ExecutionMonitor
          executionId={executionId}
          onComplete={handleExecutionComplete}
          onError={(err) => setError(err.message)}
        />
      )}

      {/* Follow-up Dialog */}
      <FollowUpDialog
        open={showFollowUp}
        onSubmit={handleFollowUpSubmit}
        onCancel={() => setShowFollowUp(false)}
      />
    </div>
  )
}
