import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { specsApi } from '@/lib/api'
import { useWebSocket } from '@/lib/websocket'
import type { Spec, WebSocketMessage } from '@/types/api'

/**
 * Hook for managing specs with React Query and WebSocket updates
 */
export function useSpecs() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['specs'],
    queryFn: specsApi.getAll,
  })

  // WebSocket for live updates
  const { connected, subscribe } = useWebSocket('/ws', {
    onMessage: (message: WebSocketMessage) => {
      if (
        message.type === 'spec_created' ||
        message.type === 'spec_updated' ||
        message.type === 'spec_deleted'
      ) {
        // Invalidate specs query to refetch
        queryClient.invalidateQueries({ queryKey: ['specs'] })
      }
    },
  })

  // Subscribe to specs channel when connected
  useEffect(() => {
    if (connected) {
      subscribe('specs')
    }
  }, [connected, subscribe])

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Spec> }) =>
      specsApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['specs'] })

      // Snapshot previous value
      const previousSpecs = queryClient.getQueryData<Spec[]>(['specs'])

      // Optimistically update
      queryClient.setQueryData<Spec[]>(['specs'], (old) =>
        old?.map((spec) => (spec.id === id ? { ...spec, ...data } : spec))
      )

      return { previousSpecs }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousSpecs) {
        queryClient.setQueryData(['specs'], context.previousSpecs)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['specs'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: specsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specs'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: specsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specs'] })
    },
  })

  return {
    specs: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    updateSpec: updateMutation.mutate,
    updateSpecAsync: updateMutation.mutateAsync,
    createSpec: createMutation.mutate,
    createSpecAsync: createMutation.mutateAsync,
    deleteSpec: deleteMutation.mutate,
    isUpdating: updateMutation.isPending,
    isCreating: createMutation.isPending,
  }
}

/**
 * Hook for fetching a single spec
 */
export function useSpec(id: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['specs', id],
    queryFn: () => specsApi.getById(id),
    enabled: !!id,
  })

  // WebSocket for live updates to this specific spec
  const { connected, subscribe } = useWebSocket('/ws', {
    onMessage: (message: WebSocketMessage) => {
      if (message.type === 'spec_updated' && (message.data as Spec).id === id) {
        queryClient.invalidateQueries({ queryKey: ['specs', id] })
      }
    },
  })

  useEffect(() => {
    if (connected && id) {
      subscribe('specs', id)
    }
  }, [connected, id, subscribe])

  return {
    spec: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

/**
 * Hook for managing spec feedback
 */
export function useSpecFeedback(specId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['feedback', specId],
    queryFn: () => specsApi.getFeedback(specId),
    enabled: !!specId,
  })

  // WebSocket for live feedback updates
  const { connected, subscribe } = useWebSocket('/ws', {
    onMessage: (message: WebSocketMessage) => {
      if (
        message.type === 'feedback_created' ||
        message.type === 'feedback_updated' ||
        message.type === 'feedback_deleted'
      ) {
        queryClient.invalidateQueries({ queryKey: ['feedback', specId] })
      }
    },
  })

  useEffect(() => {
    if (connected && specId) {
      subscribe('feedback', specId)
    }
  }, [connected, specId, subscribe])

  return {
    feedback: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
