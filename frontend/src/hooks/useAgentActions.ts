import { useMemo, useCallback, useState } from 'react'
import { GitCommit, GitMerge, Trash2 } from 'lucide-react'
import type { Execution } from '@/types/execution'
import type { LucideIcon } from 'lucide-react'
import { useExecutionSync } from './useExecutionSync'
import { toast } from 'sonner'
import { executionsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Represents a contextual action available to the user
 */
export interface AgentAction {
  id: string
  label: string
  icon: LucideIcon
  description?: string
  onClick: () => void | Promise<void>
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost' | 'link'
  disabled?: boolean
  badge?: string | number // Optional badge to show count (e.g., "3 files")
}

/**
 * Options for configuring the useAgentActions hook
 */
interface UseAgentActionsOptions {
  /**
   * Current or latest execution to analyze for available actions
   */
  execution?: Execution | null

  /**
   * Issue ID for context
   */
  issueId: string

  /**
   * Whether actions should be disabled (e.g., when another operation is in progress)
   */
  disabled?: boolean
}

/**
 * Hook to compute available contextual actions based on execution state
 *
 * This hook analyzes the current execution state and returns a list of
 * actions that are available to the user, such as:
 * - Committing code changes
 * - Syncing worktree to target branch
 * - Cleaning up worktree
 *
 * @example
 * ```tsx
 * const { actions, hasActions } = useAgentActions({
 *   execution: latestExecution,
 *   issueId: issue.id,
 * })
 * ```
 */
export function useAgentActions(options: UseAgentActionsOptions) {
  const { execution, issueId, disabled = false } = options

  // Query client for invalidating queries
  const queryClient = useQueryClient()

  // Use execution sync hook for worktree operations
  const {
    fetchSyncPreview,
    syncPreview,
    isSyncPreviewOpen,
    setIsSyncPreviewOpen,
    performSync,
    isPreviewing,
    syncStatus,
  } = useExecutionSync()

  // Dialog visibility state
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false)
  const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false)

  // Loading states
  const [isCommitting, setIsCommitting] = useState(false)
  const [isCleaning, setIsCleaning] = useState(false)

  // Action handler: Commit changes
  const handleCommitChanges = useCallback(
    async (message: string) => {
      if (!execution) return

      setIsCommitting(true)
      try {
        await executionsApi.commit(execution.id, { message })
        toast.success('Changes committed successfully')
        setIsCommitDialogOpen(false)

        // Invalidate execution queries
        queryClient.invalidateQueries({ queryKey: ['executions'] })
      } catch (error) {
        toast.error('Failed to commit changes', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsCommitting(false)
      }
    },
    [execution, queryClient]
  )

  // Action handler: Sync worktree
  const handleSyncWorktree = useCallback(() => {
    if (!execution) return

    try {
      // Open sync preview dialog
      fetchSyncPreview(execution.id)
    } catch (error) {
      console.error('Failed to open sync preview:', error)
      toast.error('Failed to open sync preview')
    }
  }, [execution, fetchSyncPreview])

  // Action handler: Cleanup worktree
  const handleCleanupWorktree = useCallback(
    async (deleteBranch: boolean) => {
      if (!execution) return

      setIsCleaning(true)
      try {
        await executionsApi.deleteWorktree(execution.id, deleteBranch)
        toast.success('Worktree cleaned up', {
          description: deleteBranch ? 'Branch also deleted' : 'Branch preserved',
        })
        setIsCleanupDialogOpen(false)

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['executions'] })
        queryClient.invalidateQueries({ queryKey: ['worktrees'] })
      } catch (error) {
        toast.error('Failed to cleanup worktree', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsCleaning(false)
      }
    },
    [execution, queryClient]
  )

  const actions = useMemo(() => {
    const availableActions: AgentAction[] = []

    // No actions if no execution
    if (!execution) {
      return availableActions
    }

    // Parse config if it's a JSON string
    let parsedConfig: any = null
    if (execution.config) {
      try {
        parsedConfig =
          typeof execution.config === 'string' ? JSON.parse(execution.config) : execution.config
      } catch (error) {
        console.warn('Failed to parse execution config:', error)
      }
    }

    // Parse files_changed if it's a JSON string
    let filesChanged: string[] = []
    if (execution.files_changed) {
      try {
        const parsed =
          typeof execution.files_changed === 'string'
            ? JSON.parse(execution.files_changed)
            : execution.files_changed
        filesChanged = Array.isArray(parsed) ? parsed : [parsed]
      } catch (error) {
        // If it's not JSON, treat it as a single file path
        filesChanged = [execution.files_changed]
      }
    }

    // Determine execution mode and state
    const isWorktreeMode = execution.mode === 'worktree' || parsedConfig?.mode === 'worktree'
    const hasWorktreePath = !!execution.worktree_path
    const hasUncommittedChanges = filesChanged.length > 0 && !execution.after_commit
    const isTerminalState = ['completed', 'failed', 'stopped', 'cancelled'].includes(
      execution.status
    )

    if (hasUncommittedChanges && isTerminalState) {
      const fileCount = filesChanged.length
      availableActions.push({
        id: 'commit-changes',
        label: 'Commit Changes',
        icon: GitCommit,
        description: `Commit ${fileCount} file change${fileCount !== 1 ? 's' : ''}`,
        onClick: () => setIsCommitDialogOpen(true),
        variant: 'outline',
        disabled,
        badge: fileCount,
      })
    }

    // Action: Squash & Merge
    // Available for worktree mode with file changes
    const hasSyncableWorktree = hasWorktreePath && isWorktreeMode && filesChanged.length > 0

    if (hasSyncableWorktree) {
      availableActions.push({
        id: 'squash-merge',
        label: 'Squash & Merge',
        icon: GitMerge,
        description: 'Sync worktree changes to local branch',
        onClick: handleSyncWorktree,
        variant: 'outline',
        disabled,
      })
    }

    // Action: Cleanup Worktree
    // Available whenever there's a worktree (user can clean up at any time)
    const canCleanup = isWorktreeMode && hasWorktreePath

    if (canCleanup) {
      availableActions.push({
        id: 'cleanup-worktree',
        label: 'Cleanup Worktree',
        icon: Trash2,
        description: 'Delete worktree and optionally the branch',
        onClick: () => setIsCleanupDialogOpen(true),
        variant: 'outline',
        disabled,
      })
    }

    return availableActions
  }, [execution, issueId, disabled, handleSyncWorktree])

  return {
    /**
     * List of available actions
     */
    actions,

    /**
     * Whether there are any actions available
     */
    hasActions: actions.length > 0,

    /**
     * Helper to get a specific action by id
     */
    getAction: (id: string) => actions.find((action) => action.id === id),

    // Dialog state
    isCommitDialogOpen,
    setIsCommitDialogOpen,
    isCleanupDialogOpen,
    setIsCleanupDialogOpen,

    // Loading states
    isCommitting,
    isCleaning,

    // Handlers
    handleCommitChanges,
    handleCleanupWorktree,

    // Sync dialog state (for SyncPreviewDialog)
    syncPreview,
    isSyncPreviewOpen,
    setIsSyncPreviewOpen,
    performSync,
    isPreviewing,
    syncStatus,
  }
}
