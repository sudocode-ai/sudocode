import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { IssuePanel } from '@/components/issues/IssuePanel'
import type { Issue } from '@sudocode-ai/types'
import { executionsApi } from '@/lib/api'

// Mock the APIs
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    executionsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      createFollowUp: vi.fn(),
      cancel: vi.fn().mockResolvedValue({}),
      get: vi.fn(),
      prepare: vi.fn().mockResolvedValue({
        renderedPrompt: 'test',
        defaultConfig: { mode: 'worktree', cleanupMode: 'manual' },
        availableBranches: ['main'],
      }),
    },
    relationshipsApi: {
      getForEntity: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
    },
    repositoryApi: {
      getBranches: vi.fn().mockResolvedValue({ branches: ['main'], currentBranch: 'main' }),
      getInfo: vi.fn().mockResolvedValue({ currentBranch: 'main', repoPath: '/test' }),
    },
  }
})

// Mock useWorktrees
vi.mock('@/hooks/useWorktrees', () => ({
  useWorktrees: () => ({
    worktrees: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}))

// Mock useAgents
vi.mock('@/hooks/useAgents', () => ({
  useAgents: () => ({
    agents: [
      { id: 'claude-code', name: 'Claude Code', isImplemented: true },
      { id: 'codex', name: 'Codex', isImplemented: true },
    ],
    loading: false,
  }),
}))

const mockIssue: Issue = {
  id: 'ISSUE-001',
  uuid: 'test-uuid-1',
  title: 'Test Issue',
  content: 'Test content',
  status: 'in_progress',
  priority: 1,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-02T15:30:00Z',
  closed_at: undefined,
}

describe('IssuePanel - Auto-scroll', () => {
  let mockScrollTo: ReturnType<typeof vi.fn>
  let originalScrollTo: typeof Element.prototype.scrollTo

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock scrollTo on HTMLElement.prototype
    originalScrollTo = Element.prototype.scrollTo
    mockScrollTo = vi.fn()
    Element.prototype.scrollTo = mockScrollTo

    // Mock scrollHeight and clientHeight properties
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      value: 1000,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 500,
    })

    // Reset to default empty array for executions
    vi.mocked(executionsApi.list).mockResolvedValue([])
  })

  afterEach(() => {
    // Restore original scrollTo
    Element.prototype.scrollTo = originalScrollTo
  })

  describe('Auto-scroll enablement', () => {
    it('should enable auto-scroll when execution starts running', async () => {
      // Start with a running execution
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load and auto-scroll to trigger
      await waitFor(
        () => {
          expect(mockScrollTo).toHaveBeenCalled()
        },
        { timeout: 3000 }
      )

      // Verify scrollTo was called with smooth behavior
      expect(mockScrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: 'smooth',
        })
      )
    })

    it('should show scroll-to-bottom button when container is scrollable', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait a bit to ensure component is fully rendered - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Get scroll container
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // Make container scrollable
      Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(scrollContainer, 'scrollTop', {
        value: 0,
        writable: true,
        configurable: true,
      })

      // Trigger scroll event to update isScrollable state
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Scroll-to-bottom button should be visible when container is scrollable
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })
    })

    it('should show button based on scrollability, not execution status', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('ISSUE-001')).toBeInTheDocument()
      })

      // Get scroll container
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // Make container scrollable even though execution is completed
      Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(scrollContainer, 'scrollTop', {
        value: 0,
        writable: true,
        configurable: true,
      })

      // Trigger scroll event
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Scroll-to-bottom button should be visible even for completed execution if scrollable
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })
    })
  })

  describe('Manual scroll detection', () => {
    it('should disable auto-scroll when user scrolls up', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Get the scroll container
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // Set initial scrollTop (simulating being at the bottom after auto-scroll)
      let currentScrollTop = 500 // At bottom: scrollHeight (1000) - clientHeight (500) = 500
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
        set: (value) => {
          currentScrollTop = value
        },
      })

      // Trigger initial scroll event to set lastScrollTopRef
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Now simulate user scrolling up
      currentScrollTop = 200
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Scroll up further (scrollTop decreased from 500 to 200, clearly scrolling up)
      currentScrollTop = 100
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Wait for auto-scroll to be disabled and FAB to appear
      await waitFor(
        () => {
          expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it('should re-enable auto-scroll when user scrolls back to bottom', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Get the scroll container
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // Set initial scrollTop (simulating being at the bottom)
      let currentScrollTop = 500
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
        set: (value) => {
          currentScrollTop = value
        },
      })

      // Trigger initial scroll event
      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Simulate user scrolling up
      currentScrollTop = 200
      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Scroll up further
      currentScrollTop = 100
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Wait for FAB to appear
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })

      // Simulate scrolling back down towards bottom
      currentScrollTop = 400
      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Simulate scrolling back to bottom (within 50px threshold)
      currentScrollTop = 460 // scrollHeight (1000) - clientHeight (500) - 40 (within 50px threshold)
      scrollContainer.dispatchEvent(new Event('scroll'))

      // FAB should still be visible when container is scrollable (new behavior)
      // It only disappears when content becomes non-scrollable
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })
    })
  })

  describe('Scroll-to-bottom FAB button', () => {
    it('should show FAB button when auto-scroll is disabled and execution is running', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Get the scroll container and simulate scrolling up
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement

      let currentScrollTop = 500
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
        set: (value) => {
          currentScrollTop = value
        },
      })

      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      currentScrollTop = 200
      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Scroll up further to disable auto-scroll
      currentScrollTop = 100
      scrollContainer.dispatchEvent(new Event('scroll'))

      // FAB button should appear
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })
    })

    it('should show FAB button when container is scrollable, regardless of execution status', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('ISSUE-001')).toBeInTheDocument()
      })

      // Get scroll container and make it scrollable
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]')
      Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        value: 100,
      })
      scrollContainer!.dispatchEvent(new Event('scroll'))

      // FAB button should appear when scrollable, even for completed execution
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })
    })

    it('should scroll to bottom and re-enable auto-scroll when FAB is clicked', async () => {
      const user = userEvent.setup()
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Simulate scrolling up to disable auto-scroll
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement

      let currentScrollTop = 500
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
        set: (value) => {
          currentScrollTop = value
        },
      })

      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      currentScrollTop = 200
      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      currentScrollTop = 100
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Wait for FAB to appear
      const fabButton = await screen.findByTestId('scroll-to-bottom-fab')

      // Clear previous scrollTo calls
      mockScrollTo.mockClear()

      // Click the FAB button
      await user.click(fabButton)

      // Verify scrollTo was called
      await waitFor(() => {
        expect(mockScrollTo).toHaveBeenCalledWith(
          expect.objectContaining({
            behavior: 'smooth',
          })
        )
      })

      // FAB should remain visible as long as container is scrollable (new behavior)
      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-fab')).toBeInTheDocument()
      })
    })
  })

  describe('MutationObserver content changes', () => {
    it('should auto-scroll when content changes are detected during execution', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Clear previous scrollTo calls
      mockScrollTo.mockClear()

      // Simulate content change by adding a new element to the scroll container
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]')
      const newElement = document.createElement('div')
      newElement.textContent = 'New execution output'
      scrollContainer?.appendChild(newElement)

      // Wait for MutationObserver to trigger and auto-scroll to be called
      await waitFor(
        () => {
          expect(mockScrollTo).toHaveBeenCalled()
        },
        { timeout: 500 }
      )
    })

    it('should not auto-scroll when content changes but auto-scroll is disabled', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for execution to load - when running, placeholder is different
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Execution is running/i)).toBeInTheDocument()
      })

      // Simulate scrolling up to disable auto-scroll
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement

      let currentScrollTop = 500
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
        set: (value) => {
          currentScrollTop = value
        },
      })

      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      currentScrollTop = 200
      scrollContainer.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      currentScrollTop = 100
      scrollContainer.dispatchEvent(new Event('scroll'))

      // Wait for FAB to appear (confirms auto-scroll is disabled)
      await screen.findByTestId('scroll-to-bottom-fab')

      // Wait for React effects to fully settle (cleanup old MutationObserver)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // Clear previous scrollTo calls
      mockScrollTo.mockClear()

      // Simulate content change
      const newElement = document.createElement('div')
      newElement.textContent = 'New execution output'
      scrollContainer?.appendChild(newElement)

      // Wait a bit to ensure MutationObserver would have triggered
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Verify scrollTo was NOT called (auto-scroll is disabled)
      expect(mockScrollTo).not.toHaveBeenCalled()
    })

    it('should not auto-scroll when content changes but execution is not running', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      const { container } = renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('ISSUE-001')).toBeInTheDocument()
      })

      // Clear previous scrollTo calls
      mockScrollTo.mockClear()

      // Simulate content change
      const scrollContainer = container.querySelector('[class*="overflow-y-auto"]')
      const newElement = document.createElement('div')
      newElement.textContent = 'New content'
      scrollContainer?.appendChild(newElement)

      // Wait a bit to ensure MutationObserver would have triggered
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Verify scrollTo was NOT called (execution is not running)
      expect(mockScrollTo).not.toHaveBeenCalled()
    })
  })
})
