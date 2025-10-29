import { useMutation, useQueryClient } from '@tanstack/react-query'
import { feedbackApi } from '@/lib/api'
import type { IssueFeedback, CreateFeedbackRequest, UpdateFeedbackRequest } from '@/types/api'

/**
 * Hook for managing feedback operations (create, update, delete)
 */
export function useFeedback(specId: string) {
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: CreateFeedbackRequest) => feedbackApi.create(data),
    onSuccess: () => {
      // Invalidate feedback queries for this spec
      queryClient.invalidateQueries({ queryKey: ['feedback', specId] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFeedbackRequest }) =>
      feedbackApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['feedback', specId] })

      // Snapshot previous value
      const previousFeedback = queryClient.getQueryData<IssueFeedback[]>(['feedback', specId])

      // Optimistically update - convert anchor to string if needed
      queryClient.setQueryData<IssueFeedback[]>(['feedback', specId], (old) =>
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
        queryClient.setQueryData(['feedback', specId], context.previousFeedback)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['feedback', specId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => feedbackApi.delete(id),
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['feedback', specId] })

      // Snapshot previous value
      const previousFeedback = queryClient.getQueryData<IssueFeedback[]>(['feedback', specId])

      // Optimistically remove
      queryClient.setQueryData<IssueFeedback[]>(['feedback', specId], (old) =>
        old?.filter((feedback) => feedback.id !== id)
      )

      return { previousFeedback }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousFeedback) {
        queryClient.setQueryData(['feedback', specId], context.previousFeedback)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['feedback', specId] })
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
