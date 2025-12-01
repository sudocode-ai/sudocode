import { useMutation, useQueryClient } from '@tanstack/react-query'
import { executionsApi } from '@/lib/api'
import { toast } from 'sonner'

/**
 * Hook for worktree mutations with automatic cache invalidation
 *
 * Provides mutations for worktree operations that automatically
 * invalidate relevant query caches.
 */
export function useWorktreeMutations() {
  const queryClient = useQueryClient()

  /**
   * Delete worktree mutation
   */
  const deleteWorktreeMutation = useMutation({
    mutationFn: ({ executionId, deleteBranch }: { executionId: string; deleteBranch?: boolean }) =>
      executionsApi.deleteWorktree(executionId, deleteBranch),
    onSuccess: () => {
      // Invalidate worktrees and executions caches
      queryClient.invalidateQueries({ queryKey: ['worktrees'] })
      queryClient.invalidateQueries({ queryKey: ['executions'] })
    },
    onError: (error: Error) => {
      console.error('Failed to delete worktree:', error)
      toast.error('Failed to delete worktree')
    },
  })

  return {
    deleteWorktree: deleteWorktreeMutation.mutateAsync,
    isDeletingWorktree: deleteWorktreeMutation.isPending,
  }
}
