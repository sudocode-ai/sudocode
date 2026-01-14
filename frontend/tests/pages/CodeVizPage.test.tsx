import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { forwardRef, useImperativeHandle } from 'react'
import CodeVizPage from '@/pages/CodeVizPage'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock the hooks
vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({ currentProjectId: 'proj-001' }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjectById: () => ({ data: { name: 'Test Project' } }),
}))

vi.mock('@/hooks/useRepositoryInfo', () => ({
  useRepositoryInfo: () => ({ data: { branch: 'main' } }),
}))

// Mock useCodeGraph hook
const mockUseCodeGraph = vi.fn()
vi.mock('@/hooks/useCodeGraph', () => ({
  useCodeGraph: () => mockUseCodeGraph(),
}))

// Mock CodeMapContainer
const mockHighlightFile = vi.fn().mockReturnValue('highlight-123')
const mockRemoveHighlight = vi.fn()
const mockGetAgentColor = vi.fn().mockReturnValue('#ff0000')

vi.mock('@/components/codeviz/CodeMapContainer', () => ({
  CodeMapContainer: forwardRef(function MockCodeMapContainer(
    { renderer, selectedExecutionId, onExecutionSelect }: { renderer?: string; selectedExecutionId?: string | null; onExecutionSelect?: (id: string | null) => void },
    ref: React.Ref<any>
  ) {
    // Expose ref methods using useImperativeHandle
    useImperativeHandle(ref, () => ({
      highlightFile: mockHighlightFile,
      removeHighlight: mockRemoveHighlight,
      getAgentColor: mockGetAgentColor,
    }))

    return (
      <div data-testid="code-map-container">
        <div data-testid="renderer-type">{renderer || 'react-flow'}</div>
        <div data-testid="selected-execution">{selectedExecutionId || 'none'}</div>
        <button
          data-testid="select-agent-button"
          onClick={() => onExecutionSelect?.('exec-001')}
        >
          Select Agent
        </button>
      </div>
    )
  }),
}))

// Mock AgentDetailSidebar
vi.mock('@/components/codeviz/AgentDetailSidebar', () => ({
  AgentDetailSidebar: vi.fn(({ executionId, isOpen, onClose, onFileHover, onFileLeave }) => {
    if (!isOpen) return null
    return (
      <div data-testid="agent-detail-sidebar">
        <span data-testid="sidebar-execution-id">{executionId}</span>
        <button data-testid="sidebar-close" onClick={onClose}>
          Close
        </button>
        <button
          data-testid="hover-file"
          onMouseEnter={() => onFileHover?.('src/test.ts')}
          onMouseLeave={() => onFileLeave?.('src/test.ts')}
        >
          Test File
        </button>
      </div>
    )
  }),
  SidebarBackdrop: vi.fn(({ isOpen, onClick }) => {
    if (!isOpen) return null
    return <div data-testid="sidebar-backdrop" onClick={onClick} />
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('CodeVizPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    // Default useCodeGraph mock with watcher functions
    mockUseCodeGraph.mockReturnValue({
      codeGraph: null,
      isAnalyzing: false,
      isWatching: false,
      startWatcher: vi.fn(),
      stopWatcher: vi.fn(),
      recentChanges: [],
    })
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  describe('Rendering', () => {
    it('should render the page with header', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByText('CodeViz')).toBeInTheDocument()
      expect(screen.getByText('Test Project')).toBeInTheDocument()
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    it('should render CodeMapContainer', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByTestId('code-map-container')).toBeInTheDocument()
    })

    it('should not render sidebar when no execution selected', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.queryByTestId('agent-detail-sidebar')).not.toBeInTheDocument()
    })
  })

  describe('Agent Selection', () => {
    it('should open sidebar when agent is selected', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Click to select an agent
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-sidebar')).toBeInTheDocument()
      })

      expect(screen.getByTestId('sidebar-execution-id')).toHaveTextContent('exec-001')
    })

    it('should show backdrop when sidebar is open', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument()
      })
    })

    it('should close sidebar when close button clicked', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Open sidebar
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-sidebar')).toBeInTheDocument()
      })

      // Close sidebar
      fireEvent.click(screen.getByTestId('sidebar-close'))

      await waitFor(() => {
        expect(screen.queryByTestId('agent-detail-sidebar')).not.toBeInTheDocument()
      })
    })

    it('should close sidebar when backdrop clicked', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Open sidebar
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument()
      })

      // Click backdrop to close
      fireEvent.click(screen.getByTestId('sidebar-backdrop'))

      await waitFor(() => {
        expect(screen.queryByTestId('agent-detail-sidebar')).not.toBeInTheDocument()
      })
    })
  })

  describe('File Hover Highlighting', () => {
    it('should call highlightFile when hovering over file in sidebar', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Open sidebar
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-sidebar')).toBeInTheDocument()
      })

      // Hover over file
      fireEvent.mouseEnter(screen.getByTestId('hover-file'))

      expect(mockGetAgentColor).toHaveBeenCalledWith('exec-001')
      expect(mockHighlightFile).toHaveBeenCalledWith('src/test.ts', '#ff0000')
    })

    it('should call removeHighlight when leaving file in sidebar', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Open sidebar
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-sidebar')).toBeInTheDocument()
      })

      // Hover and leave file
      fireEvent.mouseEnter(screen.getByTestId('hover-file'))
      fireEvent.mouseLeave(screen.getByTestId('hover-file'))

      expect(mockRemoveHighlight).toHaveBeenCalledWith('highlight-123')
    })

    it('should clean up highlight when sidebar closes', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Open sidebar
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-sidebar')).toBeInTheDocument()
      })

      // Hover over file (creates highlight)
      fireEvent.mouseEnter(screen.getByTestId('hover-file'))

      // Clear mock to track only cleanup call
      mockRemoveHighlight.mockClear()

      // Close sidebar
      fireEvent.click(screen.getByTestId('sidebar-close'))

      expect(mockRemoveHighlight).toHaveBeenCalledWith('highlight-123')
    })
  })

  describe('Layout', () => {
    it('should adjust map container margin when sidebar opens', async () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Initially no margin
      const mapWrapper = screen.getByTestId('code-map-container').parentElement
      expect(mapWrapper).toHaveStyle({ marginRight: '0px' })

      // Open sidebar
      fireEvent.click(screen.getByTestId('select-agent-button'))

      await waitFor(() => {
        expect(mapWrapper).toHaveStyle({ marginRight: '350px' })
      })
    })
  })

  describe('Renderer Toggle', () => {
    it('should render renderer toggle buttons', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByRole('button', { name: 'Flow' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sigma' })).toBeInTheDocument()
    })

    it('should default to react-flow renderer', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByTestId('renderer-type')).toHaveTextContent('react-flow')
    })

    it('should switch to sigma renderer when Sigma button clicked', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))

      expect(screen.getByTestId('renderer-type')).toHaveTextContent('sigma')
    })

    it('should switch back to react-flow when Flow button clicked', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Switch to sigma
      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))
      expect(screen.getByTestId('renderer-type')).toHaveTextContent('sigma')

      // Switch back to flow
      fireEvent.click(screen.getByRole('button', { name: 'Flow' }))
      expect(screen.getByTestId('renderer-type')).toHaveTextContent('react-flow')
    })

    it('should highlight active renderer button', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      const flowButton = screen.getByRole('button', { name: 'Flow' })
      const sigmaButton = screen.getByRole('button', { name: 'Sigma' })

      // Flow should be active by default (check for exact bg-accent class, not hover:bg-accent)
      expect(flowButton.className).toMatch(/\bbg-accent\b/)
      expect(sigmaButton.className).toContain('text-muted-foreground')

      // Click Sigma
      fireEvent.click(sigmaButton)

      expect(flowButton.className).toContain('text-muted-foreground')
      expect(sigmaButton.className).toMatch(/\bbg-accent\b/)
    })
  })

  describe('Renderer Persistence', () => {
    it('should save renderer selection to localStorage', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))

      expect(localStorageMock.setItem).toHaveBeenCalledWith('codeviz-renderer', 'sigma')
    })

    it('should load renderer selection from localStorage', () => {
      // Set localStorage before rendering
      localStorageMock.getItem.mockReturnValueOnce('sigma')

      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByTestId('renderer-type')).toHaveTextContent('sigma')
    })

    it('should default to react-flow if localStorage is empty', () => {
      localStorageMock.getItem.mockReturnValueOnce(null as unknown as string)

      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByTestId('renderer-type')).toHaveTextContent('react-flow')
    })

    it('should default to react-flow if localStorage has invalid value', () => {
      localStorageMock.getItem.mockReturnValueOnce('invalid-renderer')

      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.getByTestId('renderer-type')).toHaveTextContent('react-flow')
    })
  })

  describe('Edge Count Indicator', () => {
    it('should not show edge count indicator when using react-flow', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      expect(screen.queryByText(/imports\)/)).not.toBeInTheDocument()
    })

    it('should show edge count indicator when using sigma', () => {
      render(<CodeVizPage />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))

      expect(screen.getByText('(0 imports)')).toBeInTheDocument()
    })

    it('should show import count from codeGraph', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: {
          imports: [
            { sourceId: 'f1', targetId: 'f2' },
            { sourceId: 'f2', targetId: 'f3' },
            { sourceId: 'f3', targetId: 'f4' },
          ],
        },
        isAnalyzing: false,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeVizPage />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))

      expect(screen.getByText('(3 imports)')).toBeInTheDocument()
    })

    it('should show analyzing indicator when analysis in progress', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: null,
        isAnalyzing: true,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeVizPage />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))

      expect(screen.getByText('Analyzing...')).toBeInTheDocument()
    })

    it('should hide edge count indicator when switching back to react-flow', () => {
      mockUseCodeGraph.mockReturnValue({
        codeGraph: {
          imports: [{ sourceId: 'f1', targetId: 'f2' }],
        },
        isAnalyzing: false,
        isWatching: false,
        startWatcher: vi.fn(),
        stopWatcher: vi.fn(),
        recentChanges: [],
      })

      render(<CodeVizPage />, { wrapper: createWrapper() })

      // Switch to sigma - should show indicator
      fireEvent.click(screen.getByRole('button', { name: 'Sigma' }))
      expect(screen.getByText('(1 imports)')).toBeInTheDocument()

      // Switch back to flow - should hide indicator
      fireEvent.click(screen.getByRole('button', { name: 'Flow' }))
      expect(screen.queryByText('(1 imports)')).not.toBeInTheDocument()
    })
  })
})
