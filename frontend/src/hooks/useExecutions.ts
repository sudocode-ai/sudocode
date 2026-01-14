import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { executionsApi, getCurrentProjectId, type ListExecutionsParams } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { WebSocketMessage } from '@/types/api'

/**
 * React Query hook for fetching and managing executions list
 *
 * Features:
 * - Automatic caching and refetching via React Query
 * - Real-time updates via WebSocket subscriptions
 * - Project-scoped query keys for multi-project support
 * - Automatic invalidation on execution events
 */
export function useExecutions(params?: ListExecutionsParams) {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  // Include projectId in query key to ensure proper cache separation between projects
  const queryKey = currentProjectId
    ? ['executions', currentProjectId, params]
    : ['executions', params]

  // Check if context projectId matches API client projectId
  // During project switching, context state updates async while API client updates sync
  // This prevents fetching with mismatched query key and API header
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await executionsApi.listAll(params)
      // Filter to only include root executions (those without parent_execution_id)
      // This ensures we display execution chains rather than individual executions
      const rootExecutions = response.executions.filter(
        (execution) => !execution.parent_execution_id
      )
      return {
        ...response,
        executions: rootExecutions,
        total: rootExecutions.length,
      }
    },
    enabled: !!currentProjectId && isProjectSynced,
    staleTime: 30000, // 30 seconds - WebSocket handles real-time updates
    refetchInterval: false, // Rely on WebSocket for updates, not polling
  })

  // Message handler for WebSocket updates
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (
        message.type === 'execution_created' ||
        message.type === 'execution_updated' ||
        message.type === 'execution_deleted' ||
        message.type === 'execution_status_changed' ||
        // Persistent session events
        message.type === 'session_waiting' ||
        message.type === 'session_paused' ||
        message.type === 'session_ended'
      ) {
        // Invalidate executions query to refetch (uses partial key to match all project-specific queries)
        queryClient.invalidateQueries({ queryKey: ['executions', currentProjectId] })
      }
    },
    [queryClient, currentProjectId]
  )

  // Register message handler and subscribe to execution updates
  useEffect(() => {
    const handlerId = 'useExecutions'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
      // Note: We don't unsubscribe here as other components may be using execution events
      // The WebSocketProvider handles cleanup on unmount
    }
  }, [connected, subscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return query
}
