import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { issuesApi } from '@/lib/api'
import type { Issue, IssueStatus } from '@/types/api'

export function useIssues() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['issues'],
    queryFn: issuesApi.getAll,
  })

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

  return {
    issues: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    updateIssue: updateMutation.mutate,
    updateIssueAsync: updateMutation.mutateAsync,
    createIssue: createMutation.mutate,
    deleteIssue: deleteMutation.mutate,
    isUpdating: updateMutation.isPending,
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
