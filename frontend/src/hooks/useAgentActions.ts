import { useMemo, useCallback } from 'react'
import { GitCommit, CheckCircle, GitBranch, FolderOpen } from 'lucide-react'
import type { Execution } from '@/types/execution'
import type { LucideIcon } from 'lucide-react'
import { useExecutionSync } from './useExecutionSync'
import { toast } from 'sonner'

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
   * Optional callback to start a new execution (for verify action)
   * If not provided, verify action will use a default prompt
   */
  onStartExecution?: (prompt: string) => void | Promise<void>
}

/**
 * Hook to compute available contextual actions based on execution state
 *
 * This hook analyzes the current execution state and returns a list of
 * actions that are available to the user, such as:
 * - Committing code changes
 * - Syncing worktree to target branch
 * - Spawning verification agents
 * - Opening worktree in IDE
 *
 * @example
 * ```tsx
 * const { actions, hasActions } = useAgentActions({
 *   execution: latestExecution,
 *   issueId: issue.id,
 *   onStartExecution: handleStartExecution, // Optional: for verify action
 * })
 * ```
 */
export function useAgentActions(options: UseAgentActionsOptions) {
  const { execution, issueId, disabled = false, onStartExecution } = options

  // Use execution sync hook for worktree operations
  const { fetchSyncPreview, openWorktreeInIDE } = useExecutionSync()

  // Action handler: Commit changes
  const handleCommitChanges = useCallback(async () => {
    if (!execution) return

    try {
      // TODO: Implement actual commit API call
      // await executionsApi.commitChanges(execution.id)
      toast.success('Commit changes functionality coming soon')
      console.log('Committing changes for execution:', execution.id)
    } catch (error) {
      console.error('Failed to commit changes:', error)
      toast.error('Failed to commit changes')
    }
  }, [execution])

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

  // Action handler: Open worktree in IDE
  const handleOpenWorktree = useCallback(async () => {
    if (!execution) return

    try {
      await openWorktreeInIDE(execution)
    } catch (error) {
      console.error('Failed to open worktree:', error)
      toast.error('Failed to open worktree in IDE')
    }
  }, [execution, openWorktreeInIDE])

  // Action handler: Verify code
  const handleVerifyCode = useCallback(async () => {
    if (!execution) return

    try {
      const verificationPrompt = `Review and verify the implementation from execution ${execution.id}`

      if (onStartExecution) {
        await onStartExecution(verificationPrompt)
      } else {
        // Fallback: just show the prompt
        toast.info('Verification prompt ready', {
          description: verificationPrompt,
        })
        console.log('Verification prompt:', verificationPrompt)
      }
    } catch (error) {
      console.error('Failed to start verification:', error)
      toast.error('Failed to start verification agent')
    }
  }, [execution, onStartExecution])

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
        filesChanged =
          typeof execution.files_changed === 'string'
            ? JSON.parse(execution.files_changed)
            : execution.files_changed
      } catch (error) {
        // If it's not JSON, treat it as a single file path
        filesChanged = [execution.files_changed]
      }
    }

    // Action: Commit changes
    // Show when execution completed and has file changes
    // Note: We assume changes are uncommitted if after_commit is null
    const hasUncommittedChanges =
      execution.status === 'completed' && filesChanged.length > 0 && !execution.after_commit

    if (hasUncommittedChanges) {
      const fileCount = filesChanged.length
      availableActions.push({
        id: 'commit-changes',
        label: 'Commit Changes',
        icon: GitCommit,
        description: `Commit ${fileCount} file change${fileCount !== 1 ? 's' : ''}`,
        onClick: handleCommitChanges,
        variant: 'outline',
        disabled,
        badge: fileCount,
      })
    }

    // Determine if execution is in worktree mode
    const isWorktreeMode = execution.mode === 'worktree' || parsedConfig?.mode === 'worktree'
    const hasWorktreePath = !!execution.worktree_path

    // Debug logging for worktree actions
    if (hasWorktreePath || filesChanged.length > 0) {
    }

    // Action: Open worktree in IDE
    // Show when execution has an active worktree (regardless of status)
    // Per i-xdp0: Available when execution has worktree_path
    if (hasWorktreePath && isWorktreeMode) {
      availableActions.push({
        id: 'open-worktree',
        label: 'Open in IDE',
        icon: FolderOpen,
        description: 'Open worktree directory in your IDE',
        onClick: handleOpenWorktree,
        variant: 'outline',
        disabled,
      })
    }

    // Action: Sync worktree to local
    // Show when execution has worktree and there are code changes
    // Per i-xdp0: Available for ALL execution states when worktree_path exists
    const hasSyncableWorktree = hasWorktreePath && isWorktreeMode && filesChanged.length > 0

    if (hasSyncableWorktree) {
      availableActions.push({
        id: 'sync-worktree',
        label: 'Sync to Local',
        icon: GitBranch,
        description: 'Sync worktree changes to local branch',
        onClick: handleSyncWorktree,
        variant: 'outline',
        disabled,
      })
    }

    // Action: Verify code
    // Show when execution completed successfully
    const canVerify = execution.status === 'completed'

    if (canVerify) {
      availableActions.push({
        id: 'verify-code',
        label: 'Verify Code',
        icon: CheckCircle,
        description: 'Spawn an agent to verify the implementation',
        onClick: handleVerifyCode,
        variant: 'outline',
        disabled,
      })
    }

    // Future actions can be added here:
    // - Review changes (spawn review agent)
    // - Run tests (trigger test execution)
    // - Deploy changes (if CI/CD integration)
    // - Create PR (if worktree ready)
    // - Rollback changes
    // etc.

    return availableActions
  }, [
    execution,
    issueId,
    disabled,
    handleCommitChanges,
    handleSyncWorktree,
    handleOpenWorktree,
    handleVerifyCode,
  ])

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
  }
}
