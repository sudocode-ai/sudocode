/**
 * Hooks for checkpoint DAG visualization and diff stack management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { diffStacksApi, getCurrentProjectId } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { toast } from 'sonner'
import type { WebSocketMessage } from '@/types/api'
import type {
  CreateDiffStackRequest,
  ReviewDiffStackRequest,
} from '@/types/checkpoint'

// =============================================================================
// useCheckpointDAG - Fetch checkpoints and streams for DAG visualization
// =============================================================================

export interface UseCheckpointDAGOptions {
  issueId?: string
  streamId?: string
  includeStats?: boolean
}

export function useCheckpointDAG(options?: UseCheckpointDAGOptions) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  // Query for checkpoints and streams
  const checkpointsQuery = useQuery({
    queryKey: ['checkpoints', currentProjectId, options?.issueId, options?.streamId],
    queryFn: () =>
      diffStacksApi.listCheckpoints({
        issueId: options?.issueId,
        streamId: options?.streamId,
        includeStats: options?.includeStats,
      }),
    enabled: !!currentProjectId && isProjectSynced,
  })

  // Query for diff stacks (to show which checkpoints are in stacks)
  const diffStacksQuery = useQuery({
    queryKey: ['diff-stacks', currentProjectId, { includeCheckpoints: true }],
    queryFn: () => diffStacksApi.list({ includeCheckpoints: true }),
    enabled: !!currentProjectId && isProjectSynced,
  })

  // Query for checkpoint stats if not included in main query
  const [statsCheckpointIds, setStatsCheckpointIds] = useState<string[]>([])

  const statsQuery = useQuery({
    queryKey: ['checkpoint-stats', currentProjectId, statsCheckpointIds],
    queryFn: () => diffStacksApi.getCheckpointStats(statsCheckpointIds),
    enabled:
      !!currentProjectId &&
      isProjectSynced &&
      statsCheckpointIds.length > 0 &&
      !options?.includeStats,
  })

  // Update stats checkpoint IDs when checkpoints change
  useEffect(() => {
    if (checkpointsQuery.data?.checkpoints && !options?.includeStats) {
      const ids = checkpointsQuery.data.checkpoints.map((cp) => cp.id)
      if (ids.length > 0 && JSON.stringify(ids) !== JSON.stringify(statsCheckpointIds)) {
        setStatsCheckpointIds(ids)
      }
    }
  }, [checkpointsQuery.data?.checkpoints, options?.includeStats, statsCheckpointIds])

  // Message handler for checkpoint/stack WebSocket updates
  // Note: Using generic message handler until checkpoint-specific events are added to WebSocket types
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      // Listen for execution events which may indicate checkpoint changes
      const messageType = message.type as string
      if (
        messageType.includes('checkpoint') ||
        messageType.includes('diff_stack') ||
        messageType === 'execution_completed' ||
        messageType === 'execution_updated'
      ) {
        // Invalidate queries to refetch
        queryClient.invalidateQueries({ queryKey: ['checkpoints', currentProjectId] })
        queryClient.invalidateQueries({ queryKey: ['diff-stacks', currentProjectId] })
      }
    },
    [queryClient, currentProjectId]
  )

  // Register message handler and subscribe to updates
  useEffect(() => {
    const handlerId = 'useCheckpointDAG'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    checkpoints: checkpointsQuery.data?.checkpoints ?? [],
    streams: checkpointsQuery.data?.streams ?? [],
    diffStacks: diffStacksQuery.data ?? [],
    checkpointStats: statsQuery.data ?? {},
    isLoading: checkpointsQuery.isLoading || diffStacksQuery.isLoading,
    isError: checkpointsQuery.isError || diffStacksQuery.isError,
    error: checkpointsQuery.error || diffStacksQuery.error,
    refetch: () => {
      checkpointsQuery.refetch()
      diffStacksQuery.refetch()
    },
  }
}

// =============================================================================
// useDiffStacks - CRUD operations for diff stacks
// =============================================================================

export function useDiffStacks(options?: { includeCheckpoints?: boolean }) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const queryKey = ['diff-stacks', currentProjectId, options]

  const query = useQuery({
    queryKey,
    queryFn: () => diffStacksApi.list(options),
    enabled: !!currentProjectId && isProjectSynced,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff-stacks', currentProjectId] })
    queryClient.invalidateQueries({ queryKey: ['checkpoints', currentProjectId] })
  }, [queryClient, currentProjectId])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateDiffStackRequest) => diffStacksApi.create(data),
    onSuccess: (stack) => {
      toast.success(`Stack "${stack.name || stack.id}" created`)
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create stack')
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string } }) =>
      diffStacksApi.update(id, data),
    onSuccess: () => {
      toast.success('Stack updated')
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update stack')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => diffStacksApi.delete(id),
    onSuccess: () => {
      toast.success('Stack deleted')
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete stack')
    },
  })

  // Add checkpoints mutation
  const addCheckpointsMutation = useMutation({
    mutationFn: ({ stackId, checkpointIds }: { stackId: string; checkpointIds: string[] }) =>
      diffStacksApi.addCheckpoints(stackId, checkpointIds),
    onSuccess: () => {
      toast.success('Checkpoints added to stack')
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add checkpoints')
    },
  })

  // Remove checkpoint mutation
  const removeCheckpointMutation = useMutation({
    mutationFn: ({ stackId, checkpointId }: { stackId: string; checkpointId: string }) =>
      diffStacksApi.removeCheckpoint(stackId, checkpointId),
    onSuccess: () => {
      toast.success('Checkpoint removed from stack')
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove checkpoint')
    },
  })

  return {
    stacks: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    // Mutations
    createStack: createMutation.mutateAsync,
    updateStack: updateMutation.mutateAsync,
    deleteStack: deleteMutation.mutateAsync,
    addCheckpoints: addCheckpointsMutation.mutateAsync,
    removeCheckpoint: removeCheckpointMutation.mutateAsync,
    // Mutation states
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}

// =============================================================================
// useStackReview - Review workflow for a specific diff stack
// =============================================================================

export function useStackReview(stackId: string) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const queryKey = ['diff-stack', currentProjectId, stackId]

  const query = useQuery({
    queryKey,
    queryFn: () => diffStacksApi.get(stackId),
    enabled: !!currentProjectId && isProjectSynced && !!stackId,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff-stack', currentProjectId, stackId] })
    queryClient.invalidateQueries({ queryKey: ['diff-stacks', currentProjectId] })
  }, [queryClient, currentProjectId, stackId])

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: (request: ReviewDiffStackRequest) => diffStacksApi.review(stackId, request),
    onSuccess: (_, variables) => {
      const statusLabel = variables.status === 'approved' ? 'approved' : variables.status
      toast.success(`Stack ${statusLabel}`)
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update review status')
    },
  })

  return {
    stack: query.data,
    checkpoints: query.data?.checkpoints ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    // Actions
    approve: (notes?: string) =>
      reviewMutation.mutateAsync({ status: 'approved', notes }),
    reject: (notes?: string) =>
      reviewMutation.mutateAsync({ status: 'rejected', notes }),
    abandon: (notes?: string) =>
      reviewMutation.mutateAsync({ status: 'abandoned', notes }),
    resetToPending: () =>
      reviewMutation.mutateAsync({ status: 'pending' }),
    addNotes: (notes: string) => {
      const currentStatus = query.data?.reviewStatus
      // Only pass valid transition statuses (exclude 'merged' which is terminal)
      const status = currentStatus === 'merged' ? 'pending' : (currentStatus || 'pending')
      return reviewMutation.mutateAsync({ status: status as 'pending' | 'approved' | 'rejected' | 'abandoned', notes })
    },
    isReviewing: reviewMutation.isPending,
  }
}

// =============================================================================
// useMergeQueue - Merge queue management for diff stacks
// =============================================================================

export function useMergeQueue(targetBranch?: string) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const queryKey = ['diff-stacks-queue', currentProjectId, targetBranch]

  const query = useQuery({
    queryKey,
    queryFn: () => diffStacksApi.list({ queuedOnly: true, targetBranch, includeCheckpoints: true }),
    enabled: !!currentProjectId && isProjectSynced,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff-stacks-queue', currentProjectId] })
    queryClient.invalidateQueries({ queryKey: ['diff-stacks', currentProjectId] })
  }, [queryClient, currentProjectId])

  // Enqueue mutation
  const enqueueMutation = useMutation({
    mutationFn: ({ stackId, position }: { stackId: string; position?: number }) =>
      diffStacksApi.enqueue(stackId, position),
    onSuccess: () => {
      toast.success('Stack added to queue')
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add to queue')
    },
  })

  // Dequeue mutation
  const dequeueMutation = useMutation({
    mutationFn: (stackId: string) => diffStacksApi.dequeue(stackId),
    onSuccess: () => {
      toast.success('Stack removed from queue')
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove from queue')
    },
  })

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: ({ stackId, dryRun }: { stackId: string; dryRun?: boolean }) =>
      diffStacksApi.merge(stackId, dryRun),
    onSuccess: (result, variables) => {
      if (variables.dryRun) {
        toast.info(
          `Merge preview: ${result.mergedCheckpoints.length} to merge, ${result.skippedCheckpoints.length} skipped`
        )
      } else {
        toast.success(`Merged ${result.mergedCheckpoints.length} checkpoints to ${result.targetBranch}`)
        invalidate()
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Merge failed')
    },
  })

  // Message handler for queue updates
  // Note: Using generic message handler until diff_stack-specific events are added to WebSocket types
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      const messageType = message.type as string
      if (
        messageType.includes('diff_stack') ||
        messageType.includes('queue') ||
        messageType === 'execution_completed'
      ) {
        invalidate()
      }
    },
    [invalidate]
  )

  // Register message handler
  useEffect(() => {
    const handlerId = 'useMergeQueue'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    queue: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    // Actions
    enqueue: (stackId: string, position?: number) =>
      enqueueMutation.mutateAsync({ stackId, position }),
    dequeue: (stackId: string) => dequeueMutation.mutateAsync(stackId),
    merge: (stackId: string, dryRun?: boolean) =>
      mergeMutation.mutateAsync({ stackId, dryRun }),
    // States
    isEnqueuing: enqueueMutation.isPending,
    isDequeuing: dequeueMutation.isPending,
    isMerging: mergeMutation.isPending,
    mergeResult: mergeMutation.data,
  }
}
