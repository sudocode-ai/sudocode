import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { executionsApi } from '@/lib/api'
import { useWorktreeMutations } from './useWorktreeMutations'
import type { SyncPreviewResult, SyncResult, SyncMode, Execution } from '@/types/execution'

export type SyncStatus = 'idle' | 'previewing' | 'syncing' | 'success' | 'error'

export interface UseExecutionSyncOptions {
  onSyncSuccess?: (result: SyncResult) => void
  onSyncError?: (error: string) => void
}

/**
 * Hook for managing execution worktree sync operations
 *
 * Provides state management and actions for:
 * - Previewing sync changes
 * - Performing sync (squash or preserve modes)
 * - Opening worktree in IDE
 * - Managing sync dialogs
 */
export function useExecutionSync(options?: UseExecutionSyncOptions) {
  const queryClient = useQueryClient()
  const { deleteWorktree: deleteWorktreeMutation } = useWorktreeMutations()

  // Sync state
  const [syncPreview, setSyncPreview] = useState<SyncPreviewResult | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [isSyncPreviewOpen, setIsSyncPreviewOpen] = useState(false)
  const [isSyncProgressOpen, setIsSyncProgressOpen] = useState(false)

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: (executionId: string) => executionsApi.syncPreview(executionId),
    onMutate: () => {
      setSyncStatus('previewing')
      setSyncError(null)
    },
    onSuccess: (data) => {
      setSyncPreview(data)
      setSyncStatus('idle')
      setIsSyncPreviewOpen(true)
    },
    onError: (error: Error) => {
      const errorMessage = mapErrorToUserMessage(error.message)
      setSyncError(errorMessage)
      setSyncStatus('error')
      toast.error('Failed to load merge preview', {
        description: errorMessage,
      })
    },
  })

  // Track the current sync mode for toast messages
  const [currentSyncMode, setCurrentSyncMode] = useState<SyncMode | null>(null)

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: ({
      executionId,
      mode,
      commitMessage,
      includeUncommitted,
    }: {
      executionId: string
      mode: SyncMode
      commitMessage?: string
      includeUncommitted?: boolean
    }) => {
      if (mode === 'stage') {
        return executionsApi.syncStage(executionId, { includeUncommitted })
      }
      const request = commitMessage ? { mode, commitMessage } : { mode }
      return mode === 'squash'
        ? executionsApi.syncSquash(executionId, request)
        : executionsApi.syncPreserve(executionId, request)
    },
    onMutate: ({ mode }) => {
      setSyncStatus('syncing')
      setSyncError(null)
      setCurrentSyncMode(mode)
      setIsSyncPreviewOpen(false)
      setIsSyncProgressOpen(true)
    },
    onSuccess: (data) => {
      setSyncResult(data)

      if (data.success) {
        setSyncStatus('success')

        // Show mode-specific success toast
        const fileText =
          data.filesChanged === 1 ? '1 file changed' : `${data.filesChanged} files changed`
        const successMessage = getSuccessMessage(currentSyncMode)
        toast.success(successMessage, {
          description: fileText,
        })

        // Invalidate execution queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['executions'] })

        // Call success callback
        options?.onSyncSuccess?.(data)
      } else {
        const errorMessage = data.error || 'Sync failed'
        setSyncError(errorMessage)
        setSyncStatus('error')
        const failureMessage = getFailureMessage(currentSyncMode)
        toast.error(failureMessage, {
          description: errorMessage,
        })
        options?.onSyncError?.(errorMessage)
      }
    },
    onError: (error: Error) => {
      const errorMessage = mapErrorToUserMessage(error.message)
      setSyncError(errorMessage)
      setSyncStatus('error')
      const failureMessage = getFailureMessage(currentSyncMode)
      toast.error(failureMessage, {
        description: errorMessage,
      })
      options?.onSyncError?.(errorMessage)
    },
  })

  /**
   * Fetch sync preview
   */
  const fetchSyncPreview = useCallback(
    (executionId: string) => {
      previewMutation.mutate(executionId)
    },
    [previewMutation]
  )

  /**
   * Perform sync operation
   */
  const performSync = useCallback(
    (
      executionId: string,
      mode: SyncMode,
      options?: { commitMessage?: string; includeUncommitted?: boolean }
    ) => {
      syncMutation.mutate({
        executionId,
        mode,
        commitMessage: options?.commitMessage,
        includeUncommitted: options?.includeUncommitted,
      })
    },
    [syncMutation]
  )

  /**
   * Open worktree in IDE
   */
  const openWorktreeInIDE = useCallback(async (execution: Execution) => {
    if (!execution.worktree_path) {
      toast.error('No worktree path available')
      return
    }

    try {
      await executionsApi.openInIde(execution.worktree_path)
      toast.success('Opening worktree in IDE...')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open IDE'
      toast.error(message)
    }
  }, [])

  /**
   * Cleanup worktree
   */
  const cleanupWorktree = useCallback(
    async (executionId: string, deleteBranch?: boolean) => {
      try {
        // Use centralized mutation which handles cache invalidation
        await deleteWorktreeMutation({ executionId, deleteBranch })

        // Close progress dialog
        setIsSyncProgressOpen(false)
      } catch (error) {
        console.error('Failed to cleanup worktree:', error)
        setSyncError(error instanceof Error ? error.message : 'Failed to cleanup worktree')
        throw error
      }
    },
    [deleteWorktreeMutation]
  )

  /**
   * Close all sync dialogs and reset state
   */
  const closeSyncDialogs = useCallback(() => {
    setIsSyncPreviewOpen(false)
    setIsSyncProgressOpen(false)
    setSyncPreview(null)
    setSyncResult(null)
    setSyncError(null)
    setSyncStatus('idle')
  }, [])

  /**
   * Reset sync state without closing dialogs
   */
  const resetSyncState = useCallback(() => {
    setSyncPreview(null)
    setSyncResult(null)
    setSyncError(null)
    setSyncStatus('idle')
  }, [])

  return {
    // State
    syncPreview,
    syncStatus,
    syncResult,
    syncError,
    isSyncPreviewOpen,
    isSyncProgressOpen,

    // Actions
    fetchSyncPreview,
    performSync,
    openWorktreeInIDE,
    cleanupWorktree,
    closeSyncDialogs,
    resetSyncState,

    // Dialog controls
    setIsSyncPreviewOpen,
    setIsSyncProgressOpen,

    // Loading states
    isPreviewing: previewMutation.isPending,
    isSyncing: syncMutation.isPending,
  }
}

/**
 * Get mode-specific success message
 */
function getSuccessMessage(mode: SyncMode | null): string {
  switch (mode) {
    case 'squash':
      return 'Squash and merge completed'
    case 'preserve':
      return 'Commits merged successfully'
    case 'stage':
      return 'Changes staged successfully'
    default:
      return 'Changes merged successfully'
  }
}

/**
 * Get mode-specific failure message
 */
function getFailureMessage(mode: SyncMode | null): string {
  switch (mode) {
    case 'squash':
      return 'Squash and merge failed'
    case 'preserve':
      return 'Merge commits failed'
    case 'stage':
      return 'Failed to stage changes'
    default:
      return 'Merge failed'
  }
}

/**
 * Map backend error codes to user-friendly messages
 */
function mapErrorToUserMessage(errorMessage: string): string {
  if (errorMessage.includes('CODE_CONFLICTS')) {
    return 'Code conflicts detected. Open worktree in IDE to resolve conflicts before syncing.'
  }

  if (errorMessage.includes('DIRTY_WORKING_TREE')) {
    return 'Local working tree has uncommitted changes. Commit or stash them first.'
  }

  if (errorMessage.includes('WORKTREE_MISSING')) {
    return 'Worktree directory not found. It may have been deleted.'
  }

  if (errorMessage.includes('NO_COMMON_BASE')) {
    return 'Branches have diverged too much. Manual merge required.'
  }

  if (errorMessage.includes('BRANCH_MISSING')) {
    return 'Worktree branch not found. The branch may have been deleted.'
  }

  if (errorMessage.includes('TARGET_BRANCH_MISSING')) {
    return 'Target branch not found. The branch may have been deleted.'
  }

  // Default: return the original error message
  return errorMessage
}
