import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { issuesApi } from '@/lib/api'
import type { PromoteOptions, PromoteResult } from '@/types/execution'

export type PromoteStatus = 'idle' | 'promoting' | 'success' | 'error' | 'blocked' | 'requires_approval' | 'conflict'

export interface UsePromoteOptions {
  onSuccess?: (result: PromoteResult) => void
  onError?: (error: string) => void
  onBlocked?: (blockedBy: string[]) => void
  onRequiresApproval?: () => void
  onConflict?: (result: PromoteResult) => void
}

/**
 * Hook for managing promote operations
 *
 * Provides state management and actions for:
 * - Promoting issue checkpoint to main branch
 * - Handling blocked dependencies
 * - Handling approval requirements
 * - Handling conflicts
 */
export function usePromote(options?: UsePromoteOptions) {
  const queryClient = useQueryClient()

  // Promote state
  const [promoteStatus, setPromoteStatus] = useState<PromoteStatus>('idle')
  const [promoteResult, setPromoteResult] = useState<PromoteResult | null>(null)
  const [promoteError, setPromoteError] = useState<string | null>(null)
  const [isPromoteDialogOpen, setIsPromoteDialogOpen] = useState(false)

  // Promote mutation
  const promoteMutation = useMutation({
    mutationFn: ({
      issueId,
      promoteOptions,
    }: {
      issueId: string
      promoteOptions?: PromoteOptions
    }) => issuesApi.promote(issueId, promoteOptions),
    onMutate: () => {
      setPromoteStatus('promoting')
      setPromoteError(null)
    },
    onSuccess: (data) => {
      setPromoteResult(data)

      if (data.success) {
        setPromoteStatus('success')

        const fileText =
          data.files_changed === 1
            ? '1 file changed'
            : `${data.files_changed || 0} files changed`

        toast.success('Promoted to main', {
          description: `${fileText} (${data.merge_commit?.substring(0, 7)})`,
        })

        // Invalidate issue and execution queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['issues'] })
        queryClient.invalidateQueries({ queryKey: ['executions'] })

        options?.onSuccess?.(data)
      } else if (data.blocked_by && data.blocked_by.length > 0) {
        setPromoteStatus('blocked')

        const blockedList = data.blocked_by.slice(0, 5).join(', ')
        const moreText = data.blocked_by.length > 5 ? ` and ${data.blocked_by.length - 5} more` : ''

        toast.error('Cannot promote', {
          description: `Blocked by: ${blockedList}${moreText}`,
          duration: 10000,
        })

        options?.onBlocked?.(data.blocked_by)
      } else if (data.requires_approval) {
        setPromoteStatus('requires_approval')

        toast.warning('Approval required', {
          description: 'Checkpoint must be approved before promotion',
        })

        options?.onRequiresApproval?.()
      } else if (data.conflicts && data.conflicts.length > 0) {
        setPromoteStatus('conflict')

        const conflictFiles = data.conflicts.map((c) => c.path)
        const conflictList = conflictFiles.slice(0, 5).join('\n- ')
        const moreText = conflictFiles.length > 5 ? `\n...and ${conflictFiles.length - 5} more` : ''

        toast.error('Conflicts detected', {
          description: `Resolve conflicts before promoting:\n- ${conflictList}${moreText}`,
          duration: 10000,
        })

        options?.onConflict?.(data)
      } else {
        const errorMessage = data.error || 'Promote failed'
        setPromoteError(errorMessage)
        setPromoteStatus('error')

        toast.error('Promote failed', {
          description: errorMessage,
        })

        options?.onError?.(errorMessage)
      }
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Promote failed'
      setPromoteError(errorMessage)
      setPromoteStatus('error')

      toast.error('Promote failed', {
        description: errorMessage,
      })

      options?.onError?.(errorMessage)
    },
  })

  /**
   * Perform promote operation
   */
  const performPromote = useCallback(
    (issueId: string, promoteOptions?: PromoteOptions) => {
      promoteMutation.mutate({
        issueId,
        promoteOptions,
      })
    },
    [promoteMutation]
  )

  /**
   * Open promote dialog
   */
  const openPromoteDialog = useCallback(() => {
    setIsPromoteDialogOpen(true)
  }, [])

  /**
   * Close promote dialog and reset state
   */
  const closePromoteDialog = useCallback(() => {
    setIsPromoteDialogOpen(false)
    setPromoteResult(null)
    setPromoteError(null)
    setPromoteStatus('idle')
  }, [])

  /**
   * Reset promote state without closing dialog
   */
  const resetPromoteState = useCallback(() => {
    setPromoteResult(null)
    setPromoteError(null)
    setPromoteStatus('idle')
  }, [])

  return {
    // State
    promoteStatus,
    promoteResult,
    promoteError,
    isPromoteDialogOpen,

    // Actions
    performPromote,
    openPromoteDialog,
    closePromoteDialog,
    resetPromoteState,

    // Dialog controls
    setIsPromoteDialogOpen,

    // Loading states
    isPromoting: promoteMutation.isPending,
  }
}
