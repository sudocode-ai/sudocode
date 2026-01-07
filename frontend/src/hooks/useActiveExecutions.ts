import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { executionsApi, getCurrentProjectId } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { WebSocketMessage } from '@/types/api'
import type { Execution, ExecutionStatus } from '@/types/execution'

/**
 * Active execution with file change information for overlay positioning
 */
export interface ActiveExecution {
  id: string
  issueId: string | null
  agentType: string
  status: ExecutionStatus
  worktreePath: string | null
  changedFiles: string[]
  startedAt: string
  prompt?: string
}

/**
 * Result returned by useActiveExecutions hook
 */
export interface UseActiveExecutionsResult {
  executions: ActiveExecution[]
  isLoading: boolean
  error: Error | null
}

// Statuses considered "active" for overlay display
const ACTIVE_STATUSES: ExecutionStatus[] = ['running', 'pending', 'preparing']

/**
 * Transform raw Execution to ActiveExecution with file list
 */
function transformExecution(
  execution: Execution,
  changedFiles: string[] = []
): ActiveExecution {
  return {
    id: execution.id,
    issueId: execution.issue_id ?? null,
    agentType: execution.agent_type,
    status: execution.status,
    worktreePath: execution.worktree_path ?? null,
    changedFiles,
    startedAt: execution.started_at ?? execution.created_at,
    prompt: execution.prompt ?? undefined,
  }
}

/**
 * Hook for fetching active (running/pending) executions for CodeViz overlays.
 *
 * Features:
 * - Fetches executions with active statuses
 * - Fetches changed files for each execution
 * - Real-time updates via WebSocket
 * - Automatic refetch on execution events
 */
export function useActiveExecutions(): UseActiveExecutionsResult {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  // Check if context projectId matches API client projectId
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  // Query for active executions
  const executionsQuery = useQuery({
    queryKey: ['activeExecutions', currentProjectId],
    queryFn: async () => {
      // Fetch executions with active statuses
      const response = await executionsApi.listAll({
        status: ACTIVE_STATUSES,
        limit: 50,
      })

      // Filter to only root executions (not follow-ups)
      const rootExecutions = response.executions.filter(
        (exec) => !exec.parent_execution_id
      )

      // Fetch changes for each execution to get file lists
      const executionsWithChanges = await Promise.all(
        rootExecutions.map(async (exec) => {
          try {
            const changes = await executionsApi.getChanges(exec.id)
            // Get files from current snapshot (for running executions) or captured snapshot
            const snapshot = changes.current ?? changes.captured
            const changedFiles = snapshot?.files.map((f) => f.path) ?? []
            return transformExecution(exec, changedFiles)
          } catch {
            // If changes fetch fails, return execution without files
            return transformExecution(exec, [])
          }
        })
      )

      return executionsWithChanges
    },
    enabled: !!currentProjectId && isProjectSynced,
    staleTime: 10000, // 10 seconds - WebSocket handles real-time updates
    refetchInterval: 30000, // Backup polling every 30s
  })

  // Handle WebSocket messages for execution updates
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (
        message.type === 'execution_created' ||
        message.type === 'execution_updated' ||
        message.type === 'execution_status_changed' ||
        message.type === 'execution_deleted'
      ) {
        // Invalidate active executions query to refetch
        queryClient.invalidateQueries({
          queryKey: ['activeExecutions', currentProjectId],
        })
      }
    },
    [queryClient, currentProjectId]
  )

  // Register message handler and subscribe to execution updates
  useEffect(() => {
    const handlerId = 'useActiveExecutions'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
    }
  }, [connected, subscribe, addMessageHandler, removeMessageHandler, handleMessage])

  return {
    executions: executionsQuery.data ?? [],
    isLoading: executionsQuery.isLoading,
    error: executionsQuery.error as Error | null,
  }
}
