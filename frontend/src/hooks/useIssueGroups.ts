import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { issueGroupsApi } from '@/lib/api'
import type {
  IssueGroup,
  IssueGroupWithStats,
  CreateIssueGroupRequest,
  UpdateIssueGroupRequest,
  AddIssueToGroupRequest,
} from '@/types/api'

/**
 * Hook for fetching all issue groups
 */
export function useIssueGroups(status?: 'active' | 'paused' | 'completed') {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: status !== undefined ? ['issue-groups', { status }] : ['issue-groups'],
    queryFn: () => issueGroupsApi.getAll(status),
  })

  const createMutation = useMutation({
    mutationFn: issueGroupsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIssueGroupRequest }) =>
      issueGroupsApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['issue-groups'] })

      // Snapshot previous value
      const previousGroups = queryClient.getQueryData<IssueGroup[]>(['issue-groups'])

      // Optimistically update
      queryClient.setQueryData<IssueGroup[]>(['issue-groups'], (old) =>
        old?.map((group) => (group.id === id ? { ...group, ...data } : group))
      )

      return { previousGroups }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousGroups) {
        queryClient.setQueryData(['issue-groups'], context.previousGroups)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: issueGroupsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
    },
  })

  const pauseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      issueGroupsApi.pause(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
    },
  })

  const resumeMutation = useMutation({
    mutationFn: issueGroupsApi.resume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
    },
  })

  const completeMutation = useMutation({
    mutationFn: issueGroupsApi.complete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
    },
  })

  return {
    groups: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    createGroup: createMutation.mutate,
    createGroupAsync: createMutation.mutateAsync,
    updateGroup: updateMutation.mutate,
    updateGroupAsync: updateMutation.mutateAsync,
    deleteGroup: deleteMutation.mutate,
    deleteGroupAsync: deleteMutation.mutateAsync,
    pauseGroup: pauseMutation.mutate,
    pauseGroupAsync: pauseMutation.mutateAsync,
    resumeGroup: resumeMutation.mutate,
    resumeGroupAsync: resumeMutation.mutateAsync,
    completeGroup: completeMutation.mutate,
    completeGroupAsync: completeMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}

/**
 * Hook for fetching a single issue group with details
 */
export function useIssueGroup(id: string | undefined) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['issue-groups', id],
    queryFn: () => (id ? issueGroupsApi.getById(id) : null),
    enabled: !!id,
  })

  const addIssueMutation = useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: AddIssueToGroupRequest }) =>
      issueGroupsApi.addIssue(groupId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups', id] })
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })

  const removeIssueMutation = useMutation({
    mutationFn: ({ groupId, issueId }: { groupId: string; issueId: string }) =>
      issueGroupsApi.removeIssue(groupId, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-groups', id] })
      queryClient.invalidateQueries({ queryKey: ['issue-groups'] })
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })

  return {
    group: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    addIssue: addIssueMutation.mutate,
    addIssueAsync: addIssueMutation.mutateAsync,
    removeIssue: removeIssueMutation.mutate,
    removeIssueAsync: removeIssueMutation.mutateAsync,
    isAddingIssue: addIssueMutation.isPending,
    isRemovingIssue: removeIssueMutation.isPending,
  }
}
