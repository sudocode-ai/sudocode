import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { relationshipsApi, getCurrentProjectId } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { Issue, Relationship, WebSocketMessage } from '@/types/api'

/**
 * Hook to fetch relationships for multiple issues
 * Returns a map of issue_id -> relationships
 */
export function useIssueRelationships(issues: Issue[]) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Check if context projectId matches API client projectId
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  // Include projectId in query key to ensure proper cache separation between projects
  const queryKey = ['issue-relationships', currentProjectId, issues.map((i) => i.id).sort()]

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      // Fetch relationships for all issues in parallel
      const relationshipPromises = issues.map((issue) =>
        relationshipsApi
          .getForEntity(issue.id, 'issue')
          .then((data) => {
            // Handle both array and grouped object responses
            let relationshipsArray: Relationship[] = []
            if (Array.isArray(data)) {
              relationshipsArray = data
            } else if (data && typeof data === 'object' && 'outgoing' in data && 'incoming' in data) {
              const grouped = data as { outgoing: Relationship[]; incoming: Relationship[] }
              relationshipsArray = [...(grouped.outgoing || []), ...(grouped.incoming || [])]
            }
            return { issueId: issue.id, relationships: relationshipsArray }
          })
          .catch(() => ({ issueId: issue.id, relationships: [] }))
      )

      const results = await Promise.all(relationshipPromises)

      // Create a map of issue_id -> relationships
      const relationshipsMap = new Map<string, Relationship[]>()
      results.forEach(({ issueId, relationships }) => {
        relationshipsMap.set(issueId, relationships)
      })

      return relationshipsMap
    },
    enabled: issues.length > 0 && !!currentProjectId && isProjectSynced,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Message handler for relationship updates
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'relationship_created' || message.type === 'relationship_deleted') {
      // Invalidate relationship queries to refetch (uses partial key to match all project-specific queries)
      queryClient.invalidateQueries({ queryKey: ['issue-relationships', currentProjectId] })
    }
  }, [queryClient, currentProjectId])

  // Subscribe to all relationship updates when connected
  useEffect(() => {
    const handlerId = 'useIssueRelationships'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('all')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return query
}

/**
 * Helper function to check if an issue has any incoming "blocks" relationships
 */
export function hasBlockingRelationships(
  issueId: string,
  relationshipsMap: Map<string, Relationship[]>
): boolean {
  const relationships = relationshipsMap.get(issueId) || []

  // Check if there are any incoming "blocks" relationships
  // (i.e., this issue is blocked by another issue)
  return relationships.some(
    (rel) =>
      rel.relationship_type === 'blocks' &&
      rel.to_id === issueId &&
      rel.to_type === 'issue'
  )
}
