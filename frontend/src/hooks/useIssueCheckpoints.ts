import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { issuesApi, type ReviewAction } from '@/lib/api'

/**
 * Hook to fetch checkpoints for an issue
 */
export function useIssueCheckpoints(issueId: string | null | undefined) {
  return useQuery({
    queryKey: ['checkpoints', issueId],
    queryFn: () => issuesApi.getCheckpoints(issueId!),
    enabled: !!issueId,
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to fetch just the current checkpoint
 */
export function useCurrentCheckpoint(issueId: string | null | undefined) {
  return useQuery({
    queryKey: ['checkpoint', 'current', issueId],
    queryFn: () => issuesApi.getCurrentCheckpoint(issueId!),
    enabled: !!issueId,
    staleTime: 30000,
  })
}

/**
 * Hook to review (approve/reject) a checkpoint
 */
export function useReviewCheckpoint() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ issueId, action, notes, reviewed_by }: {
      issueId: string
      action: ReviewAction
      notes?: string
      reviewed_by?: string
    }) => issuesApi.reviewCheckpoint(issueId, { action, notes, reviewed_by }),
    onSuccess: (_data, variables) => {
      // Invalidate checkpoint queries
      queryClient.invalidateQueries({ queryKey: ['checkpoints', variables.issueId] })
      queryClient.invalidateQueries({ queryKey: ['checkpoint', 'current', variables.issueId] })
      queryClient.invalidateQueries({ queryKey: ['issues'] })

      const actionText = variables.action === 'approve'
        ? 'approved'
        : variables.action === 'request_changes'
          ? 'requested changes on'
          : 'reset review for'

      toast.success(`Successfully ${actionText} checkpoint`)
    },
    onError: (error: Error) => {
      toast.error('Failed to review checkpoint', {
        description: error.message,
      })
    },
  })
}
