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

  /**
   * Whether the worktree still exists on disk (for worktree mode executions)
   * If false, worktree-related actions (commit, sync, cleanup) will be hidden
   */
  worktreeExists?: boolean

  /**
   * Callback called after worktree cleanup completes successfully
   * Use this to update local state (e.g., worktreeExists)
   */
  onCleanupComplete?: () => void

  /**
   * Callback called after commit completes successfully
   * Use this to reload execution data to reflect committed state
   */
  onCommitComplete?: () => void

  /**
   * Whether the worktree has uncommitted changes (for worktree mode)
   * If false, commit action will be hidden even if files_changed is set
   * Defaults to undefined (uses files_changed as fallback)
   */
  hasUncommittedChanges?: boolean

  /**
   * Number of commits the worktree branch is ahead of the target branch
   * If 0, the Merge Changes action will be hidden (nothing to merge)
   * Defaults to undefined (assumes there are commits to merge)
   */
  commitsAhead?: number
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
  const {
    execution,
    issueId,
    disabled = false,
    worktreeExists = true,
    onCleanupComplete,
    onCommitComplete,
    hasUncommittedChanges,
    commitsAhead,
  } = options

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

  // Refresh trigger for CodeChangesPanel - incremented after successful actions
  const [changesRefreshTrigger, setChangesRefreshTrigger] = useState(0)

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

        // Trigger CodeChangesPanel refresh
        setChangesRefreshTrigger((prev) => prev + 1)

        // Notify parent component to refresh data
        onCommitComplete?.()
      } catch (error) {
        toast.error('Failed to commit changes', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsCommitting(false)
      }
    },
    [execution, queryClient, onCommitComplete]
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

        // Notify parent component
        onCleanupComplete?.()
      } catch (error) {
        toast.error('Failed to cleanup worktree', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsCleaning(false)
      }
    },
    [execution, queryClient, onCleanupComplete]
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
    const hasFileChanges = filesChanged.length > 0
    const isTerminalState = ['completed', 'failed', 'stopped', 'cancelled'].includes(
      execution.status
    )

    // Action: Commit Changes
    // For worktree mode: show when there are uncommitted changes AND worktree still exists
    // For local mode: show when there are uncommitted changes
    // Use hasUncommittedChanges if provided, otherwise fall back to hasFileChanges
    const hasChangesToCommit =
      hasUncommittedChanges !== undefined ? hasUncommittedChanges : hasFileChanges
    const showCommitAction = isWorktreeMode
      ? hasChangesToCommit && hasWorktreePath && worktreeExists
      : hasChangesToCommit

    if (showCommitAction && isTerminalState) {
      const fileCount = filesChanged.length
      availableActions.push({
        id: 'commit-changes',
        label: 'Commit Changes',
        icon: GitCommit,
        description: `Commit ${fileCount} file change${fileCount !== 1 ? 's' : ''}`,
        onClick: () => setIsCommitDialogOpen(true),
        variant: 'secondary',
        disabled,
        badge: fileCount > 0 ? fileCount : undefined,
      })
    }

    // Action: Merge Changes
    // Available for worktree mode when worktree exists and has commits to merge
    // If commitsAhead is provided and is 0, don't show the action (nothing to merge)
    const hasCommitsToMerge = commitsAhead === undefined || commitsAhead > 0
    const hasSyncableWorktree = hasWorktreePath && isWorktreeMode && worktreeExists && hasCommitsToMerge

    if (hasSyncableWorktree) {
      availableActions.push({
        id: 'squash-merge',
        label: 'Merge Changes',
        icon: GitMerge,
        description: 'Sync worktree changes to local branch',
        onClick: handleSyncWorktree,
        variant: 'secondary',
        disabled,
      })
    }

    // Action: Cleanup Worktree
    // Available whenever there's a worktree that still exists
    const canCleanup = isWorktreeMode && hasWorktreePath && worktreeExists

    if (canCleanup) {
      availableActions.push({
        id: 'cleanup-worktree',
        label: 'Cleanup Worktree',
        icon: Trash2,
        description: 'Delete worktree and optionally the branch',
        onClick: () => setIsCleanupDialogOpen(true),
        variant: 'secondary',
        disabled,
      })
    }

    return availableActions
  }, [execution, issueId, disabled, handleSyncWorktree, worktreeExists, hasUncommittedChanges, commitsAhead])

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

    // Refresh trigger for CodeChangesPanel
    changesRefreshTrigger,

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
