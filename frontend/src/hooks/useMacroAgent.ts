/**
 * Macro-Agent React Hooks
 *
 * React Query hooks for fetching macro-agent observability data.
 * Integrates with WebSocket for real-time updates.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { macroAgentApi } from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type {
  MacroAgentStatus,
  MacroAgentAgentsResponse,
  MacroAgentSessionsResponse,
  MacroAgentAgentsParams,
  ExecutionMacroAgentsResponse,
  ExecutionMacroSessionResponse,
  AgentRecord,
} from '@/types/macro-agent'

// Query key factory for macro-agent queries
export const macroAgentKeys = {
  all: ['macro-agent'] as const,
  status: () => [...macroAgentKeys.all, 'status'] as const,
  agents: (params?: MacroAgentAgentsParams) =>
    [...macroAgentKeys.all, 'agents', params ?? {}] as const,
  sessions: () => [...macroAgentKeys.all, 'sessions'] as const,
  execution: (executionId: string) =>
    [...macroAgentKeys.all, 'execution', executionId] as const,
  executionAgents: (executionId: string) =>
    [...macroAgentKeys.execution(executionId), 'agents'] as const,
  executionSession: (executionId: string) =>
    [...macroAgentKeys.execution(executionId), 'session'] as const,
}

/**
 * Hook for fetching macro-agent status
 *
 * Returns the overall status of the macro-agent observability system
 * including server readiness and agent/session counts.
 */
export function useMacroAgentStatus() {
  const query = useQuery({
    queryKey: macroAgentKeys.status(),
    queryFn: macroAgentApi.getStatus,
    // Poll every 10 seconds since server state can change
    refetchInterval: 10000,
    // Shorter stale time for status
    staleTime: 5000,
  })

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Hook for fetching macro-agent agents
 *
 * Returns all agents tracked by the observability service.
 * Supports filtering by session ID or agent state.
 *
 * @param params - Optional filtering parameters
 * @param enabled - Whether to enable the query (default: true)
 */
export function useMacroAgentAgents(
  params?: MacroAgentAgentsParams,
  enabled = true
) {
  const queryClient = useQueryClient()
  const { addMessageHandler, removeMessageHandler, connected } = useWebSocketContext()

  const query = useQuery({
    queryKey: macroAgentKeys.agents(params),
    queryFn: () => macroAgentApi.getAgents(params),
    enabled,
    staleTime: 30000,
    gcTime: 60000,
  })

  // Subscribe to WebSocket updates for real-time agent changes
  useEffect(() => {
    if (!connected) return

    const handlerId = `macro-agent-agents-${JSON.stringify(params ?? {})}`
    const handleMessage = (message: any) => {
      // Handle execution_updated events that contain macro_agent data
      if (message.type === 'execution_updated' && message.data?.macro_agent_event) {
        // Invalidate queries to refetch fresh data
        queryClient.invalidateQueries({ queryKey: macroAgentKeys.agents() })
        queryClient.invalidateQueries({ queryKey: macroAgentKeys.status() })
        queryClient.invalidateQueries({ queryKey: macroAgentKeys.sessions() })
      }
    }

    addMessageHandler(handlerId, handleMessage)
    return () => {
      removeMessageHandler(handlerId)
    }
  }, [connected, addMessageHandler, removeMessageHandler, queryClient, params])

  return {
    agents: query.data?.agents ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Hook for fetching macro-agent sessions
 *
 * Returns all known sessions with agent counts and connected executions.
 */
export function useMacroAgentSessions(enabled = true) {
  const query = useQuery({
    queryKey: macroAgentKeys.sessions(),
    queryFn: macroAgentApi.getSessions,
    enabled,
    staleTime: 30000,
    gcTime: 60000,
  })

  return {
    sessions: query.data?.sessions ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Hook for fetching agents for a specific execution
 *
 * Returns agents associated with the execution's macro-agent session.
 *
 * @param executionId - The execution ID to fetch agents for
 * @param enabled - Whether to enable the query (default: true)
 */
export function useExecutionMacroAgents(executionId: string, enabled = true) {
  const queryClient = useQueryClient()
  const { addMessageHandler, removeMessageHandler, connected } = useWebSocketContext()

  const query = useQuery({
    queryKey: macroAgentKeys.executionAgents(executionId),
    queryFn: () => macroAgentApi.getExecutionAgents(executionId),
    enabled: enabled && !!executionId,
    staleTime: 30000,
    gcTime: 60000,
  })

  // Subscribe to WebSocket updates for this execution
  useEffect(() => {
    if (!connected || !executionId) return

    const handlerId = `macro-agent-exec-agents-${executionId}`
    const handleMessage = (message: any) => {
      // Handle execution updates for this specific execution
      if (
        message.type === 'execution_updated' &&
        message.data?.id === executionId &&
        message.data?.macro_agent_event
      ) {
        queryClient.invalidateQueries({
          queryKey: macroAgentKeys.executionAgents(executionId),
        })
        queryClient.invalidateQueries({
          queryKey: macroAgentKeys.executionSession(executionId),
        })
      }
    }

    addMessageHandler(handlerId, handleMessage)
    return () => {
      removeMessageHandler(handlerId)
    }
  }, [connected, executionId, addMessageHandler, removeMessageHandler, queryClient])

  return {
    agents: query.data?.agents ?? [],
    sessionId: query.data?.sessionId ?? null,
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Hook for fetching session info for a specific execution
 *
 * Returns the macro-agent session info for an execution.
 *
 * @param executionId - The execution ID to fetch session for
 * @param enabled - Whether to enable the query (default: true)
 */
export function useExecutionMacroSession(executionId: string, enabled = true) {
  const query = useQuery({
    queryKey: macroAgentKeys.executionSession(executionId),
    queryFn: () => macroAgentApi.getExecutionSession(executionId),
    enabled: enabled && !!executionId,
    staleTime: 30000,
    gcTime: 60000,
  })

  return {
    sessionId: query.data?.sessionId ?? null,
    connectedAt: query.data?.connectedAt ?? null,
    agentCount: query.data?.agentCount ?? 0,
    runningCount: query.data?.runningCount ?? 0,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

// Re-export types for convenience
export type {
  MacroAgentStatus,
  MacroAgentAgentsResponse,
  MacroAgentSessionsResponse,
  MacroAgentAgentsParams,
  ExecutionMacroAgentsResponse,
  ExecutionMacroSessionResponse,
  AgentRecord,
}
