import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// Mock ThemeContext
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}))

// Mock codeviz/browser
vi.mock('codeviz/browser', () => ({
  CodeMapComponent: ({ codeMap, overlayPort }: { codeMap: any; overlayPort?: any }) => (
    <div data-testid="code-map-component">
      <span data-testid="file-count">{codeMap?.files?.length ?? 0}</span>
      {overlayPort && <span data-testid="has-overlay-port">true</span>}
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
  detectLanguage: (ext: string) => ext === 'ts' ? 'typescript' : 'unknown',
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
      highlightFile: vi.fn(),
      removeHighlight: vi.fn(),
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
      })

      render(<CodeMapContainer />)

      expect(screen.getByTestId('code-map-component')).toBeInTheDocument()
    })

    it('should show "Analyze for symbols" button', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Analyze for symbols')).toBeInTheDocument()
    })

    it('should call triggerAnalysis when button clicked', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        fileTree: mockFileTree,
        isLoading: false,
        isAnalyzing: false,
        analysisProgress: null,
        error: null,
        triggerAnalysis: mockTriggerAnalysis,
      })

      render(<CodeMapContainer />)

      fireEvent.click(screen.getByText('Analyze for symbols'))

      expect(mockTriggerAnalysis).toHaveBeenCalledTimes(1)
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
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Analyzing: 50/100 files (50%)')).toBeInTheDocument()
      expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    })

    it('should show 0% when total is 0', () => {
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
      })

      render(<CodeMapContainer />)

      expect(screen.getByText('Analyzing: 0/0 files (0%)')).toBeInTheDocument()
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
      })

      render(<CodeMapContainer />)

      expect(mockUseActiveExecutions).toHaveBeenCalled()
    })
  })
})
