import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { issuesApi, getCurrentProjectId } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { Issue, IssueStatus, WebSocketMessage } from '@/types/api'

export function useIssues(archived?: boolean) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Include projectId in query key to ensure proper cache separation between projects
  const queryKey = currentProjectId
    ? (archived !== undefined ? ['issues', currentProjectId, { archived }] : ['issues', currentProjectId])
    : ['issues']

  // Check if context projectId matches API client projectId
  // During project switching, context state updates async while API client updates sync
  // This prevents fetching with mismatched query key and API header
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const query = useQuery({
    queryKey,
    queryFn: () => issuesApi.getAll(archived),
    enabled: !!currentProjectId && isProjectSynced,
  })

  // Message handler for WebSocket updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (
      message.type === 'issue_created' ||
      message.type === 'issue_updated' ||
      message.type === 'issue_deleted'
    ) {
      // Invalidate issues query to refetch (uses partial key to match all project-specific queries)
      queryClient.invalidateQueries({ queryKey: ['issues', currentProjectId] })
    }
  }, [queryClient, currentProjectId])

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
      await queryClient.cancelQueries({ queryKey: ['issues', currentProjectId] })

      // Snapshot previous value
      const previousIssues = queryClient.getQueryData<Issue[]>(queryKey)

      // Optimistically update
      queryClient.setQueryData<Issue[]>(queryKey, (old) =>
        old?.map((issue) => (issue.id === id ? { ...issue, ...data } : issue))
      )

      return { previousIssues }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousIssues) {
        queryClient.setQueryData(queryKey, context.previousIssues)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['issues', currentProjectId] })
    },
  })

  const createMutation = useMutation({
    mutationFn: issuesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', currentProjectId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: issuesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', currentProjectId] })
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
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['issue', currentProjectId, id],
    queryFn: () => issuesApi.getById(id),
    enabled: !!id && !!currentProjectId && isProjectSynced,
  })
}

/**
 * Helper hook to update issue status via drag-and-drop
 */
export function useUpdateIssueStatus() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  // Query key for current project's issues list
  const issuesQueryKey = ['issues', currentProjectId]

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IssueStatus }) =>
      issuesApi.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: issuesQueryKey })
      const previousIssues = queryClient.getQueryData<Issue[]>(issuesQueryKey)

      queryClient.setQueryData<Issue[]>(issuesQueryKey, (old) =>
        old?.map((issue) => (issue.id === id ? { ...issue, status } : issue))
      )

      return { previousIssues }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issuesQueryKey, context.previousIssues)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issuesQueryKey })
    },
  })
}

/**
 * Hook to fetch feedback for a specific issue
 */
export function useIssueFeedback(issueId: string) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const queryKey = ['feedback', currentProjectId, issueId]

  const query = useQuery({
    queryKey,
    queryFn: () => issuesApi.getFeedback(issueId),
    enabled: !!issueId && !!currentProjectId && isProjectSynced,
  })

  // Message handler for feedback updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (
      message.type === 'feedback_created' ||
      message.type === 'feedback_updated' ||
      message.type === 'feedback_deleted'
    ) {
      queryClient.invalidateQueries({ queryKey })
    }
  }, [queryKey, queryClient])

  // Subscribe to all updates (including feedback) when connected
  useEffect(() => {
    if (!issueId) return

    const handlerId = `useIssueFeedback-${issueId}`
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, issueId, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    feedback: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
