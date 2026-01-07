import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { forwardRef, useImperativeHandle } from 'react'
import CodeVizPage from '@/pages/CodeVizPage'

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

// Mock CodeMapContainer
const mockHighlightFile = vi.fn().mockReturnValue('highlight-123')
const mockRemoveHighlight = vi.fn()
const mockGetAgentColor = vi.fn().mockReturnValue('#ff0000')

vi.mock('@/components/codeviz/CodeMapContainer', () => ({
  CodeMapContainer: forwardRef(function MockCodeMapContainer(
    { selectedExecutionId, onExecutionSelect }: { selectedExecutionId?: string | null; onExecutionSelect?: (id: string | null) => void },
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
})
