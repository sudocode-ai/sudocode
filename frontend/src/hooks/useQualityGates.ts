import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { qualityGatesApi } from '@/lib/api'
import type { QualityGateConfigResponse, UpdateQualityGateConfigRequest } from '@/types/api'

/**
 * Hook for managing quality gate configuration
 */
export function useQualityGateConfig() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['quality-gates', 'config'],
    queryFn: qualityGatesApi.getConfig,
  })

  const updateMutation = useMutation({
    mutationFn: qualityGatesApi.updateConfig,
    onMutate: async (data: UpdateQualityGateConfigRequest) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['quality-gates', 'config'] })

      // Snapshot previous value
      const previousConfig = queryClient.getQueryData<QualityGateConfigResponse>([
        'quality-gates',
        'config',
      ])

      // Optimistically update
      queryClient.setQueryData<QualityGateConfigResponse>(
        ['quality-gates', 'config'],
        (old) => {
          if (!old) return old
          return {
            ...old,
            ...data,
            config: data.config !== undefined ? data.config : old.config,
          }
        }
      )

      return { previousConfig }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousConfig) {
        queryClient.setQueryData(['quality-gates', 'config'], context.previousConfig)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['quality-gates', 'config'] })
    },
  })

  return {
    config: query.data?.config ?? null,
    enabled: query.data?.enabled ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    updateConfig: updateMutation.mutate,
    updateConfigAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  }
}

/**
 * Hook for fetching quality gate results for a specific execution
 */
export function useQualityGateResults(executionId: string | undefined) {
  const query = useQuery({
    queryKey: ['quality-gates', 'results', executionId],
    queryFn: () => (executionId ? qualityGatesApi.getResults(executionId) : null),
    enabled: !!executionId,
    retry: false, // Don't retry if results don't exist yet
  })

  return {
    results: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
