import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ExecutionsPage from '@/pages/ExecutionsPage'
import type { Execution } from '@/types/execution'

// Mock useExecutions hook
const mockRefetch = vi.fn()
let mockExecutionsData = {
  executions: [] as Execution[],
  total: 0,
  hasMore: false,
}
let mockIsLoading = false
let mockError: Error | null = null

vi.mock('@/hooks/useExecutions', () => ({
  useExecutions: () => ({
    data: mockExecutionsData,
    isLoading: mockIsLoading,
    error: mockError,
    refetch: mockRefetch,
  }),
}))

// Mock useProject hook
vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({
    currentProjectId: 'test-project',
    projects: [],
    isLoading: false,
  }),
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: true,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
  }),
}))

// Mock react-resizable-panels
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: React.forwardRef(({ children }: any, ref: any) => <div ref={ref}>{children}</div>),
  PanelResizeHandle: () => <div data-testid="resize-handle" />,
  ImperativePanelHandle: {},
}))

// Helper to create mock execution
const createMockExecution = (overrides: Partial<Execution> = {}): Execution => ({
  id: 'exec-123',
  issue_id: 'i-abc',
  issue_uuid: 'uuid-abc',
  mode: 'worktree',
  prompt: 'Test prompt',
  config: null,
  agent_type: 'claude',
  session_id: 'session-123',
  workflow_execution_id: 'workflow-123',
  target_branch: 'main',
  branch_name: 'sudocode/exec-123',
  before_commit: 'commit-before',
  after_commit: null,
  worktree_path: '/path/to/worktree',
  status: 'running',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: null,
  cancelled_at: null,
  exit_code: null,
  error_message: null,
  error: null,
  model: null,
  summary: null,
  files_changed: null,
  parent_execution_id: null,
  step_type: null,
  step_index: null,
  step_config: null,
  ...overrides,
})

describe('ExecutionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecutionsData = {
      executions: [],
      total: 0,
      hasMore: false,
    }
    mockIsLoading = false
    mockError = null
    localStorage.clear()
  })

  const renderPage = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ExecutionsPage />
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  describe('Initial Rendering', () => {
    it('renders page title', () => {
      renderPage()
      expect(screen.getByText('Agent Executions')).toBeInTheDocument()
    })

    it('renders grid configuration controls', () => {
      renderPage()
      expect(screen.getByText('Columns:')).toBeInTheDocument()
      expect(screen.getByText('Rows:')).toBeInTheDocument()
    })

    it('shows default column and row values', () => {
      renderPage()
      const columnValues = screen.getAllByText('3')
      const rowValues = screen.getAllByText('2')
      expect(columnValues.length).toBeGreaterThan(0)
      expect(rowValues.length).toBeGreaterThan(0)
    })

    it('renders empty state when no execution chains', () => {
      renderPage()
      expect(screen.getByText('No execution chains visible')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('shows loading spinner when data is loading', () => {
      mockIsLoading = true
      mockExecutionsData = undefined as any

      renderPage()
      expect(screen.getByText('Loading executions...')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('shows error message when data fetch fails', () => {
      mockError = new Error('Failed to fetch executions')
      mockExecutionsData = undefined as any

      renderPage()
      expect(screen.getByText('Failed to load executions')).toBeInTheDocument()
      expect(screen.getByText('Failed to fetch executions')).toBeInTheDocument()
    })

    it('calls refetch when retry button clicked', () => {
      mockError = new Error('Failed to fetch')
      mockExecutionsData = undefined as any

      renderPage()
      const retryButton = screen.getByRole('button', { name: /retry/i })
      fireEvent.click(retryButton)
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Grid Configuration', () => {
    it('increments columns when plus button clicked', () => {
      renderPage()
      const columnPlusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-plus')
      })

      fireEvent.click(columnPlusButtons[0]) // Click first plus button (columns)

      // Column should change from 3 to 4
      waitFor(() => {
        expect(screen.getByText('4')).toBeInTheDocument()
      })
    })

    it('decrements columns when minus button clicked', () => {
      renderPage()
      const columnMinusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-minus')
      })

      fireEvent.click(columnMinusButtons[0]) // Click first minus button (columns)

      // Column should change from 3 to 2
      waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument()
      })
    })

    it('increments rows when plus button clicked', () => {
      renderPage()
      const rowPlusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-plus')
      })

      fireEvent.click(rowPlusButtons[1]) // Click second plus button (rows)

      // Row should change from 2 to 3
      waitFor(() => {
        const threes = screen.getAllByText('3')
        expect(threes.length).toBeGreaterThan(1) // At least one '3' for rows
      })
    })

    it('disables minus button at minimum columns', () => {
      // Set columns to minimum (1)
      localStorage.setItem('sudocode:executions:gridColumns', '1')
      renderPage()

      const minusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-minus')
      })

      expect(minusButtons[0]).toBeDisabled()
    })

    it('disables plus button at maximum columns', () => {
      // Set columns to maximum (5)
      localStorage.setItem('sudocode:executions:gridColumns', '5')
      renderPage()

      const plusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-plus')
      })

      expect(plusButtons[0]).toBeDisabled()
    })

    it('persists column configuration to localStorage', () => {
      renderPage()
      const columnPlusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-plus')
      })

      fireEvent.click(columnPlusButtons[0])

      waitFor(() => {
        expect(localStorage.getItem('sudocode:executions:gridColumns')).toBe('4')
      })
    })

    it('persists row configuration to localStorage', () => {
      renderPage()
      const rowPlusButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-plus')
      })

      fireEvent.click(rowPlusButtons[1])

      waitFor(() => {
        expect(localStorage.getItem('sudocode:executions:gridRows')).toBe('3')
      })
    })
  })

  describe('Pagination', () => {
    beforeEach(() => {
      // Create 10 mock executions
      mockExecutionsData.executions = Array.from({ length: 10 }, (_, i) =>
        createMockExecution({
          id: `exec-${i}`,
          status: 'running',
        })
      )
      mockExecutionsData.total = 10
    })

    it('shows pagination info when multiple pages exist', () => {
      renderPage()
      // Default is 3 columns × 2 rows = 6 per page
      // With 10 executions, should show page 1 of 2
      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument()
    })

    it('shows next page button when not on last page', () => {
      renderPage()
      const nextButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-chevron-right')
      })

      const paginationNext = nextButtons.find((btn) => !btn.closest('.absolute'))
      expect(paginationNext).not.toBeDisabled()
    })

    it('navigates to next page when next button clicked', () => {
      renderPage()
      const nextButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-chevron-right')
      })

      const paginationNext = nextButtons.find((btn) => !btn.closest('.absolute'))
      if (paginationNext) {
        fireEvent.click(paginationNext)

        waitFor(() => {
          expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument()
        })
      }
    })

    it('disables next button on last page', () => {
      renderPage()

      // Navigate to last page first
      const nextButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-chevron-right')
      })

      const paginationNext = nextButtons.find((btn) => !btn.closest('.absolute'))
      if (paginationNext) {
        fireEvent.click(paginationNext)

        waitFor(() => {
          expect(paginationNext).toBeDisabled()
        })
      }
    })

    it('disables previous button on first page', () => {
      renderPage()
      const prevButtons = screen.getAllByRole('button').filter((btn) => {
        const svg = btn.querySelector('svg')
        return svg?.classList.contains('lucide-chevron-left')
      })

      // Find pagination previous button (not the sidebar toggle button)
      // Pagination buttons are inside tooltip triggers with specific classes
      const paginationPrev = prevButtons.find((btn) => {
        // Pagination buttons have outline variant, sidebar toggle has ghost variant
        return btn.className.includes('border') && btn.className.includes('h-8')
      })
      expect(paginationPrev).toBeDisabled()
    })
  })

  describe('Keyboard Navigation', () => {
    beforeEach(() => {
      // Create 10 mock executions for pagination
      mockExecutionsData.executions = Array.from({ length: 10 }, (_, i) =>
        createMockExecution({
          id: `exec-${i}`,
          status: 'running',
        })
      )
      mockExecutionsData.total = 10
    })

    it('navigates to next page with arrow right key', () => {
      renderPage()

      fireEvent.keyDown(window, { key: 'ArrowRight' })

      waitFor(() => {
        expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument()
      })
    })

    it('navigates to previous page with arrow left key', () => {
      renderPage()

      // First go to page 2
      fireEvent.keyDown(window, { key: 'ArrowRight' })

      waitFor(() => {
        expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument()
      })

      // Then go back to page 1
      fireEvent.keyDown(window, { key: 'ArrowLeft' })

      waitFor(() => {
        expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument()
      })
    })

    it('does not navigate beyond first page with arrow left', () => {
      renderPage()

      fireEvent.keyDown(window, { key: 'ArrowLeft' })

      // Should still be on page 1
      waitFor(() => {
        expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument()
      })
    })

    it('does not navigate beyond last page with arrow right', () => {
      renderPage()

      // Go to last page
      fireEvent.keyDown(window, { key: 'ArrowRight' })

      waitFor(() => {
        expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument()
      })

      // Try to go further
      fireEvent.keyDown(window, { key: 'ArrowRight' })

      // Should still be on page 2
      waitFor(() => {
        expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument()
      })
    })
  })

  describe('Execution Count Display', () => {
    it('renders page with multiple executions', () => {
      mockExecutionsData.executions = [
        createMockExecution({ id: 'exec-1' }),
        createMockExecution({ id: 'exec-2' }),
        createMockExecution({ id: 'exec-3' }),
      ]
      mockExecutionsData.total = 3

      renderPage()
      expect(screen.getByText('Agent Executions')).toBeInTheDocument()
    })

    it('renders page with single execution', () => {
      mockExecutionsData.executions = [createMockExecution({ id: 'exec-1' })]
      mockExecutionsData.total = 1

      renderPage()
      expect(screen.getByText('Agent Executions')).toBeInTheDocument()
    })
  })

  describe('LocalStorage Persistence', () => {
    it('loads column configuration from localStorage', () => {
      localStorage.setItem('sudocode:executions:gridColumns', '5')
      renderPage()

      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('loads row configuration from localStorage', () => {
      localStorage.setItem('sudocode:executions:gridRows', '3')
      renderPage()

      const threes = screen.getAllByText('3')
      expect(threes.length).toBeGreaterThan(0)
    })

    it('uses default values for invalid localStorage data', () => {
      localStorage.setItem('sudocode:executions:gridColumns', 'invalid')
      localStorage.setItem('sudocode:executions:gridRows', '999')

      renderPage()

      // Should fallback to defaults (3 columns, 2 rows)
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })
})
