import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { executionsApi } from '@/lib/api'

export type ConflictStrategy = 'ours' | 'theirs' | 'manual'

export interface ExecutionConflict {
  id: string
  execution_id: string
  path: string
  type: 'code' | 'jsonl' | 'binary'
  auto_resolvable: boolean
  conflicting_stream_id?: string
  conflicting_issue_id?: string
  details?: string
  detected_at: string
  resolved_at?: string
  resolution_strategy?: string
}

export interface UseConflictResolutionOptions {
  onResolveSuccess?: () => void
  onResolveError?: (error: string) => void
  onAllResolved?: () => void
}

/**
 * Hook for managing execution conflict resolution
 *
 * Provides state management and actions for:
 * - Fetching conflicts for an execution
 * - Resolving individual conflicts
 * - Bulk resolving all conflicts
 * - Retrying sync after resolution
 */
export function useConflictResolution(
  executionId: string | undefined,
  options?: UseConflictResolutionOptions
) {
  const queryClient = useQueryClient()

  // Query for fetching conflicts
  const conflictsQuery = useQuery({
    queryKey: ['execution-conflicts', executionId],
    queryFn: () => executionsApi.getConflicts(executionId!),
    enabled: !!executionId,
    refetchInterval: (query) => {
      // Only refetch if there are unresolved conflicts
      if (query.state.data?.hasUnresolved) {
        return 5000 // Refetch every 5 seconds while there are unresolved conflicts
      }
      return false
    },
  })

  // Mutation for resolving a single conflict
  const resolveMutation = useMutation({
    mutationFn: ({
      conflictId,
      strategy,
    }: {
      conflictId: string
      strategy: ConflictStrategy
    }) => executionsApi.resolveConflict(executionId!, conflictId, strategy),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['execution-conflicts', executionId] })

      if (data.allResolved) {
        toast.success('All conflicts resolved')
        options?.onAllResolved?.()
      } else {
        toast.success(`Conflict resolved (${data.remainingConflicts} remaining)`)
      }

      options?.onResolveSuccess?.()
    },
    onError: (error: Error) => {
      toast.error('Failed to resolve conflict', {
        description: error.message,
      })
      options?.onResolveError?.(error.message)
    },
  })

  // Mutation for resolving all conflicts
  const resolveAllMutation = useMutation({
    mutationFn: (strategy: 'ours' | 'theirs') =>
      executionsApi.resolveAllConflicts(executionId!, strategy),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['execution-conflicts', executionId] })
      queryClient.invalidateQueries({ queryKey: ['executions'] })

      if (data.allResolved) {
        toast.success(`All ${data.resolved} conflicts resolved`)
        options?.onAllResolved?.()
      } else if (data.failed > 0) {
        toast.warning(`Resolved ${data.resolved} conflicts, ${data.failed} failed`, {
          description: data.errors?.slice(0, 3).join('\n'),
        })
      }

      options?.onResolveSuccess?.()
    },
    onError: (error: Error) => {
      toast.error('Failed to resolve conflicts', {
        description: error.message,
      })
      options?.onResolveError?.(error.message)
    },
  })

  // Mutation for retrying after resolution
  const retryMutation = useMutation({
    mutationFn: () => executionsApi.retryAfterConflictResolution(executionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      toast.success('Ready to sync', {
        description: 'Use squash, preserve, or stage to complete the sync.',
      })
    },
    onError: (error: Error) => {
      toast.error('Cannot retry yet', {
        description: error.message,
      })
    },
  })

  /**
   * Resolve a single conflict
   */
  const resolveConflict = useCallback(
    (conflictId: string, strategy: ConflictStrategy) => {
      resolveMutation.mutate({ conflictId, strategy })
    },
    [resolveMutation]
  )

  /**
   * Resolve all conflicts with the same strategy
   */
  const resolveAll = useCallback(
    (strategy: 'ours' | 'theirs') => {
      resolveAllMutation.mutate(strategy)
    },
    [resolveAllMutation]
  )

  /**
   * Retry the original operation after conflicts are resolved
   */
  const retryOperation = useCallback(() => {
    retryMutation.mutate()
  }, [retryMutation])

  /**
   * Refetch conflicts
   */
  const refetchConflicts = useCallback(() => {
    conflictsQuery.refetch()
  }, [conflictsQuery])

  // Computed values
  const conflicts = conflictsQuery.data?.conflicts ?? []
  const hasUnresolved = conflictsQuery.data?.hasUnresolved ?? false
  const unresolvedConflicts = conflicts.filter((c) => !c.resolved_at)
  const resolvedConflicts = conflicts.filter((c) => c.resolved_at)

  return {
    // Data
    conflicts,
    unresolvedConflicts,
    resolvedConflicts,
    hasUnresolved,

    // Loading states
    isLoading: conflictsQuery.isLoading,
    isResolving: resolveMutation.isPending,
    isResolvingAll: resolveAllMutation.isPending,
    isRetrying: retryMutation.isPending,

    // Error states
    error: conflictsQuery.error,

    // Actions
    resolveConflict,
    resolveAll,
    retryOperation,
    refetchConflicts,
  }
}
