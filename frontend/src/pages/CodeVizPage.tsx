import { useRef, useState, useCallback, useEffect } from 'react'
import { useProject } from '@/hooks/useProject'
import { useProjectById } from '@/hooks/useProjects'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { useCodeGraph } from '@/hooks/useCodeGraph'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { GitBranch, Loader2 } from 'lucide-react'
import { CodeMapContainer, type CodeMapContainerRef } from '@/components/codeviz/CodeMapContainer'
import { AgentDetailSidebar, SidebarBackdrop } from '@/components/codeviz/AgentDetailSidebar'

/** Renderer type for CodeViz visualization */
export type RendererType = 'react-flow' | 'sigma'

const RENDERER_STORAGE_KEY = 'codeviz-renderer'

export default function CodeVizPage() {
  const { currentProjectId } = useProject()
  const { data: currentProject } = useProjectById(currentProjectId)
  const { data: repoInfo } = useRepositoryInfo()
  const { codeGraph, isAnalyzing } = useCodeGraph()

  // Renderer selection state with localStorage persistence
  const [renderer, setRenderer] = useState<RendererType>(() => {
    const saved = localStorage.getItem(RENDERER_STORAGE_KEY)
    return saved === 'sigma' ? 'sigma' : 'react-flow'
  })

  // Persist renderer selection to localStorage
  useEffect(() => {
    localStorage.setItem(RENDERER_STORAGE_KEY, renderer)
  }, [renderer])

  // Code map ref for highlight control
  const codeMapRef = useRef<CodeMapContainerRef>(null)

  // Selected execution state for sidebar
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)

  // Track hover highlight ID for cleanup
  const hoverHighlightRef = useRef<string | null>(null)

  // Handle file hover from sidebar - highlight on map
  const handleFileHover = useCallback((filePath: string) => {
    if (!codeMapRef.current || !selectedExecutionId) return

    // Remove previous hover highlight if any
    if (hoverHighlightRef.current) {
      codeMapRef.current.removeHighlight(hoverHighlightRef.current)
    }

    // Create new highlight with agent's color
    const agentColor = codeMapRef.current.getAgentColor(selectedExecutionId)
    hoverHighlightRef.current = codeMapRef.current.highlightFile(filePath, agentColor)
  }, [selectedExecutionId])

  // Handle file leave from sidebar - remove highlight from map
  const handleFileLeave = useCallback(() => {
    if (!codeMapRef.current || !hoverHighlightRef.current) return

    codeMapRef.current.removeHighlight(hoverHighlightRef.current)
    hoverHighlightRef.current = null
  }, [])

  // Handle sidebar close
  const handleSidebarClose = useCallback(() => {
    // Clean up any hover highlight
    if (codeMapRef.current && hoverHighlightRef.current) {
      codeMapRef.current.removeHighlight(hoverHighlightRef.current)
      hoverHighlightRef.current = null
    }
    setSelectedExecutionId(null)
  }, [])

  const isSidebarOpen = !!selectedExecutionId

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">CodeViz</h1>
          {currentProject && (
            <Badge variant="outline" className="text-xs">
              {currentProject.name}
            </Badge>
          )}
          {repoInfo && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {repoInfo.branch}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Renderer toggle */}
          <div className="flex rounded-md border border-input text-sm">
            <button
              className={cn(
                'px-3 py-1 rounded-l-md transition-colors',
                renderer === 'react-flow'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              onClick={() => setRenderer('react-flow')}
            >
              Flow
            </button>
            <button
              className={cn(
                'px-3 py-1 rounded-r-md transition-colors border-l border-input',
                renderer === 'sigma'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              onClick={() => setRenderer('sigma')}
            >
              Sigma
            </button>
          </div>
          {/* Edge count indicator for Sigma mode */}
          {renderer === 'sigma' && (
            <span className="text-xs text-muted-foreground">
              {isAnalyzing ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analyzing...
                </span>
              ) : (
                `(${codeGraph?.imports?.length ?? 0} imports)`
              )}
            </span>
          )}
        </div>
      </div>

      {/* Main content area with map and sidebar */}
      <div className="relative flex-1">
        {/* Code Map - takes full width, sidebar overlays */}
        <div
          className="h-full w-full transition-[margin] duration-300"
          style={{ marginRight: isSidebarOpen ? '350px' : '0' }}
        >
          <CodeMapContainer
            ref={codeMapRef}
            renderer={renderer}
            selectedExecutionId={selectedExecutionId}
            onExecutionSelect={setSelectedExecutionId}
          />
        </div>

        {/* Sidebar backdrop for click-to-close */}
        <SidebarBackdrop isOpen={isSidebarOpen} onClick={handleSidebarClose} />

        {/* Agent Detail Sidebar */}
        {selectedExecutionId && (
          <AgentDetailSidebar
            executionId={selectedExecutionId}
            isOpen={isSidebarOpen}
            onClose={handleSidebarClose}
            onFileHover={handleFileHover}
            onFileLeave={handleFileLeave}
          />
        )}
      </div>
    </div>
  )
}
