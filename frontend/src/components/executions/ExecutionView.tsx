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
  Clock,
  AlertCircle,
  MessageSquarePlus,
  X,
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

  // Render status badge
  const renderStatusBadge = (status: Execution['status']) => {
    switch (status) {
      case 'preparing':
      case 'pending':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        )
      case 'running':
      case 'paused':
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
      case 'cancelled':
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <X className="h-3 w-3" />
            Cancelled
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
          <XCircle className="h-5 w-5 mt-0.5" />
          <div>
            <h4 className="font-semibold">Error Loading Execution</h4>
            <p className="text-sm mt-1">{error || 'Execution not found'}</p>
          </div>
        </div>
      </Card>
    )
  }

  const canCancel = execution.status === 'running' || execution.status === 'pending'
  const canFollowUp = execution.status === 'completed' || execution.status === 'failed'

  return (
    <div className="space-y-4">
      {/* Execution Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
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
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  <div>
                    <h5 className="font-medium text-destructive">Execution Error</h5>
                    <p className="text-destructive/90 mt-1">{execution.error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 ml-4">
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </>
                )}
              </Button>
            )}
            {canFollowUp && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowFollowUp(true)}
              >
                <MessageSquarePlus className="h-4 w-4 mr-2" />
                Follow Up
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Real-time Execution Monitor */}
      {(execution.status === 'running' ||
        execution.status === 'pending' ||
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
