import { useMutation, useQueryClient } from '@tanstack/react-query'
import { executionsApi } from '@/lib/api'
import { toast } from 'sonner'

/**
 * Hook for execution mutations with automatic cache invalidation
 *
 * Provides mutations for execution operations that automatically
 * invalidate relevant query caches.
 */
export function useExecutionMutations() {
  const queryClient = useQueryClient()

  /**
   * Delete execution mutation
   * Also invalidates worktrees cache if the worktree was deleted
   */
  const deleteExecutionMutation = useMutation({
    mutationFn: ({
      executionId,
      deleteBranch,
      deleteWorktree,
    }: {
      executionId: string
      deleteBranch?: boolean
      deleteWorktree?: boolean
    }) => executionsApi.delete(executionId, deleteBranch, deleteWorktree),
    onSuccess: (_, variables) => {
      // Always invalidate executions cache
      queryClient.invalidateQueries({ queryKey: ['executions'] })

      // If we deleted the worktree, also invalidate worktrees cache
      if (variables.deleteWorktree) {
        queryClient.invalidateQueries({ queryKey: ['worktrees'] })
      }
    },
    onError: (error: Error) => {
      console.error('Failed to delete execution:', error)
      toast.error('Failed to delete execution')
    },
  })

  return {
    deleteExecution: deleteExecutionMutation.mutateAsync,
    isDeletingExecution: deleteExecutionMutation.isPending,
  }
}
