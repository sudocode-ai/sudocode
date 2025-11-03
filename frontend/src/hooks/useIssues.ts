import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { issuesApi } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { Issue, IssueStatus, WebSocketMessage } from '@/types/api'

export function useIssues(archived?: boolean) {
  const queryClient = useQueryClient()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  const query = useQuery({
    queryKey: archived !== undefined ? ['issues', { archived }] : ['issues'],
    queryFn: () => issuesApi.getAll(archived),
  })

  // Message handler for WebSocket updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (
      message.type === 'issue_created' ||
      message.type === 'issue_updated' ||
      message.type === 'issue_deleted'
    ) {
      // Invalidate issues query to refetch
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    }
  }, [queryClient])

  // Register message handler and subscribe to issue updates
  useEffect(() => {
    const handlerId = 'useIssues'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('issue')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('issue')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Issue> }) => issuesApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['issues'] })

      // Snapshot previous value
      const previousIssues = queryClient.getQueryData<Issue[]>(['issues'])

      // Optimistically update
      queryClient.setQueryData<Issue[]>(['issues'], (old) =>
        old?.map((issue) => (issue.id === id ? { ...issue, ...data } : issue))
      )

      return { previousIssues }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousIssues) {
        queryClient.setQueryData(['issues'], context.previousIssues)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: issuesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: issuesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })

  const archiveIssue = (id: string) => updateMutation.mutate({ id, data: { archived: true } })
  const unarchiveIssue = (id: string) => updateMutation.mutate({ id, data: { archived: false } })

  return {
    issues: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    updateIssue: updateMutation.mutate,
    updateIssueAsync: updateMutation.mutateAsync,
    createIssue: createMutation.mutate,
    createIssueAsync: createMutation.mutateAsync,
    deleteIssue: deleteMutation.mutate,
    deleteIssueAsync: deleteMutation.mutateAsync,
    archiveIssue,
    unarchiveIssue,
    isUpdating: updateMutation.isPending,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}

export function useIssue(id: string) {
  return useQuery({
    queryKey: ['issues', id],
    queryFn: () => issuesApi.getById(id),
    enabled: !!id,
  })
}

/**
 * Helper hook to update issue status via drag-and-drop
 */
export function useUpdateIssueStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IssueStatus }) =>
      issuesApi.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['issues'] })
      const previousIssues = queryClient.getQueryData<Issue[]>(['issues'])

      queryClient.setQueryData<Issue[]>(['issues'], (old) =>
        old?.map((issue) => (issue.id === id ? { ...issue, status } : issue))
      )

      return { previousIssues }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(['issues'], context.previousIssues)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })
}
