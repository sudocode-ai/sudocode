import { useQuery } from '@tanstack/react-query'
import { agentsApi } from '@/lib/api'
import type { AgentInfo } from '@/types/api'

/**
 * Hook for fetching available agents from the API
 *
 * This hook fetches the list of available AI agents (Claude Code, Codex, Copilot, Cursor)
 * and caches the results. Agents are marked as implemented or coming soon.
 *
 * @returns {UseAgentsReturn} Object containing agents list, loading state, error state, and refetch function
 *
 * @example
 * ```tsx
 * function AgentSelector() {
 *   const { agents, loading, error, refetch } = useAgents()
 *
 *   if (loading) return <div>Loading agents...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <select>
 *       {agents?.map(agent => (
 *         <option key={agent.type} value={agent.type} disabled={!agent.implemented}>
 *           {agent.displayName} {!agent.implemented && '(Coming Soon)'}
 *         </option>
 *       ))}
 *     </select>
 *   )
 * }
 * ```
 */
export function useAgents() {
  const query = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.getAll,
    // Cache for 5 minutes - agents list rarely changes
    staleTime: 5 * 60 * 1000,
    // Keep in cache for 10 minutes
    gcTime: 10 * 60 * 1000,
  })

  return {
    agents: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Return type for useAgents hook
 */
export interface UseAgentsReturn {
  /**
   * List of available agents, or null if not yet loaded
   */
  agents: AgentInfo[] | null

  /**
   * True while fetching agents from API
   */
  loading: boolean

  /**
   * Error object if fetch failed, null otherwise
   */
  error: Error | null

  /**
   * Function to manually refetch agents list
   */
  refetch: () => void
}
