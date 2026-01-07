import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useEffect, useCallback, useState } from 'react'
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
  phase: 'scanning' | 'parsing' | 'resolving'
  current: number
  total: number
  currentFile?: string
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
  /** Full CodeGraph (null if not yet analyzed for current SHA) */
  codeGraph: CodeGraph | null
  /** File tree (always available, loaded immediately) */
  fileTree: FileTreeResponse | null
  /** True while loading file tree or code graph */
  isLoading: boolean
  /** True while background analysis is running */
  isAnalyzing: boolean
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

  // Mutation for triggering analysis
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const response = await codevizApi.triggerAnalysis()
      if (response.status === 'started') {
        setIsAnalyzing(true)
        setAnalysisProgress({ phase: 'scanning', current: 0, total: 0 })
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
          phase: 'scanning' | 'parsing' | 'resolving'
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

  // Extract data from responses
  const codeGraphData = codeGraphQuery.data as CodeGraphResponse | null
  const fileTreeData = fileTreeQuery.data as FileTreeResponse | null

  return {
    codeGraph: codeGraphData?.codeGraph ?? null,
    fileTree: fileTreeData ?? null,
    isLoading: fileTreeQuery.isLoading || codeGraphQuery.isLoading,
    isAnalyzing,
    analysisProgress,
    error: (fileTreeQuery.error ?? codeGraphQuery.error ?? analysisMutation.error) as Error | null,
    triggerAnalysis,
    gitSha: codeGraphData?.gitSha ?? null,
    analyzedAt: codeGraphData?.analyzedAt ?? null,
    stats: codeGraphData?.stats ?? null,
    refetch,
  }
}

export type { FileTreeResponse, CodeGraphResponse }
