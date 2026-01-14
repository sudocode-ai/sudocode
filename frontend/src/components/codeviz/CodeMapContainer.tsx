import {
  useMemo,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import {
  CodeMapComponent,
  useLayout,
  ThemeProvider as CodevizThemeProvider,
  type CodeGraph,
  type FileNode as CodevizFileNode,
  type DirectoryNode as CodevizDirectoryNode,
  type CodebaseMetadata,
  generateFileId,
  generateDirectoryId,
  detectLanguage,
} from 'codeviz/browser'

/**
 * Options for nexus view graph generation.
 * Note: This type is defined locally until codeviz library exports it.
 */
export interface NexusViewOptions {
  /** Include symbol nodes (functions, classes, etc.) - default: true */
  includeSymbols?: boolean
}
import { useCodeGraph, type FileTreeResponse } from '@/hooks/useCodeGraph'
import { useActiveExecutions } from '@/hooks/useActiveExecutions'
import { useCodeVizOverlays } from '@/hooks/useCodeVizOverlays'
import { useFileEntityMap } from '@/hooks/useFileEntityMap'
import { useTheme } from '@/contexts/ThemeContext'
import { useProjectContext } from '@/contexts/ProjectContext'
import { getAgentColor } from '@/utils/colors'
import { Loader2, Zap, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Transform FileTreeResponse from the server into codeviz CodeGraph format.
 * Used as fallback when full CodeGraph is not yet analyzed.
 */
function transformToCodeGraph(fileTree: FileTreeResponse): CodeGraph {
  const { files, directories, metadata } = fileTree

  // Build a map of directory paths to their info for quick lookup
  const directoryMap = new Map<string, { path: string; name: string; parentPath: string | null }>()
  directories.forEach((dir) => {
    directoryMap.set(dir.path, dir)
  })

  // Build directory children map
  const directoryChildren = new Map<string, string[]>()
  const directoryFiles = new Map<string, string[]>()

  // Initialize root directory (empty path)
  directoryChildren.set('', [])
  directoryFiles.set('', [])

  directories.forEach((dir) => {
    directoryChildren.set(dir.path, [])
    directoryFiles.set(dir.path, [])
  })

  // Populate children relationships
  directories.forEach((dir) => {
    if (dir.parentPath) {
      const siblings = directoryChildren.get(dir.parentPath)
      if (siblings) {
        siblings.push(generateDirectoryId(dir.path))
      }
    } else {
      // Top-level directory - add to root's children
      const rootChildren = directoryChildren.get('')
      if (rootChildren) {
        rootChildren.push(generateDirectoryId(dir.path))
      }
    }
  })

  // Transform files
  const codevizFiles: CodevizFileNode[] = files.map((file) => {
    const fileId = generateFileId(file.path)
    const dirId = file.directoryPath
      ? generateDirectoryId(file.directoryPath)
      : generateDirectoryId('')

    // Add file to directory's files list
    const dirFiles = directoryFiles.get(file.directoryPath)
    if (dirFiles) {
      dirFiles.push(fileId)
    }

    return {
      id: fileId,
      path: file.path,
      name: file.name,
      extension: file.extension,
      directoryId: dirId,
      metrics: {
        loc: 100, // Default placeholder since we don't have actual LOC
        totalLines: 100,
        exportCount: 0,
        importCount: 0,
      },
      symbols: [],
      language: detectLanguage(file.extension),
    }
  })

  // Create root directory ID
  const rootDirId = generateDirectoryId('')

  // Transform directories - all top-level dirs should have root as parent
  const codevizDirectories: CodevizDirectoryNode[] = directories.map((dir) => {
    const dirId = generateDirectoryId(dir.path)
    // Top-level directories (parentPath === null) should have root as parent
    const parentId = dir.parentPath ? generateDirectoryId(dir.parentPath) : rootDirId
    const depth = dir.path.split('/').filter(Boolean).length

    return {
      id: dirId,
      path: dir.path,
      name: dir.name,
      parentId,
      children: directoryChildren.get(dir.path) || [],
      files: directoryFiles.get(dir.path) || [],
      metrics: {
        fileCount: (directoryFiles.get(dir.path) || []).length,
        totalLoc: (directoryFiles.get(dir.path) || []).length * 100,
      },
      depth,
    }
  })

  // Always add root directory (uses pre-built children and files lists)
  const rootDir: CodevizDirectoryNode = {
    id: rootDirId,
    path: '',
    name: 'root',
    parentId: null,
    children: directoryChildren.get('') || [],
    files: directoryFiles.get('') || [],
    metrics: {
      fileCount: metadata.totalFiles,
      totalLoc: metadata.totalFiles * 100,
    },
    depth: 0,
  }

  codevizDirectories.unshift(rootDir)

  const codeGraphMetadata: CodebaseMetadata = {
    rootPath: '.',
    analyzedAt: metadata.generatedAt,
    totalFiles: metadata.totalFiles,
    totalDirectories: metadata.totalDirectories,
    totalSymbols: 0,
    languages: [...new Set(codevizFiles.map((f) => f.language))],
    analysisDurationMs: 0,
  }

  return {
    files: codevizFiles,
    directories: codevizDirectories,
    symbols: [],
    imports: [],
    calls: [],
    metadata: codeGraphMetadata,
  }
}

/** Renderer type for CodeViz visualization */
export type RendererType = 'react-flow' | 'sigma'

/**
 * Props for CodeMapContainer
 */
export interface CodeMapContainerProps {
  /** Renderer to use: 'react-flow' (default) or 'sigma' (WebGL) */
  renderer?: RendererType
  /** Externally controlled selected execution ID */
  selectedExecutionId?: string | null
  /** Callback when an agent/execution is clicked */
  onExecutionSelect?: (executionId: string | null) => void
  /** Options for nexus view (sigma renderer) */
  nexusOptions?: NexusViewOptions
}

/**
 * Ref handle for CodeMapContainer
 */
export interface CodeMapContainerRef {
  /** Highlight a file on the map */
  highlightFile: (filePath: string, color?: string) => string
  /** Remove a file highlight */
  removeHighlight: (highlightId: string) => void
  /** Get agent color for an execution */
  getAgentColor: (executionId: string) => string
}

/**
 * Loading state component
 */
function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Loading codebase...</span>
      </div>
    </div>
  )
}

/**
 * Error state component
 */
function ErrorState({ error }: { error: Error }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-destructive">
        <span>Failed to load codebase</span>
        <span className="text-sm text-muted-foreground">{error.message}</span>
      </div>
    </div>
  )
}

/**
 * Empty state component
 */
function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-muted-foreground">No files found in codebase</div>
    </div>
  )
}

/**
 * Analysis status indicator component
 */
function AnalysisIndicator({
  isAnalyzing,
  isStale,
  hasFullCodeGraph,
  analysisProgress,
  onAnalyze,
  autoAnalyzing,
}: {
  isAnalyzing: boolean
  isStale: boolean
  hasFullCodeGraph: boolean
  analysisProgress: { phase: string; current: number; total: number; currentFile?: string } | null
  onAnalyze: () => void
  autoAnalyzing: boolean
}) {
  // Show progress during analysis (whether auto-triggered or manual)
  // When stale, show a subtle indicator instead of full progress
  if (isAnalyzing && !isStale) {
    const percentage =
      analysisProgress && analysisProgress.total > 0
        ? Math.round((analysisProgress.current / analysisProgress.total) * 100)
        : 0

    // Map phase to user-friendly text
    const phaseText = analysisProgress?.phase
      ? {
          scanning: 'Scanning files',
          detecting: 'Detecting changes',
          extracting: 'Extracting symbols',
          parsing: 'Parsing files',
          resolving: 'Resolving imports',
        }[analysisProgress.phase] || 'Analyzing'
      : 'Starting'

    return (
      <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {analysisProgress && analysisProgress.total > 0 ? (
                <>
                  {phaseText}: {analysisProgress.current}/{analysisProgress.total} files ({percentage}
                  %)
                </>
              ) : (
                <>{phaseText}...</>
              )}
            </span>
            {analysisProgress?.currentFile && (
              <span className="max-w-[300px] truncate text-xs text-muted-foreground">
                {analysisProgress.currentFile}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Stale cache being refreshed - subtle indicator (graph is shown, just updating)
  if (isStale && isAnalyzing) {
    return (
      <div className="absolute right-4 top-4 z-50">
        <div className="flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Updating...</span>
        </div>
      </div>
    )
  }

  if (hasFullCodeGraph && !isStale) {
    return (
      <div className="absolute right-4 top-4 z-50">
        <div className="flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-muted-foreground">Full analysis</span>
        </div>
      </div>
    )
  }

  // Auto-analysis starting - show starting indicator
  if (autoAnalyzing) {
    return (
      <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">Starting analysis...</span>
        </div>
      </div>
    )
  }

  // No CodeGraph cached and auto-analysis didn't trigger - show manual button as fallback
  return (
    <div className="absolute right-4 top-4 z-50">
      <Button variant="outline" size="sm" onClick={onAnalyze} className="gap-2">
        <Zap className="h-4 w-4" />
        Analyze for symbols
      </Button>
    </div>
  )
}

/**
 * CodeMapContainer - Fetches CodeGraph and renders the codeviz CodeMapComponent
 *
 * Features progressive enhancement:
 * - Immediately shows file tree structure (fast)
 * - Shows full CodeGraph with symbols when cached
 * - Provides "Analyze" button to trigger background analysis
 */
export const CodeMapContainer = forwardRef<CodeMapContainerRef, CodeMapContainerProps>(
  function CodeMapContainer(
    { renderer = 'react-flow', selectedExecutionId, onExecutionSelect, nexusOptions },
    ref
  ) {
    const {
      codeGraph: fullCodeGraph,
      fileTree,
      isLoading,
      isAnalyzing,
      isStale,
      analysisProgress,
      error,
      triggerAnalysis,
    } = useCodeGraph()
    const { theme: appTheme } = useTheme()
    const { currentProjectId } = useProjectContext()

    // Track if we've triggered auto-analysis (for UI state)
    const [hasTriggeredAutoAnalysis, setHasTriggeredAutoAnalysis] = useState(false)
    // Use ref to prevent double-triggering in strict mode
    const autoAnalysisTriggeredRef = useRef(false)

    // Auto-trigger analysis when no cached CodeGraph is available
    useEffect(() => {
      // Only auto-trigger once, when:
      // - Not loading (we know the state)
      // - No full code graph cached
      // - Not already analyzing
      // - File tree is available (valid project)
      // - Haven't already attempted
      if (
        !isLoading &&
        !fullCodeGraph &&
        !isAnalyzing &&
        fileTree &&
        fileTree.files.length > 0 &&
        !autoAnalysisTriggeredRef.current
      ) {
        autoAnalysisTriggeredRef.current = true
        setHasTriggeredAutoAnalysis(true)
        triggerAnalysis()
      }
    }, [isLoading, fullCodeGraph, isAnalyzing, fileTree, triggerAnalysis])

    // Clear auto-analysis state when we have a full code graph
    useEffect(() => {
      if (fullCodeGraph && hasTriggeredAutoAnalysis) {
        setHasTriggeredAutoAnalysis(false)
      }
    }, [fullCodeGraph, hasTriggeredAutoAnalysis])

    // Agent overlay integration
    const { executions } = useActiveExecutions()

    // Use external selection if provided, otherwise manage internally
    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null)
    const selectedAgentId =
      selectedExecutionId !== undefined ? selectedExecutionId : internalSelectedId

    // Handle agent selection
    const handleAgentClick = useCallback(
      (executionId: string) => {
        if (onExecutionSelect) {
          // External control: toggle selection
          onExecutionSelect(selectedAgentId === executionId ? null : executionId)
        } else {
          // Internal control
          setInternalSelectedId((prev) => (prev === executionId ? null : executionId))
        }
      },
      [onExecutionSelect, selectedAgentId]
    )

    // File entity mapping for highlights and badges
    const { fileEntityMap } = useFileEntityMap()

    const { overlayPort, highlightFile, removeHighlight } = useCodeVizOverlays({
      executions,
      selectedAgentId,
      onAgentClick: handleAgentClick,
      fileEntityMap,
      showFileHighlights: true,
      showChangeBadges: true,
    })

    // Expose highlight functions via ref
    useImperativeHandle(
      ref,
      () => ({
        highlightFile,
        removeHighlight,
        getAgentColor,
      }),
      [highlightFile, removeHighlight]
    )

    // Use full CodeGraph if available, otherwise transform file tree
    const codeGraph = useMemo(() => {
      if (fullCodeGraph) return fullCodeGraph
      if (fileTree) return transformToCodeGraph(fileTree)
      return null
    }, [fullCodeGraph, fileTree])

    // Compute layout using codeviz hook
    const { codeMap, isComputing, error: layoutError } = useLayout(codeGraph)

    // Loading states
    if (isLoading) {
      return <LoadingState />
    }

    if (error) {
      return <ErrorState error={error} />
    }

    if (!fileTree || fileTree.files.length === 0) {
      return <EmptyState />
    }

    if (isComputing) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span>Computing layout...</span>
          </div>
        </div>
      )
    }

    if (layoutError) {
      return <ErrorState error={layoutError} />
    }

    if (!codeMap) {
      return <EmptyState />
    }

    // Map app theme to codeviz theme
    const codevizTheme = appTheme === 'dark' ? 'dark' : 'light'

    return (
      <div className="relative h-full w-full">
        <AnalysisIndicator
          isAnalyzing={isAnalyzing}
          isStale={isStale}
          hasFullCodeGraph={!!fullCodeGraph}
          analysisProgress={analysisProgress}
          onAnalyze={triggerAnalysis}
          autoAnalyzing={hasTriggeredAutoAnalysis && !fullCodeGraph && !isAnalyzing}
        />
        <CodevizThemeProvider initialTheme={codevizTheme}>
          <CodeMapComponent
            codeMap={codeMap}
            renderer={renderer}
            view={renderer === 'sigma' ? 'nexus' : undefined}
            codeGraph={codeGraph ?? undefined}
            overlayPort={renderer === 'react-flow' ? overlayPort : undefined}
            settlingSpeed="normal"
            continuousLayout={renderer === 'sigma'}
            cachePositions={renderer === 'sigma'}
            cacheKey={currentProjectId ? `codeviz-${currentProjectId}` : undefined}
            // Pass nexusOptions when codeviz library supports it
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ nexusOptions } as any)}
            onNodeClick={(nodeId, node) => {
              console.log('Node clicked:', nodeId, node)
            }}
            onZoomLevelChange={(level) => {
              console.log('Zoom level:', level)
            }}
          />
        </CodevizThemeProvider>
      </div>
    )
  }
)
