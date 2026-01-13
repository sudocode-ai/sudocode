/**
 * Hooks for merge queue management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { queueApi, getCurrentProjectId } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { toast } from 'sonner'
import type { WebSocketMessage } from '@/types/api'
import type {
  QueueListResponse,
  EnrichedQueueEntry,
  GetQueueOptions,
} from '@/types/queue'

/**
 * Hook to fetch queue entries with enriched data
 */
export function useQueue(options?: GetQueueOptions) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const queryKey = ['queue', currentProjectId, options]

  const query = useQuery({
    queryKey,
    queryFn: () => queueApi.getAll(options),
    enabled: !!currentProjectId && isProjectSynced,
  })

  // Message handler for queue WebSocket updates
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (
        message.type === 'queue_reordered' ||
        message.type === 'queue_entry_added' ||
        message.type === 'queue_entry_removed' ||
        message.type === 'queue_entry_status_changed'
      ) {
        // Invalidate queue queries to refetch
        queryClient.invalidateQueries({ queryKey: ['queue', currentProjectId] })
      }
    },
    [queryClient, currentProjectId]
  )

  // Register message handler and subscribe to queue updates
  useEffect(() => {
    const handlerId = 'useQueue'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      // Subscribe to all for now - queue events don't have dedicated subscription yet
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    data: query.data,
    entries: query.data?.entries ?? [],
    stats: query.data?.stats ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Hook for queue mutations (reorder)
 */
export function useQueueMutations() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  const invalidateQueue = () => {
    queryClient.invalidateQueries({ queryKey: ['queue', currentProjectId] })
  }

  const reorder = useMutation({
    mutationFn: ({
      executionId,
      newPosition,
      targetBranch,
    }: {
      executionId: string
      newPosition: number
      targetBranch?: string
    }) => queueApi.reorder(executionId, newPosition, targetBranch),
    onMutate: async ({ executionId, newPosition }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['queue', currentProjectId] })

      // Snapshot previous value for rollback
      const previousData = queryClient.getQueriesData<QueueListResponse>({
        queryKey: ['queue', currentProjectId],
      })

      // Optimistic update: reorder entries in cache
      queryClient.setQueriesData<QueueListResponse>(
        { queryKey: ['queue', currentProjectId] },
        (old) => {
          if (!old) return old

          const entries = [...old.entries]
          const entryIndex = entries.findIndex((e) => e.executionId === executionId)
          if (entryIndex === -1) return old

          // Remove from current position
          const [entry] = entries.splice(entryIndex, 1)

          // Insert at new position (1-indexed to 0-indexed)
          const insertIndex = Math.min(Math.max(0, newPosition - 1), entries.length)
          entries.splice(insertIndex, 0, entry)

          // Update positions
          const updatedEntries: EnrichedQueueEntry[] = entries.map((e, i) => ({
            ...e,
            position: i + 1,
          }))

          return {
            ...old,
            entries: updatedEntries,
          }
        }
      )

      return { previousData }
    },
    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        for (const [queryKey, data] of context.previousData) {
          queryClient.setQueryData(queryKey, data)
        }
      }

      // Show error toast with specific message for dependency violations
      const errorMessage = error instanceof Error ? error.message : 'Failed to reorder'
      toast.error(errorMessage)
    },
    onSuccess: (result) => {
      if (result.warning) {
        toast.warning(result.warning)
      } else {
        toast.success('Queue reordered')
      }
    },
    onSettled: () => {
      // Always refetch to ensure sync
      invalidateQueue()
    },
  })

  return {
    reorder: reorder.mutate,
    reorderAsync: reorder.mutateAsync,
    isReordering: reorder.isPending,
  }
}

/**
 * Group queue entries by stack for display
 */
export interface QueueStackGroup {
  stackId: string | null // null for standalone entries
  stackName?: string
  entries: EnrichedQueueEntry[]
}

export function groupQueueByStack(entries: EnrichedQueueEntry[]): QueueStackGroup[] {
  const groups = new Map<string | null, QueueStackGroup>()

  for (const entry of entries) {
    const key = entry.stackId ?? null

    if (!groups.has(key)) {
      groups.set(key, {
        stackId: key,
        stackName: entry.stackName,
        entries: [],
      })
    }

    groups.get(key)!.entries.push(entry)
  }

  // Sort: stacks first (alphabetically), then standalone
  return Array.from(groups.values()).sort((a, b) => {
    if (a.stackId === null && b.stackId !== null) return 1
    if (a.stackId !== null && b.stackId === null) return -1
    if (a.stackId === null && b.stackId === null) return 0
    return (a.stackName ?? a.stackId ?? '').localeCompare(b.stackName ?? b.stackId ?? '')
  })
}
