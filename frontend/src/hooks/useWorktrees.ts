import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { repositoryApi } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { WebSocketMessage } from '@/types/api'

/**
 * Hook for fetching and managing worktrees
 *
 * Worktrees are git worktrees created in .sudocode/worktrees/ directory.
 * This hook fetches all worktrees for the current repository.
 */
export function useWorktrees() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  // Include projectId in query key to ensure proper cache separation between projects
  const queryKey = currentProjectId ? ['worktrees', currentProjectId] : ['worktrees']

  const query = useQuery({
    queryKey,
    queryFn: () => repositoryApi.listWorktrees(),
    enabled: !!currentProjectId,
  })

  // Message handler for WebSocket updates
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (
        message.type === 'execution_created' ||
        message.type === 'execution_updated' ||
        message.type === 'execution_status_changed' ||
        message.type === 'execution_deleted'
      ) {
        // Invalidate worktrees query to refetch
        queryClient.invalidateQueries({ queryKey: ['worktrees', currentProjectId] })
      }
    },
    [queryClient, currentProjectId]
  )

  // Register message handler and subscribe to execution updates
  useEffect(() => {
    const handlerId = 'useWorktrees'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('execution')
    }
  }, [connected, subscribe, unsubscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    worktrees: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
