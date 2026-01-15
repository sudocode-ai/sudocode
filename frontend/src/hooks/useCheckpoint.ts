import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { executionsApi } from '@/lib/api'
import type { CheckpointOptions, CheckpointResult } from '@/types/execution'

export type CheckpointStatus = 'idle' | 'checkpointing' | 'success' | 'error' | 'conflict'

export interface UseCheckpointOptions {
  onSuccess?: (result: CheckpointResult) => void
  onError?: (error: string) => void
  onConflict?: (result: CheckpointResult) => void
}

/**
 * Hook for managing checkpoint operations
 *
 * Provides state management and actions for:
 * - Creating checkpoints from execution to issue stream
 * - Handling conflicts
 * - Managing checkpoint dialogs
 */
export function useCheckpoint(options?: UseCheckpointOptions) {
  const queryClient = useQueryClient()

  // Checkpoint state
  const [checkpointStatus, setCheckpointStatus] = useState<CheckpointStatus>('idle')
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult | null>(null)
  const [checkpointError, setCheckpointError] = useState<string | null>(null)
  const [isCheckpointDialogOpen, setIsCheckpointDialogOpen] = useState(false)

  // Checkpoint mutation
  const checkpointMutation = useMutation({
    mutationFn: ({
      executionId,
      checkpointOptions,
    }: {
      executionId: string
      checkpointOptions?: CheckpointOptions
    }) => executionsApi.checkpoint(executionId, checkpointOptions),
    onMutate: () => {
      setCheckpointStatus('checkpointing')
      setCheckpointError(null)
    },
    onSuccess: (data) => {
      setCheckpointResult(data)

      if (data.success) {
        setCheckpointStatus('success')

        const fileText =
          data.checkpoint?.changed_files === 1
            ? '1 file changed'
            : `${data.checkpoint?.changed_files || 0} files changed`

        toast.success('Checkpoint created', {
          description: fileText,
        })

        // Invalidate execution queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['executions'] })
        queryClient.invalidateQueries({ queryKey: ['issues'] })

        options?.onSuccess?.(data)
      } else if (data.conflicts && data.conflicts.length > 0) {
        setCheckpointStatus('conflict')

        const conflictFiles = data.conflicts.map((c) => c.path)
        const conflictList = conflictFiles.slice(0, 5).join('\n- ')
        const moreText = conflictFiles.length > 5 ? `\n...and ${conflictFiles.length - 5} more` : ''

        toast.error('Conflicts detected', {
          description: `Resolve conflicts before checkpointing:\n- ${conflictList}${moreText}`,
          duration: 10000,
        })

        options?.onConflict?.(data)
      } else {
        const errorMessage = data.error || 'Checkpoint failed'
        setCheckpointError(errorMessage)
        setCheckpointStatus('error')

        toast.error('Checkpoint failed', {
          description: errorMessage,
        })

        options?.onError?.(errorMessage)
      }
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Checkpoint failed'
      setCheckpointError(errorMessage)
      setCheckpointStatus('error')

      toast.error('Checkpoint failed', {
        description: errorMessage,
      })

      options?.onError?.(errorMessage)
    },
  })

  /**
   * Perform checkpoint operation
   */
  const performCheckpoint = useCallback(
    (executionId: string, checkpointOptions?: CheckpointOptions) => {
      checkpointMutation.mutate({
        executionId,
        checkpointOptions,
      })
    },
    [checkpointMutation]
  )

  /**
   * Open checkpoint dialog
   */
  const openCheckpointDialog = useCallback(() => {
    setIsCheckpointDialogOpen(true)
  }, [])

  /**
   * Close checkpoint dialog and reset state
   */
  const closeCheckpointDialog = useCallback(() => {
    setIsCheckpointDialogOpen(false)
    setCheckpointResult(null)
    setCheckpointError(null)
    setCheckpointStatus('idle')
  }, [])

  /**
   * Reset checkpoint state without closing dialog
   */
  const resetCheckpointState = useCallback(() => {
    setCheckpointResult(null)
    setCheckpointError(null)
    setCheckpointStatus('idle')
  }, [])

  return {
    // State
    checkpointStatus,
    checkpointResult,
    checkpointError,
    isCheckpointDialogOpen,

    // Actions
    performCheckpoint,
    openCheckpointDialog,
    closeCheckpointDialog,
    resetCheckpointState,

    // Dialog controls
    setIsCheckpointDialogOpen,

    // Loading states
    isCheckpointing: checkpointMutation.isPending,
  }
}
