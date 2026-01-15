/**
 * Hooks for stacks management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stacksApi, getCurrentProjectId } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import { toast } from 'sonner'
import type { CreateStackRequest, UpdateStackRequest } from '@/types/stack'

/**
 * Hook to fetch all stacks
 */
export function useStacks(options?: { includeAuto?: boolean; includeManual?: boolean }) {
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['stacks', currentProjectId, options],
    queryFn: () =>
      stacksApi.getAll({
        include_auto: options?.includeAuto,
        include_manual: options?.includeManual,
      }),
    enabled: !!currentProjectId && isProjectSynced,
  })
}

/**
 * Hook to fetch a single stack by ID
 */
export function useStack(stackId: string | null | undefined) {
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['stack', stackId, currentProjectId],
    queryFn: () => stacksApi.getById(stackId!),
    enabled: !!stackId && !!currentProjectId && isProjectSynced,
  })
}

/**
 * Hook to fetch the stack containing a specific issue
 */
export function useIssueStack(issueId: string | null | undefined) {
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['issue-stack', issueId, currentProjectId],
    queryFn: () => stacksApi.getForIssue(issueId!),
    enabled: !!issueId && !!currentProjectId && isProjectSynced,
  })
}

/**
 * Hook for stack mutations (create, update, delete)
 */
export function useStackMutations() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  const invalidateStacks = () => {
    queryClient.invalidateQueries({ queryKey: ['stacks', currentProjectId] })
  }

  const createStack = useMutation({
    mutationFn: (data: CreateStackRequest) => stacksApi.create(data),
    onSuccess: (newStack) => {
      invalidateStacks()
      toast.success(`Stack "${newStack.name || newStack.id}" created`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to create stack: ${error.message}`)
    },
  })

  const updateStack = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStackRequest }) =>
      stacksApi.update(id, data),
    onSuccess: (updatedStack) => {
      invalidateStacks()
      // Also invalidate the specific stack
      queryClient.invalidateQueries({ queryKey: ['stack', updatedStack.id, currentProjectId] })
      toast.success('Stack updated')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update stack: ${error.message}`)
    },
  })

  const deleteStack = useMutation({
    mutationFn: (id: string) => stacksApi.delete(id),
    onSuccess: (_result, deletedId) => {
      invalidateStacks()
      queryClient.removeQueries({ queryKey: ['stack', deletedId, currentProjectId] })
      toast.success('Stack deleted')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete stack: ${error.message}`)
    },
  })

  const addToStack = useMutation({
    mutationFn: ({ stackId, issueIds }: { stackId: string; issueIds: string[] }) =>
      stacksApi.update(stackId, { add_issues: issueIds }),
    onSuccess: () => {
      invalidateStacks()
      toast.success('Added to stack')
    },
    onError: (error: Error) => {
      toast.error(`Failed to add to stack: ${error.message}`)
    },
  })

  const removeFromStack = useMutation({
    mutationFn: ({ stackId, issueIds }: { stackId: string; issueIds: string[] }) =>
      stacksApi.update(stackId, { remove_issues: issueIds }),
    onSuccess: () => {
      invalidateStacks()
      toast.success('Removed from stack')
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove from stack: ${error.message}`)
    },
  })

  const reorderStack = useMutation({
    mutationFn: ({ stackId, issueOrder }: { stackId: string; issueOrder: string[] }) =>
      stacksApi.update(stackId, { issue_order: issueOrder }),
    onSuccess: () => {
      invalidateStacks()
      toast.success('Stack reordered')
    },
    onError: (error: Error) => {
      toast.error(`Failed to reorder stack: ${error.message}`)
    },
  })

  return {
    createStack,
    updateStack,
    deleteStack,
    addToStack,
    removeFromStack,
    reorderStack,
    isCreating: createStack.isPending,
    isUpdating: updateStack.isPending,
    isDeleting: deleteStack.isPending,
  }
}
