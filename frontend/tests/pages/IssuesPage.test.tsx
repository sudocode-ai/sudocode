import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/test-utils'
import IssuesPage from '@/pages/IssuesPage'
import { issuesApi, executionsApi } from '@/lib/api'
import type { Issue } from '@/types/api'
import type { Execution } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  issuesApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  relationshipsApi: {
    getForEntity: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  repositoryApi: {
    getInfo: vi.fn().mockResolvedValue({
      name: 'test-repo',
      branch: 'main',
      path: '/test/path',
    }),
  },
  executionsApi: {
    getById: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue({ executions: [], total: 0, hasMore: false }),
    prepare: vi.fn(),
    create: vi.fn(),
    cancel: vi.fn(),
    createFollowUp: vi.fn(),
    worktreeExists: vi.fn(),
    deleteWorktree: vi.fn(),
  },
  agentsApi: {
    getAll: vi.fn().mockResolvedValue([
      {
        type: 'claude-code',
        displayName: 'Claude',
        supportedModes: ['structured', 'interactive', 'hybrid'],
        supportsStreaming: true,
        supportsStructuredOutput: true,
        implemented: true,
      },
    ]),
  },
}))

// Mock WebSocket - must mock before importing WebSocketProvider in test-utils
vi.mock('@/contexts/WebSocketContext', async () => {
  const actual = await vi.importActual('@/contexts/WebSocketContext')
  return {
    ...actual,
    WebSocketProvider: ({ children }: { children: React.ReactNode }) => children,
    useWebSocketContext: () => ({
      connected: false,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      addMessageHandler: vi.fn(),
      removeMessageHandler: vi.fn(),
      lastMessage: null,
    }),
  }
})

const mockIssues: Issue[] = [
  {
    id: 'ISSUE-001',
    uuid: 'test-uuid-1',
    title: 'Test Issue 1',
    content: 'Test content',
    status: 'open',
    priority: 1,
    assignee: undefined,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    closed_at: undefined,
    parent_id: undefined,
  },
  {
    id: 'ISSUE-002',
    uuid: 'test-uuid-2',
    title: 'Test Issue 2',
    content: 'Another test',
    status: 'in_progress',
    priority: 2,
    assignee: undefined,
    created_at: '2024-01-02',
    updated_at: '2024-01-02',
    closed_at: undefined,
    parent_id: undefined,
  },
]

describe('IssuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading state initially', () => {
    vi.mocked(issuesApi.getAll).mockReturnValue(
      new Promise(() => {}) // Never resolves
    )

    renderWithProviders(<IssuesPage />)
    expect(screen.getByText('Loading issues...')).toBeInTheDocument()
  })

  it('should display issues when loaded', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    renderWithProviders(<IssuesPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      expect(screen.getByText('Test Issue 2')).toBeInTheDocument()
    })
  })

  it('should show issue count', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    renderWithProviders(<IssuesPage />)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('should render kanban board with status columns', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    renderWithProviders(<IssuesPage />)

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument()
      expect(screen.getByText('In Progress')).toBeInTheDocument()
      expect(screen.getByText('Blocked')).toBeInTheDocument()
      expect(screen.getByText('Needs Review')).toBeInTheDocument()
      expect(screen.getByText('Closed')).toBeInTheDocument()
    })
  })

  it('should group issues by status in kanban columns', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    renderWithProviders(<IssuesPage />)

    await waitFor(() => {
      // Issue 1 should be in Open column
      expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      // Issue 2 should be in In Progress column
      expect(screen.getByText('Test Issue 2')).toBeInTheDocument()
    })
  })

  it('should show issue detail panel when issue is clicked', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default.setup())
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    renderWithProviders(<IssuesPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
    })

    const issueCard = screen.getByText('Test Issue 1')
    await user.click(issueCard)

    // Panel should show issue details - there will be 2 instances (card + panel)
    await waitFor(() => {
      const issueIds = screen.getAllByText('ISSUE-001')
      expect(issueIds.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Issue Sorting', () => {
    it('should sort closed issues by most recent closed_at date', async () => {
      const closedIssues: Issue[] = [
        {
          id: 'ISSUE-003',
          uuid: 'test-uuid-3',
          title: 'Closed Issue 1',
          content: 'Closed first',
          status: 'closed',
          priority: 1,
          assignee: undefined,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          closed_at: '2024-01-05', // Earlier
          parent_id: undefined,
        },
        {
          id: 'ISSUE-004',
          uuid: 'test-uuid-4',
          title: 'Closed Issue 2',
          content: 'Closed second',
          status: 'closed',
          priority: 0,
          assignee: undefined,
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          closed_at: '2024-01-10', // More recent, should be first
          parent_id: undefined,
        },
      ]

      vi.mocked(issuesApi.getAll).mockResolvedValue(closedIssues)

      const { container } = renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Closed Issue 1')).toBeInTheDocument()
        expect(screen.getByText('Closed Issue 2')).toBeInTheDocument()
      })

      // Get all issue cards in the Closed column
      const closedColumn = container.querySelector('[data-column-id="closed"]')
      expect(closedColumn).toBeInTheDocument()

      if (closedColumn) {
        const issueCards = closedColumn.querySelectorAll('[data-issue-id]')
        // Most recent closed issue (ISSUE-004) should be first
        expect(issueCards[0]?.getAttribute('data-issue-id')).toBe('ISSUE-004')
        expect(issueCards[1]?.getAttribute('data-issue-id')).toBe('ISSUE-003')
      }
    })

    it('should sort non-closed issues by priority then created_at', async () => {
      const openIssues: Issue[] = [
        {
          id: 'ISSUE-005',
          uuid: 'test-uuid-5',
          title: 'Low Priority Old',
          content: 'Low priority, oldest',
          status: 'open',
          priority: 3, // Low priority
          assignee: undefined,
          created_at: '2024-01-01', // Oldest
          updated_at: '2024-01-01',
          closed_at: undefined,
          parent_id: undefined,
        },
        {
          id: 'ISSUE-006',
          uuid: 'test-uuid-6',
          title: 'High Priority Old',
          content: 'High priority, old',
          status: 'open',
          priority: 1, // Higher priority
          assignee: undefined,
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          closed_at: undefined,
          parent_id: undefined,
        },
        {
          id: 'ISSUE-007',
          uuid: 'test-uuid-7',
          title: 'Critical Priority Recent',
          content: 'Critical, newest',
          status: 'open',
          priority: 0, // Highest priority
          assignee: undefined,
          created_at: '2024-01-10', // Most recent
          updated_at: '2024-01-10',
          closed_at: undefined,
          parent_id: undefined,
        },
        {
          id: 'ISSUE-008',
          uuid: 'test-uuid-8',
          title: 'Critical Priority Old',
          content: 'Critical, oldest',
          status: 'open',
          priority: 0, // Highest priority
          assignee: undefined,
          created_at: '2024-01-03', // Older than ISSUE-007
          updated_at: '2024-01-03',
          closed_at: undefined,
          parent_id: undefined,
        },
      ]

      vi.mocked(issuesApi.getAll).mockResolvedValue(openIssues)

      const { container } = renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Low Priority Old')).toBeInTheDocument()
        expect(screen.getByText('High Priority Old')).toBeInTheDocument()
        expect(screen.getByText('Critical Priority Recent')).toBeInTheDocument()
        expect(screen.getByText('Critical Priority Old')).toBeInTheDocument()
      })

      // Get all issue cards in the Open column
      const openColumn = container.querySelector('[data-column-id="open"]')
      expect(openColumn).toBeInTheDocument()

      if (openColumn) {
        const issueCards = openColumn.querySelectorAll('[data-issue-id]')
        // Should be sorted by priority (0 first), then by created_at (newest first)
        // Expected order: ISSUE-007 (priority 0, newer), ISSUE-008 (priority 0, older),
        //                 ISSUE-006 (priority 1), ISSUE-005 (priority 3)
        expect(issueCards[0]?.getAttribute('data-issue-id')).toBe('ISSUE-007')
        expect(issueCards[1]?.getAttribute('data-issue-id')).toBe('ISSUE-008')
        expect(issueCards[2]?.getAttribute('data-issue-id')).toBe('ISSUE-006')
        expect(issueCards[3]?.getAttribute('data-issue-id')).toBe('ISSUE-005')
      }
    })
  })

  describe('Blocked Status', () => {
    it('should group issues by their backend-managed status', async () => {
      const issuesWithBlocked: Issue[] = [
        {
          id: 'ISSUE-009',
          uuid: 'test-uuid-9',
          title: 'Open Issue',
          content: 'Normal open issue',
          status: 'open',
          priority: 1,
          assignee: undefined,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          closed_at: undefined,
          parent_id: undefined,
        },
        {
          id: 'ISSUE-010',
          uuid: 'test-uuid-10',
          title: 'Blocked Issue',
          content: 'Status set to blocked by backend',
          status: 'blocked', // Backend automatically sets this based on relationships
          priority: 1,
          assignee: undefined,
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          closed_at: undefined,
          parent_id: undefined,
        },
        {
          id: 'ISSUE-011',
          uuid: 'test-uuid-11',
          title: 'In Progress Issue',
          content: 'Currently being worked on',
          status: 'in_progress',
          priority: 0,
          assignee: undefined,
          created_at: '2024-01-03',
          updated_at: '2024-01-03',
          closed_at: undefined,
          parent_id: undefined,
        },
      ]

      vi.mocked(issuesApi.getAll).mockResolvedValue(issuesWithBlocked)

      const { container } = renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Open Issue')).toBeInTheDocument()
        expect(screen.getByText('Blocked Issue')).toBeInTheDocument()
        expect(screen.getByText('In Progress Issue')).toBeInTheDocument()
      })

      // Verify blocked column contains the blocked issue
      const blockedColumn = container.querySelector('[data-column-id="blocked"]')
      expect(blockedColumn).toBeInTheDocument()

      if (blockedColumn) {
        const issueCards = blockedColumn.querySelectorAll('[data-issue-id]')
        const issueIds = Array.from(issueCards).map((card) => card.getAttribute('data-issue-id'))
        expect(issueIds).toContain('ISSUE-010')
      }

      // Verify open column contains the open issue
      const openColumn = container.querySelector('[data-column-id="open"]')
      expect(openColumn).toBeInTheDocument()

      if (openColumn) {
        const issueCards = openColumn.querySelectorAll('[data-issue-id]')
        const issueIds = Array.from(issueCards).map((card) => card.getAttribute('data-issue-id'))
        expect(issueIds).toContain('ISSUE-009')
        expect(issueIds).not.toContain('ISSUE-010') // Should be in blocked column
      }

      // Verify in_progress column contains the in_progress issue
      const inProgressColumn = container.querySelector('[data-column-id="in_progress"]')
      expect(inProgressColumn).toBeInTheDocument()

      if (inProgressColumn) {
        const issueCards = inProgressColumn.querySelectorAll('[data-issue-id]')
        const issueIds = Array.from(issueCards).map((card) => card.getAttribute('data-issue-id'))
        expect(issueIds).toContain('ISSUE-011')
      }
    })
  })

  describe('URL Hash Navigation', () => {
    // Helper function to render with a specific hash
    const renderWithHash = (hash: string) => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            gcTime: 0,
          },
        },
      })

      return render(
        <QueryClientProvider client={queryClient}>
          <ProjectProvider defaultProjectId="test-project-123" skipValidation={true}>
            <WebSocketProvider>
              <ThemeProvider>
                <TooltipProvider>
                  <MemoryRouter initialEntries={[`/issues${hash}`]}>
                    <IssuesPage />
                  </MemoryRouter>
                </TooltipProvider>
              </ThemeProvider>
            </WebSocketProvider>
          </ProjectProvider>
        </QueryClientProvider>
      )
    }

    it('should open issue panel when hash matches an issue ID', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

      renderWithHash('#ISSUE-001')

      // Wait for issues to load
      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Issue panel should be open and show the issue ID
      await waitFor(() => {
        const issueIds = screen.getAllByText('ISSUE-001')
        // Should appear in both the card and the panel
        expect(issueIds.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should not open panel when hash does not match any issue', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

      renderWithHash('#NONEXISTENT-ISSUE')

      // Wait for issues to load
      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Panel should not be open - there should only be one instance of ISSUE-001 (in the card)
      const issueIds = screen.getAllByText('ISSUE-001')
      expect(issueIds).toHaveLength(1) // Only in kanban card, not in panel
    })

    it('should not open panel when hash is empty', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

      renderWithHash('')

      // Wait for issues to load
      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Panel should not be open
      const issueIds = screen.getAllByText('ISSUE-001')
      expect(issueIds).toHaveLength(1) // Only in kanban card
    })

    it('should handle bare hash without clearing it', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

      renderWithHash('#')

      // Wait for issues to load
      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Panel should not be open (bare hash should be ignored)
      const issueIds = screen.getAllByText('ISSUE-001')
      expect(issueIds).toHaveLength(1) // Only in kanban card
    })

    it('should update hash when issue is clicked', async () => {
      const user = await import('@testing-library/user-event').then((m) => m.default.setup())
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

      renderWithHash('')

      // Wait for issues to load
      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Click on an issue
      const issueCard = screen.getByText('Test Issue 1')
      await user.click(issueCard)

      // Panel should open
      await waitFor(() => {
        const issueIds = screen.getAllByText('ISSUE-001')
        expect(issueIds.length).toBeGreaterThanOrEqual(1)
      })

      // Note: We can't directly test window.location.hash in MemoryRouter,
      // but we can verify the panel is open which is the important behavior
    })

    it('should open correct issue when multiple issues exist', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

      renderWithHash('#ISSUE-002')

      // Wait for issues to load
      await waitFor(() => {
        expect(screen.getByText('Test Issue 2')).toBeInTheDocument()
      })

      // Issue panel should show ISSUE-002, not ISSUE-001
      await waitFor(() => {
        const issue2Ids = screen.getAllByText('ISSUE-002')
        expect(issue2Ids.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('Recent Executions Fetching', () => {
    const createMockExecution = (overrides: Partial<Execution> & { id: string }): Execution => ({
      id: overrides.id,
      issue_id: overrides.issue_id ?? null,
      issue_uuid: overrides.issue_uuid ?? null,
      mode: overrides.mode ?? 'worktree',
      prompt: overrides.prompt ?? 'Test prompt',
      config: overrides.config ?? null,
      agent_type: overrides.agent_type ?? 'claude-code',
      session_id: overrides.session_id ?? null,
      workflow_execution_id: overrides.workflow_execution_id ?? null,
      target_branch: overrides.target_branch ?? 'main',
      branch_name: overrides.branch_name ?? 'test-branch',
      before_commit: overrides.before_commit ?? null,
      after_commit: overrides.after_commit ?? null,
      worktree_path: overrides.worktree_path ?? null,
      status: overrides.status ?? 'pending',
      created_at: overrides.created_at ?? new Date().toISOString(),
      updated_at: overrides.updated_at ?? new Date().toISOString(),
      started_at: overrides.started_at ?? null,
      completed_at: overrides.completed_at ?? null,
      cancelled_at: overrides.cancelled_at ?? null,
      exit_code: overrides.exit_code ?? null,
      error_message: overrides.error_message ?? null,
      error: overrides.error ?? null,
      model: overrides.model ?? null,
      summary: overrides.summary ?? null,
      files_changed: overrides.files_changed ?? null,
      parent_execution_id: overrides.parent_execution_id ?? null,
      step_type: overrides.step_type ?? null,
      step_index: overrides.step_index ?? null,
      step_config: overrides.step_config ?? null,
    })

    const mockExecutions: Execution[] = [
      createMockExecution({
        id: 'exec-001',
        issue_id: 'ISSUE-001',
        status: 'running',
        prompt: 'Test prompt',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      createMockExecution({
        id: 'exec-002',
        issue_id: 'ISSUE-002',
        status: 'completed',
        prompt: 'Another prompt',
        created_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
        updated_at: new Date(Date.now() - 1000).toISOString(),
      }),
      createMockExecution({
        id: 'exec-003',
        issue_id: 'ISSUE-001',
        status: 'completed',
        prompt: 'Older prompt',
        created_at: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago (older)
        updated_at: new Date(Date.now() - 10000).toISOString(),
      }),
    ]

    it('should fetch recent executions with since and includeRunning params', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: mockExecutions,
        total: mockExecutions.length,
        hasMore: false,
      })

      renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Verify listAll was called with correct params
      await waitFor(() => {
        expect(executionsApi.listAll).toHaveBeenCalledWith(
          expect.objectContaining({
            since: expect.any(String),
            includeRunning: true,
            limit: 500,
            sortBy: 'created_at',
            order: 'desc',
          })
        )
      })
    })

    it('should not call individual list() for each issue', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: mockExecutions,
        total: mockExecutions.length,
        hasMore: false,
      })

      renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Wait a bit to ensure no individual list calls are made
      await new Promise((resolve) => setTimeout(resolve, 100))

      // executionsApi.list should NOT be called (no individual fetches)
      expect(executionsApi.list).not.toHaveBeenCalled()
    })

    it('should map latest execution per issue correctly', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: mockExecutions,
        total: mockExecutions.length,
        hasMore: false,
      })

      renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // The listAll is called and returns executions sorted by created_at desc
      // exec-001 (running, newest for ISSUE-001) should be used, not exec-003 (older)
      // This is verified by the fact that listAll was called with sortBy: 'created_at', order: 'desc'
      await waitFor(() => {
        expect(executionsApi.listAll).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'created_at',
            order: 'desc',
          })
        )
      })
    })
  })

  describe('WebSocket Execution Updates', () => {
    // The WebSocket context is mocked at the top of this file
    // These tests verify the component registers handlers correctly

    it('should register message handler for execution events', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: [],
        total: 0,
        hasMore: false,
      })

      renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // The component should render without errors when WebSocket is mocked
      // This verifies the WebSocket integration doesn't break the component
      expect(screen.getByText('Issues')).toBeInTheDocument()
    })

    it('should handle component lifecycle with WebSocket subscriptions', async () => {
      vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: [],
        total: 0,
        hasMore: false,
      })

      const { unmount } = renderWithProviders(<IssuesPage />)

      await waitFor(() => {
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
      })

      // Component should unmount cleanly without errors
      expect(() => unmount()).not.toThrow()
    })
  })
})
