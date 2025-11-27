import { useMutation, useQueryClient } from '@tanstack/react-query'
import { relationshipsApi } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import type { EntityType, RelationshipType } from '@/types/api'

interface CreateRelationshipParams {
  from_id: string
  from_type: EntityType
  to_id: string
  to_type: EntityType
  relationship_type: RelationshipType
}

interface DeleteRelationshipParams {
  from_id: string
  from_type: EntityType
  to_id: string
  to_type: EntityType
  relationship_type: RelationshipType
}

/**
 * Hook for relationship mutations with proper cache invalidation
 */
export function useRelationshipMutations() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  const createMutation = useMutation({
    mutationFn: (params: CreateRelationshipParams) => relationshipsApi.create(params),
    onSuccess: () => {
      // Invalidate all relationship queries for current project to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['issue-relationships', currentProjectId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (params: DeleteRelationshipParams) => relationshipsApi.delete(params),
    onSuccess: () => {
      // Invalidate all relationship queries for current project to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['issue-relationships', currentProjectId] })
    },
  })

  return {
    createRelationship: createMutation.mutate,
    createRelationshipAsync: createMutation.mutateAsync,
    deleteRelationship: deleteMutation.mutate,
    deleteRelationshipAsync: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
