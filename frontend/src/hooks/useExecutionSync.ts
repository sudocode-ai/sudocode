import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { executionsApi } from '@/lib/api'
import type {
  SyncPreviewResult,
  SyncResult,
  SyncMode,
  Execution
} from '@/types/execution'

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
    },
  })

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: ({
      executionId,
      mode,
      commitMessage
    }: {
      executionId: string
      mode: SyncMode
      commitMessage?: string
    }) => {
      const request = commitMessage ? { mode, commitMessage } : { mode }
      return mode === 'squash'
        ? executionsApi.syncSquash(executionId, request)
        : executionsApi.syncPreserve(executionId, request)
    },
    onMutate: () => {
      setSyncStatus('syncing')
      setSyncError(null)
      setIsSyncPreviewOpen(false)
      setIsSyncProgressOpen(true)
    },
    onSuccess: (data) => {
      setSyncResult(data)

      if (data.success) {
        setSyncStatus('success')

        // Invalidate execution queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['executions'] })

        // Call success callback
        options?.onSyncSuccess?.(data)
      } else {
        const errorMessage = data.error || 'Sync failed'
        setSyncError(errorMessage)
        setSyncStatus('error')
        options?.onSyncError?.(errorMessage)
      }
    },
    onError: (error: Error) => {
      const errorMessage = mapErrorToUserMessage(error.message)
      setSyncError(errorMessage)
      setSyncStatus('error')
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
    (executionId: string, mode: SyncMode, commitMessage?: string) => {
      syncMutation.mutate({ executionId, mode, commitMessage })
    },
    [syncMutation]
  )

  /**
   * Open worktree in IDE
   */
  const openWorktreeInIDE = useCallback(async (execution: Execution) => {
    if (!execution.worktree_path) {
      console.error('No worktree path available')
      return
    }

    try {
      // Note: In browser context, we can't execute shell commands directly
      // This would need to be handled via an API endpoint that executes on the server
      // For now, we'll copy the path to clipboard and notify user
      await navigator.clipboard.writeText(execution.worktree_path)

      console.log('Worktree path copied to clipboard:', execution.worktree_path)
      // TODO: Show toast notification to user
      alert(`Worktree path copied to clipboard:\n${execution.worktree_path}\n\nOpen it manually in your IDE.`)
    } catch (error) {
      console.error('Failed to open worktree in IDE:', error)
    }
  }, [])

  /**
   * Cleanup worktree (stub for now)
   */
  const cleanupWorktree = useCallback(
    async (executionId: string) => {
      try {
        await executionsApi.deleteWorktree(executionId)

        // Invalidate execution queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['executions'] })

        // Close progress dialog
        setIsSyncProgressOpen(false)
      } catch (error) {
        console.error('Failed to cleanup worktree:', error)
        setSyncError(error instanceof Error ? error.message : 'Failed to cleanup worktree')
      }
    },
    [queryClient]
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
