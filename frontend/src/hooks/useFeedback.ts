import { useMutation, useQueryClient } from '@tanstack/react-query'
import { feedbackApi } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import type { IssueFeedback, CreateFeedbackRequest, UpdateFeedbackRequest } from '@/types/api'

/**
 * Hook for managing feedback operations (create, update, delete)
 */
export function useFeedback(specId: string) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  // Include projectId in query key to ensure proper cache separation between projects
  const queryKey = ['feedback', currentProjectId, specId]

  const createMutation = useMutation({
    mutationFn: (data: CreateFeedbackRequest) => feedbackApi.create(data),
    onSuccess: () => {
      // Invalidate feedback queries for this spec
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFeedbackRequest }) =>
      feedbackApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey })

      // Snapshot previous value
      const previousFeedback = queryClient.getQueryData<IssueFeedback[]>(queryKey)

      // Optimistically update - convert anchor to string if needed
      queryClient.setQueryData<IssueFeedback[]>(queryKey, (old) =>
        old?.map((feedback) => {
          if (feedback.id !== id) return feedback

          // Prepare updated data with proper typing
          const updates: Partial<IssueFeedback> = {}
          if (data.content !== undefined) updates.content = data.content
          if (data.feedback_type !== undefined) updates.feedback_type = data.feedback_type
          if (data.dismissed !== undefined) updates.dismissed = data.dismissed

          // Convert anchor to string if it's provided
          if (data.anchor !== undefined) {
            updates.anchor =
              typeof data.anchor === 'string' ? data.anchor : JSON.stringify(data.anchor)
          }

          return { ...feedback, ...updates }
        })
      )

      return { previousFeedback }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousFeedback) {
        queryClient.setQueryData(queryKey, context.previousFeedback)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => feedbackApi.delete(id),
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey })

      // Snapshot previous value
      const previousFeedback = queryClient.getQueryData<IssueFeedback[]>(queryKey)

      // Optimistically remove
      queryClient.setQueryData<IssueFeedback[]>(queryKey, (old) =>
        old?.filter((feedback) => feedback.id !== id)
      )

      return { previousFeedback }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousFeedback) {
        queryClient.setQueryData(queryKey, context.previousFeedback)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey })
    },
  })

  return {
    createFeedback: createMutation.mutate,
    createFeedbackAsync: createMutation.mutateAsync,
    updateFeedback: updateMutation.mutate,
    updateFeedbackAsync: updateMutation.mutateAsync,
    deleteFeedback: deleteMutation.mutate,
    deleteFeedbackAsync: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
