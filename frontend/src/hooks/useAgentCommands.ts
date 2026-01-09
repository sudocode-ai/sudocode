/**
 * useAgentCommands - Hook for managing agent slash command discovery and caching
 *
 * Provides lazy command discovery triggered on first "/" keystroke.
 * Uses localStorage for persistent caching across browser sessions.
 *
 * @module hooks/useAgentCommands
 */

import { useState, useCallback, useRef } from 'react'
import { agentsApi } from '@/lib/api'
import type { AvailableCommand } from './useSessionUpdateStream'

const CACHE_KEY_PREFIX = 'sudocode:agent-commands:'

// Track pending discovery requests to prevent duplicates
const pendingRequests = new Map<string, Promise<AvailableCommand[]>>()

/**
 * Get cached commands from localStorage
 */
function getCachedCommands(agentType: string): AvailableCommand[] | null {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${agentType}`)
    if (cached) {
      return JSON.parse(cached) as AvailableCommand[]
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

/**
 * Save commands to localStorage
 */
function setCachedCommands(agentType: string, commands: AvailableCommand[]): void {
  try {
    localStorage.setItem(`${CACHE_KEY_PREFIX}${agentType}`, JSON.stringify(commands))
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

/**
 * Clear cached commands from localStorage
 */
function clearCachedCommands(agentType?: string): void {
  try {
    if (agentType) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${agentType}`)
    } else {
      // Clear all agent command caches
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_KEY_PREFIX))
      keys.forEach((k) => localStorage.removeItem(k))
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Hook for managing agent slash command discovery
 *
 * @example
 * ```tsx
 * const { getCommands, discoverCommands, updateCache, isDiscovering } = useAgentCommands()
 *
 * // Get cached commands (synchronous)
 * const cached = getCommands('claude-code')
 *
 * // Trigger discovery (async, updates cache)
 * const commands = await discoverCommands('claude-code')
 *
 * // Update cache from WebSocket (when execution is running)
 * updateCache('claude-code', wsCommands)
 * ```
 */
export function useAgentCommands() {
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const discoveryAgentRef = useRef<string | null>(null)

  /**
   * Get cached commands for an agent type (synchronous)
   * Returns null if not cached
   */
  const getCommands = useCallback((agentType: string): AvailableCommand[] | null => {
    return getCachedCommands(agentType)
  }, [])

  /**
   * Discover commands for an agent type (async)
   * Returns cached commands if available, otherwise fetches from server
   * @param skipCache - If true, bypasses cache and fetches fresh from server
   */
  const discoverCommands = useCallback(
    async (agentType: string, skipCache = false): Promise<AvailableCommand[]> => {
      // Check cache first (unless skipping)
      if (!skipCache) {
        const cached = getCachedCommands(agentType)
        if (cached) {
          return cached
        }
      }

      // Check if there's already a pending request for this agent
      const pending = pendingRequests.get(agentType)
      if (pending && !skipCache) {
        return pending
      }

      // Start discovery
      discoveryAgentRef.current = agentType
      setIsDiscovering(true)
      setError(null)

      const request = (async () => {
        try {
          const commands = await agentsApi.discoverCommands(agentType)
          setCachedCommands(agentType, commands)
          return commands
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Discovery failed')
          setError(error)
          // Return empty array on error (graceful degradation)
          return []
        } finally {
          pendingRequests.delete(agentType)
          if (discoveryAgentRef.current === agentType) {
            setIsDiscovering(false)
            discoveryAgentRef.current = null
          }
        }
      })()

      pendingRequests.set(agentType, request)
      return request
    },
    []
  )

  /**
   * Refresh commands for an agent type (bypasses cache)
   * Use this for manual refresh
   */
  const refreshCommands = useCallback(
    async (agentType: string): Promise<AvailableCommand[]> => {
      clearCachedCommands(agentType)
      return discoverCommands(agentType, true)
    },
    [discoverCommands]
  )

  /**
   * Update cache with commands from WebSocket
   * Called when execution is running and receives available_commands_update
   */
  const updateCache = useCallback((agentType: string, commands: AvailableCommand[]) => {
    setCachedCommands(agentType, commands)
  }, [])

  /**
   * Clear cache for a specific agent or all agents
   * Useful for forcing a refresh
   */
  const clearCache = useCallback((agentType?: string) => {
    clearCachedCommands(agentType)
  }, [])

  return {
    /** Get cached commands (synchronous, returns null if not cached) */
    getCommands,
    /** Discover commands (async, fetches from server if not cached) */
    discoverCommands,
    /** Refresh commands (async, bypasses cache and fetches fresh) */
    refreshCommands,
    /** Update cache with commands from WebSocket */
    updateCache,
    /** Clear cache for refresh */
    clearCache,
    /** Whether discovery is in progress */
    isDiscovering,
    /** Error from last discovery attempt */
    error,
  }
}
