import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { specsApi } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { Spec, WebSocketMessage } from '@/types/api'

/**
 * Hook for managing specs with React Query and WebSocket updates
 */
export function useSpecs(archived?: boolean) {
  const queryClient = useQueryClient()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  const query = useQuery({
    queryKey: archived !== undefined ? ['specs', { archived }] : ['specs'],
    queryFn: () => specsApi.getAll(archived),
  })

  // Message handler for WebSocket updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (
      message.type === 'spec_created' ||
      message.type === 'spec_updated' ||
      message.type === 'spec_deleted'
    ) {
      // Invalidate specs query to refetch
      queryClient.invalidateQueries({ queryKey: ['specs'] })
    }
  }, [queryClient])

  // Register message handler and subscribe to spec updates
  useEffect(() => {
    const handlerId = 'useSpecs'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('spec')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('spec')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Spec> }) => specsApi.update(id, data),
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

  const archiveSpec = (id: string) => updateMutation.mutate({ id, data: { archived: true } })
  const unarchiveSpec = (id: string) => updateMutation.mutate({ id, data: { archived: false } })

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
    archiveSpec,
    unarchiveSpec,
    isUpdating: updateMutation.isPending,
    isCreating: createMutation.isPending,
  }
}

/**
 * Hook for fetching a single spec
 */
export function useSpec(id: string) {
  const queryClient = useQueryClient()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  const query = useQuery({
    queryKey: ['specs', id],
    queryFn: () => specsApi.getById(id),
    enabled: !!id,
  })

  // Message handler for WebSocket updates to this specific spec
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'spec_updated' && (message.data as Spec).id === id) {
      queryClient.invalidateQueries({ queryKey: ['specs', id] })
    }
  }, [id, queryClient])

  useEffect(() => {
    if (!id) return

    const handlerId = `useSpec-${id}`
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('spec', id)
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('spec', id)
    }
  }, [connected, id, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

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
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  const query = useQuery({
    queryKey: ['feedback', specId],
    queryFn: () => specsApi.getFeedback(specId),
    enabled: !!specId,
  })

  // Message handler for feedback updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (
      message.type === 'feedback_created' ||
      message.type === 'feedback_updated' ||
      message.type === 'feedback_deleted'
    ) {
      queryClient.invalidateQueries({ queryKey: ['feedback', specId] })
    }
  }, [specId, queryClient])

  // Subscribe to all updates (including feedback) when connected
  useEffect(() => {
    if (!specId) return

    const handlerId = `useSpecFeedback-${specId}`
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, specId, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    feedback: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
