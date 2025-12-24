/**
 * useRefreshEntity - Hook for refreshing entities from external sources
 *
 * Provides mutation functions for refreshing specs and issues,
 * with support for force refresh and cache invalidation.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { refreshApi, RefreshResponse } from '@/lib/api'
import { useProject } from '@/hooks/useProject'

export type EntityType = 'spec' | 'issue'

export interface UseRefreshEntityOptions {
  /** Entity ID to refresh */
  entityId: string
  /** Type of entity (spec or issue) */
  entityType: EntityType
  /** Callback when refresh is successful */
  onSuccess?: (result: RefreshResponse) => void
  /** Callback when refresh encounters conflicts */
  onConflict?: (result: RefreshResponse) => void
  /** Callback when entity is marked as stale */
  onStale?: (result: RefreshResponse) => void
  /** Callback when refresh fails */
  onError?: (error: Error) => void
}

export interface UseRefreshEntityResult {
  /** Trigger a refresh (non-forced) */
  refresh: () => Promise<RefreshResponse | undefined>
  /** Trigger a force refresh (overwrites local changes) */
  forceRefresh: () => Promise<RefreshResponse | undefined>
  /** Whether refresh is in progress */
  isRefreshing: boolean
  /** Whether force refresh is in progress */
  isForceRefreshing: boolean
  /** Last refresh result */
  data: RefreshResponse | undefined
  /** Last error */
  error: Error | null
  /** Reset mutation state */
  reset: () => void
}

/**
 * Hook for refreshing an entity from its external source
 */
export function useRefreshEntity({
  entityId,
  entityType,
  onSuccess,
  onConflict,
  onStale,
  onError,
}: UseRefreshEntityOptions): UseRefreshEntityResult {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  // Query key for cache invalidation
  const queryKey = entityType === 'spec' ? ['spec', currentProjectId, entityId] : ['issue', currentProjectId, entityId]
  const listQueryKey = entityType === 'spec' ? ['specs', currentProjectId] : ['issues', currentProjectId]

  // Non-force refresh mutation
  const refreshMutation = useMutation<RefreshResponse, Error, void>({
    mutationFn: async () => {
      if (entityType === 'spec') {
        return refreshApi.refreshSpec(entityId, false)
      } else {
        return refreshApi.refreshIssue(entityId, false)
      }
    },
    mutationKey: ['refresh', entityType, entityId, false],
    onSuccess: (result) => {
      if (result.stale) {
        onStale?.(result)
        return
      }

      if (result.hasLocalChanges && !result.updated) {
        // Conflict detected
        onConflict?.(result)
        return
      }

      if (result.updated) {
        // Successfully updated
        queryClient.invalidateQueries({ queryKey })
        queryClient.invalidateQueries({ queryKey: listQueryKey })
        toast.success('Entity refreshed from external source')
        onSuccess?.(result)
        return
      }

      // No changes needed
      toast.info('Entity is already up to date')
      onSuccess?.(result)
    },
    onError: (error) => {
      toast.error(`Refresh failed: ${error.message}`)
      onError?.(error)
    },
  })

  // Force refresh mutation
  const forceRefreshMutation = useMutation<RefreshResponse, Error, void>({
    mutationFn: async () => {
      if (entityType === 'spec') {
        return refreshApi.refreshSpec(entityId, true)
      } else {
        return refreshApi.refreshIssue(entityId, true)
      }
    },
    mutationKey: ['refresh', entityType, entityId, true],
    onSuccess: (result) => {
      if (result.stale) {
        onStale?.(result)
        return
      }

      if (result.updated) {
        queryClient.invalidateQueries({ queryKey })
        queryClient.invalidateQueries({ queryKey: listQueryKey })
        toast.success('Entity updated with remote changes')
        onSuccess?.(result)
        return
      }

      // No changes (shouldn't happen with force, but handle gracefully)
      toast.info('No changes to apply')
      onSuccess?.(result)
    },
    onError: (error) => {
      toast.error(`Force refresh failed: ${error.message}`)
      onError?.(error)
    },
  })

  return {
    refresh: refreshMutation.mutateAsync,
    forceRefresh: forceRefreshMutation.mutateAsync,
    isRefreshing: refreshMutation.isPending,
    isForceRefreshing: forceRefreshMutation.isPending,
    data: refreshMutation.data ?? forceRefreshMutation.data,
    error: refreshMutation.error ?? forceRefreshMutation.error,
    reset: () => {
      refreshMutation.reset()
      forceRefreshMutation.reset()
    },
  }
}
