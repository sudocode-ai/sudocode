import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useEffect, useCallback, useState, useRef } from 'react'
import {
  codevizApi,
  getCurrentProjectId,
  type CodeGraphResponse,
  type FileTreeResponse,
} from '@/lib/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useProject } from '@/hooks/useProject'
import type { WebSocketMessage } from '@/types/api'
import type { CodeGraph } from 'codeviz/browser'

/**
 * Analysis progress information from WebSocket
 */
export interface AnalysisProgress {
  phase: 'scanning' | 'parsing' | 'resolving' | 'detecting' | 'extracting'
  current: number
  total: number
  currentFile?: string
}

/**
 * File change information from watcher
 */
export interface FileChangeInfo {
  path: string
  fileId: string
  changeType: 'added' | 'modified' | 'deleted'
}

/**
 * CodeGraph stats from analysis
 */
export interface CodeGraphStats {
  fileCount: number
  symbolCount: number
  analysisDurationMs: number
}

/**
 * Result returned by useCodeGraph hook
 */
export interface UseCodeGraphResult {
  /** Full CodeGraph (null if not yet analyzed) */
  codeGraph: CodeGraph | null
  /** File tree (always available, loaded immediately) */
  fileTree: FileTreeResponse | null
  /** True while loading file tree or code graph */
  isLoading: boolean
  /** True while background analysis is running */
  isAnalyzing: boolean
  /** True if the cached CodeGraph is from a different SHA (being refreshed in background) */
  isStale: boolean
  /** Progress info during analysis */
  analysisProgress: AnalysisProgress | null
  /** Error if any operation failed */
  error: Error | null
  /** Trigger background CodeGraph analysis */
  triggerAnalysis: () => Promise<void>
  /** Current git SHA */
  gitSha: string | null
  /** When the CodeGraph was analyzed */
  analyzedAt: string | null
  /** Statistics from the analysis */
  stats: CodeGraphStats | null
  /** Refetch the code graph (e.g., after git changes) */
  refetch: () => void
  /** Whether file watcher is active */
  isWatching: boolean
  /** Start file watcher for auto-reindexing */
  startWatcher: (options?: { autoAnalyze?: boolean }) => Promise<void>
  /** Stop file watcher */
  stopWatcher: () => Promise<void>
  /** Recent file changes detected by watcher */
  recentChanges: FileChangeInfo[]
}

/**
 * Hook for fetching and managing CodeGraph data with progressive enhancement.
 *
 * Features:
 * - Immediately loads file tree (fast, always available)
 * - Attempts to load cached CodeGraph for current git SHA
 * - Provides triggerAnalysis() to start background analysis
 * - Real-time updates via WebSocket for analysis progress
 * - Automatic cache invalidation when git SHA changes
 */
export function useCodeGraph(): UseCodeGraphResult {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()
  const { connected, subscribe, addMessageHandler, removeMessageHandler } =
    useWebSocketContext()

  // Local state for analysis progress (from WebSocket)
  const [analysisProgress, setAnalysisProgress] =
    useState<AnalysisProgress | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // File watcher state
  const [isWatching, setIsWatching] = useState(false)
  const [recentChanges, setRecentChanges] = useState<FileChangeInfo[]>([])
  const watcherStartedRef = useRef(false)

  // Check if context projectId matches API client projectId
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  // Query for file tree (always fetch, fast operation)
  const fileTreeQuery = useQuery({
    queryKey: ['fileTree', currentProjectId],
    queryFn: () => codevizApi.getFileTree(),
    enabled: !!currentProjectId && isProjectSynced,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes cache
  })

  // Query for code graph (may return 404 if not cached)
  const codeGraphQuery = useQuery({
    queryKey: ['codeGraph', currentProjectId],
    queryFn: async () => {
      try {
        return await codevizApi.getCodeGraph()
      } catch (error: any) {
        // 404 means no cached CodeGraph - this is expected, not an error
        if (error?.response?.status === 404) {
          return null
        }
        throw error
      }
    },
    enabled: !!currentProjectId && isProjectSynced,
    staleTime: 60000, // 1 minute - git SHA check handles cache invalidation
    gcTime: 300000, // 5 minutes cache
    retry: false, // Don't retry 404s
  })

  // Mutation for triggering analysis (uses incremental by default)
  const analysisMutation = useMutation({
    mutationFn: async () => {
      // Use incremental analysis by default - only re-analyzes changed files
      const response = await codevizApi.triggerIncrementalAnalysis()
      if (response.status === 'started') {
        setIsAnalyzing(true)
        setAnalysisProgress({ phase: 'detecting', current: 0, total: 0 })
      } else if (response.status === 'already_cached') {
        // Already have the result, just refetch
        queryClient.invalidateQueries({ queryKey: ['codeGraph', currentProjectId] })
      }
      // already_running - just wait for WebSocket updates
      return response
    },
  })

  // Handle WebSocket messages for code graph events
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (message.type === 'code_graph_ready') {
        // Analysis completed - refetch the code graph
        setIsAnalyzing(false)
        setAnalysisProgress(null)
        queryClient.invalidateQueries({
          queryKey: ['codeGraph', currentProjectId],
        })
      } else if (message.type === 'code_graph_progress') {
        // Update progress state
        const data = message.data as {
          phase: 'scanning' | 'parsing' | 'resolving' | 'detecting' | 'extracting'
          current: number
          total: number
          currentFile?: string
        }
        setIsAnalyzing(true)
        setAnalysisProgress({
          phase: data.phase,
          current: data.current,
          total: data.total,
          currentFile: data.currentFile,
        })
      } else if (message.type === 'file_changes_detected') {
        // File changes detected by watcher
        const data = message.data as {
          changes: FileChangeInfo[]
          timestamp: number
        }
        setRecentChanges(data.changes)
        // Clear recent changes after 5 seconds
        setTimeout(() => setRecentChanges([]), 5000)
      } else if (message.type === 'watcher_started') {
        setIsWatching(true)
      } else if (message.type === 'watcher_stopped') {
        setIsWatching(false)
      }
    },
    [queryClient, currentProjectId]
  )

  // Register WebSocket message handler
  useEffect(() => {
    const handlerId = 'useCodeGraph'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      // Subscribe to all events for this project (code_graph events are project-scoped)
      subscribe('all')
    }

    return () => {
      removeMessageHandler(handlerId)
    }
  }, [connected, subscribe, addMessageHandler, removeMessageHandler, handleMessage])

  // Check if analysis is running on mount (in case we missed the start)
  useEffect(() => {
    if (!currentProjectId || !isProjectSynced) return

    const checkStatus = async () => {
      try {
        const status = await codevizApi.getAnalysisStatus()
        if (status.status === 'running') {
          setIsAnalyzing(true)
          if (status.phase) {
            setAnalysisProgress({
              phase: status.phase,
              current: status.progress?.current ?? 0,
              total: status.progress?.total ?? 0,
              currentFile: status.currentFile,
            })
          }
        }
      } catch {
        // Ignore errors - this is just a convenience check
      }
    }
    checkStatus()
  }, [currentProjectId, isProjectSynced])

  // Trigger analysis function
  const triggerAnalysis = useCallback(async () => {
    await analysisMutation.mutateAsync()
  }, [analysisMutation])

  // Refetch function
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['codeGraph', currentProjectId] })
    queryClient.invalidateQueries({ queryKey: ['fileTree', currentProjectId] })
  }, [queryClient, currentProjectId])

  // Start file watcher
  const startWatcher = useCallback(
    async (options?: { autoAnalyze?: boolean }) => {
      if (watcherStartedRef.current) return
      try {
        const response = await codevizApi.startWatcher(options)
        if (response.status === 'started' || response.status === 'already_watching') {
          setIsWatching(true)
          watcherStartedRef.current = true
        }
      } catch (error) {
        console.error('[useCodeGraph] Failed to start watcher:', error)
      }
    },
    []
  )

  // Stop file watcher
  const stopWatcher = useCallback(async () => {
    if (!watcherStartedRef.current) return
    try {
      await codevizApi.stopWatcher()
      setIsWatching(false)
      watcherStartedRef.current = false
    } catch (error) {
      console.error('[useCodeGraph] Failed to stop watcher:', error)
    }
  }, [])

  // Extract data from responses
  const codeGraphData = codeGraphQuery.data as CodeGraphResponse | null
  const fileTreeData = fileTreeQuery.data as FileTreeResponse | null

  // Check if cache is stale (from different SHA than current HEAD)
  const isStale = codeGraphData?.stale ?? false

  // Auto-trigger incremental analysis when cache is stale
  // Use a separate ref to track stale refresh to avoid double-triggering
  const staleRefreshTriggeredRef = useRef(false)
  useEffect(() => {
    if (
      isStale &&
      !isAnalyzing &&
      !staleRefreshTriggeredRef.current &&
      codeGraphData
    ) {
      staleRefreshTriggeredRef.current = true
      // Trigger incremental analysis in background
      triggerAnalysis().catch(console.error)
    }
    // Reset when we get fresh data
    if (!isStale && staleRefreshTriggeredRef.current) {
      staleRefreshTriggeredRef.current = false
    }
  }, [isStale, isAnalyzing, codeGraphData, triggerAnalysis])

  return {
    codeGraph: codeGraphData?.codeGraph ?? null,
    fileTree: fileTreeData ?? null,
    isLoading: fileTreeQuery.isLoading || codeGraphQuery.isLoading,
    isAnalyzing,
    isStale,
    analysisProgress,
    error: (fileTreeQuery.error ?? codeGraphQuery.error ?? analysisMutation.error) as Error | null,
    triggerAnalysis,
    gitSha: codeGraphData?.gitSha ?? null,
    analyzedAt: codeGraphData?.analyzedAt ?? null,
    stats: codeGraphData?.stats ?? null,
    refetch,
    isWatching,
    startWatcher,
    stopWatcher,
    recentChanges,
  }
}

export type { FileTreeResponse, CodeGraphResponse }
