import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { relationshipsApi, getCurrentProjectId } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { Relationship, WebSocketMessage } from '@/types/api'

/**
 * Hook to fetch relationships for a spec with WebSocket real-time updates
 * Similar to useIssueRelationships but for a single spec entity
 */
export function useSpecRelationships(specId: string | undefined) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Check if context projectId matches API client projectId
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  // Include projectId in query key to ensure proper cache separation between projects
  const queryKey = ['spec-relationships', currentProjectId, specId]

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!specId) return []

      const data = await relationshipsApi.getForEntity(specId, 'spec')
      // Handle both array and grouped object responses
      let relationshipsArray: Relationship[] = []
      if (Array.isArray(data)) {
        relationshipsArray = data
      } else if (data && typeof data === 'object' && 'outgoing' in data && 'incoming' in data) {
        const grouped = data as { outgoing: Relationship[]; incoming: Relationship[] }
        relationshipsArray = [...(grouped.outgoing || []), ...(grouped.incoming || [])]
      }
      return relationshipsArray
    },
    enabled: !!specId && !!currentProjectId && isProjectSynced,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Message handler for relationship updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'relationship_created' || message.type === 'relationship_deleted') {
      // Check if the relationship involves this spec
      const data = message.data as Relationship | { from_id: string; to_id: string } | undefined
      if (data && specId) {
        // Invalidate if the relationship involves this spec
        if (data.from_id === specId || data.to_id === specId) {
          queryClient.invalidateQueries({ queryKey: ['spec-relationships', currentProjectId, specId] })
        }
      } else {
        // If we can't determine, invalidate all spec relationships for this project
        queryClient.invalidateQueries({ queryKey: ['spec-relationships', currentProjectId] })
      }
    }
  }, [queryClient, currentProjectId, specId])

  // Subscribe to all relationship updates when connected
  useEffect(() => {
    if (!specId) return

    const handlerId = `useSpecRelationships-${specId}`
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, specId, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    relationships: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}
