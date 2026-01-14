import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeMapContainer } from '@/components/codeviz/CodeMapContainer'

// Mock useCodeGraph hook
const mockTriggerAnalysis = vi.fn()
const mockUseCodeGraph = vi.fn()

vi.mock('@/hooks/useCodeGraph', () => ({
  useCodeGraph: () => mockUseCodeGraph(),
}))

// Mock useActiveExecutions hook
const mockUseActiveExecutions = vi.fn()
vi.mock('@/hooks/useActiveExecutions', () => ({
  useActiveExecutions: () => mockUseActiveExecutions(),
}))

// Mock useCodeVizOverlays hook
const mockOverlayPort = {
  bind: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  getOverlays: vi.fn().mockReturnValue([]),
}
const mockUseCodeVizOverlays = vi.fn()
vi.mock('@/hooks/useCodeVizOverlays', () => ({
  useCodeVizOverlays: (options: any) => mockUseCodeVizOverlays(options),
}))

// Mock useFileEntityMap hook
const mockUseFileEntityMap = vi.fn()
vi.mock('@/hooks/useFileEntityMap', () => ({
  useFileEntityMap: () => mockUseFileEntityMap(),
}))

// Mock ThemeContext
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}))

// Mock ProjectContext
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    currentProjectId: 'test-project',
    projectPath: '/test/project',
    isProjectOpen: true,
  }),
}))

// Mock codeviz/browser
vi.mock('codeviz/browser', () => ({
  CodeMapComponent: ({
    codeMap,
    overlayPort,
    renderer,
    view,
    codeGraph,
  }: {
    codeMap: any
    overlayPort?: any
    renderer?: string
    view?: string
    codeGraph?: any
  }) => (
    <div data-testid="code-map-component">
      <span data-testid="file-count">{codeMap?.files?.length ?? 0}</span>
      {overlayPort && <span data-testid="has-overlay-port">true</span>}
      <span data-testid="renderer">{renderer ?? 'react-flow'}</span>
      {view && <span data-testid="view">{view}</span>}
      {codeGraph && <span data-testid="has-code-graph">true</span>}
    </div>
  ),
  useLayout: (codeGraph: any) => ({
    codeMap: codeGraph
      ? {
          files: codeGraph.files,
          directories: codeGraph.directories,
        }
      : null,
    isComputing: false,
    error: null,
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  generateFileId: (path: string) => `file-${path}`,
  generateDirectoryId: (path: string) => `dir-${path}`,
  detectLanguage: (ext: string) => (ext === 'ts' ? 'typescript' : 'unknown'),
}))

// Mock file tree data
const mockFileTree = {
  files: [
    { path: 'src/index.ts', name: 'index.ts', extension: 'ts', directoryPath: 'src' },
    { path: 'src/utils.ts', name: 'utils.ts', extension: 'ts', directoryPath: 'src' },
    { path: 'README.md', name: 'README.md', extension: 'md', directoryPath: '' },
  ],
  directories: [{ path: 'src', name: 'src', parentPath: null }],
  metadata: {
    totalFiles: 3,
    totalDirectories: 1,
    generatedAt: '2024-01-01T00:00:00Z',
  },
}

// Mock full code graph
const mockCodeGraph = {
  files: [
    { id: 'f1', path: 'src/index.ts', name: 'index.ts' },
    { id: 'f2', path: 'src/utils.ts', name: 'utils.ts' },
  ],
  directories: [{ id: 'd1', path: 'src', name: 'src' }],
  symbols: [{ id: 's1', name: 'main', kind: 'function' }],
  imports: [],
  calls: [],
  metadata: {
    totalFiles: 2,
    totalDirectories: 1,
    totalSymbols: 1,
  },
}

describe('CodeMapContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerAnalysis.mockClear()
    // Default mock for useActiveExecutions
    mockUseActiveExecutions.mockReturnValue({
      executions: [],
      isLoading: false,
      error: null,
    })
    // Default mock for useCodeVizOverlays
    mockUseCodeVizOverlays.mockReturnValue({
      overlayPort: mockOverlayPort,
      overlayCount: 0,
      clearAgentOverlays: vi.fn(),
      clearFileHighlights: vi.fn(),
      clearChangeBadges: vi.fn(),
      highlightFile: vi.fn(),
      removeHighlight: vi.fn(),
      getFileAgentInfo: vi.fn().mockReturnValue([]),
    })
    // Default mock for useFileEntityMap
    mockUseFileEntityMap.mockReturnValue({
      fileEntityMap: {},
      isLoading: false,
      error: null,
      fileCount: 0,
      executionCount: 0,
    })
  })

  describe('Loading state', () => {
    it('should show loading spinner when loading', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: null,
        isLoading: true,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Loading codebase...')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('should show error message when error occurs', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: null,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: new Error('Failed to load'),
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Failed to load codebase')).toBeInTheDocument()
      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })
  })

  describe('Empty state', () => {
    it('should show empty message when no files', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: { files: [], directories: [], metadata: { totalFiles: 0, totalDirectories: 0 } },
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('No files found in codebase')).toBeInTheDocument()
    })
  })

  describe('File tree only (no CodeGraph)', () => {
    it('should render code map with file tree', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByTestId('code-map-component')).toBeInTheDocument()
    })

    it('should auto-trigger analysis when files exist without CodeGraph', () => {
      // When there are files but no code graph, component auto-triggers analysis
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      // Auto-analysis should be triggered, showing "Starting analysis..." state
      expect(mockTriggerAnalysis).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Starting analysis...')).toBeInTheDocument()
    })

    it('should show empty state when no files in file tree', () => {
      // Empty file tree doesn't trigger auto-analysis
      const emptyFileTree = {
        files: [],
        directories: [],
        metadata: { totalFiles: 0, totalDirectories: 0 },
      }
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: emptyFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      // Empty file tree shows "No files found" message
      expect(screen.getByText('No files found in codebase')).toBeInTheDocument()
    })
  })

  describe('Full CodeGraph available', () => {
    it('should render with full CodeGraph', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByTestId('code-map-component')).toBeInTheDocument()
    })

    it('should show "Full analysis" badge', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Full analysis')).toBeInTheDocument()
    })

    it('should not show analyze button when CodeGraph available', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.queryByText('Analyze for symbols')).not.toBeInTheDocument()
    })
  })

  describe('Analysis in progress', () => {
    it('should show progress indicator while analyzing', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: true,
        analysisProgress: {
          phase: 'parsing',
          current: 50,
          total: 100,
          currentFile: 'src/index.ts',
        },
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Parsing files: 50/100 files (50%)')).toBeInTheDocument()
      expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    })

    it('should show phase text when total is 0', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: true,
        analysisProgress: {
          phase: 'scanning',
          current: 0,
          total: 0,
        },
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Scanning files...')).toBeInTheDocument()
    })

    it('should not show analyze button while analyzing', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: true,
        analysisProgress: {
          phase: 'parsing',
          current: 50,
          total: 100,
        },
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.queryByText('Analyze for symbols')).not.toBeInTheDocument()
    })
  })

  describe('Theme handling', () => {
    it('should render without crashing in dark theme', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      const { container } = render(<CodeMapContainer />)

      expect(container.querySelector('[data-testid="code-map-component"]')).toBeInTheDocument()
    })
  })

  describe('Agent overlay integration', () => {
    it('should pass overlay port to CodeMapComponent', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(screen.getByTestId('has-overlay-port')).toBeInTheDocument()
    })

    it('should initialize useCodeVizOverlays with empty executions', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(mockUseCodeVizOverlays).toHaveBeenCalledWith(
        expect.objectContaining({
          executions: [],
          selectedAgentId: null,
          onAgentClick: expect.any(Function),
        })
      )
    })

    it('should pass active executions to useCodeVizOverlays', () => {
      const mockExecutions = [
        {
          id: 'exec-001',
          issueId: 'i-abc1',
          agentType: 'claude-code',
          status: 'running',
          worktreePath: '/worktree',
          changedFiles: ['src/index.ts'],
          startedAt: '2024-01-01T10:00:00Z',
        },
      ]

      mockUseActiveExecutions.mockReturnValue({
        executions: mockExecutions,
        isLoading: false,
        error: null,
      })

      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(mockUseCodeVizOverlays).toHaveBeenCalledWith(
        expect.objectContaining({
          executions: mockExecutions,
        })
      )
    })

    it('should use useActiveExecutions hook', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(mockUseActiveExecutions).toHaveBeenCalled()
    })

    it('should use useFileEntityMap hook', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(mockUseFileEntityMap).toHaveBeenCalled()
    })

    it('should pass fileEntityMap to useCodeVizOverlays', () => {
      const mockFileEntityMapData = {
        'src/index.ts': {
          executions: ['exec-001'],
          issues: ['i-abc1'],
          specs: [],
          changes: {
            'exec-001': { additions: 10, deletions: 5, status: 'M' },
          },
        },
      }

      mockUseFileEntityMap.mockReturnValue({
        fileEntityMap: mockFileEntityMapData,
        isLoading: false,
        error: null,
        fileCount: 1,
        executionCount: 1,
      })

      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(mockUseCodeVizOverlays).toHaveBeenCalledWith(
        expect.objectContaining({
          fileEntityMap: mockFileEntityMapData,
          showFileHighlights: true,
          showChangeBadges: true,
        })
      )
    })

    it('should enable file highlights and badges by default', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer />)

      expect(mockUseCodeVizOverlays).toHaveBeenCalledWith(
        expect.objectContaining({
          showFileHighlights: true,
          showChangeBadges: true,
        })
      )
    })
  })

  describe('Renderer prop', () => {
    beforeEach(() => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })
    })

    it('should default to react-flow renderer', () => {
      render(<CodeMapContainer />)

      expect(screen.getByTestId('renderer')).toHaveTextContent('react-flow')
    })

    it('should pass react-flow renderer when specified', () => {
      render(<CodeMapContainer renderer="react-flow" />)

      expect(screen.getByTestId('renderer')).toHaveTextContent('react-flow')
    })

    it('should pass sigma renderer when specified', () => {
      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.getByTestId('renderer')).toHaveTextContent('sigma')
    })

    it('should pass view="nexus" when renderer is sigma', () => {
      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.getByTestId('view')).toHaveTextContent('nexus')
    })

    it('should not pass view when renderer is react-flow', () => {
      render(<CodeMapContainer renderer="react-flow" />)

      expect(screen.queryByTestId('view')).not.toBeInTheDocument()
    })

    it('should pass codeGraph to CodeMapComponent', () => {
      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.getByTestId('has-code-graph')).toBeInTheDocument()
    })

    it('should pass overlay port only for react-flow renderer', () => {
      render(<CodeMapContainer renderer="react-flow" />)

      expect(screen.getByTestId('has-overlay-port')).toBeInTheDocument()
    })

    it('should not pass overlay port for sigma renderer', () => {
      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.queryByTestId('has-overlay-port')).not.toBeInTheDocument()
    })
  })

  describe('Sigma with file tree only (no full CodeGraph)', () => {
    it('should work with file tree before analysis', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null, // No full CodeGraph yet
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.getByTestId('code-map-component')).toBeInTheDocument()
      expect(screen.getByTestId('renderer')).toHaveTextContent('sigma')
      expect(screen.getByTestId('view')).toHaveTextContent('nexus')
    })

    it('should pass transformed CodeGraph even without full analysis', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer renderer="sigma" />)

      // The transformed CodeGraph should be passed (has-code-graph should exist)
      expect(screen.getByTestId('has-code-graph')).toBeInTheDocument()
    })
  })

  describe('Sigma with full CodeGraph', () => {
    it('should use full CodeGraph when available', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.getByTestId('code-map-component')).toBeInTheDocument()
      expect(screen.getByTestId('has-code-graph')).toBeInTheDocument()
    })

    it('should show Full analysis badge when CodeGraph available in sigma mode', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: mockCodeGraph,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeMapContainer renderer="sigma" />)

      expect(screen.getByText('Full analysis')).toBeInTheDocument()
    })
  })
})
