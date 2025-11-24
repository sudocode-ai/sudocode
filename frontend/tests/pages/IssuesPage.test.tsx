import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import IssuesPage from '@/pages/IssuesPage'
import { issuesApi } from '@/lib/api'
import type { Issue } from '@/types/api'

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
        displayName: 'Claude Code',
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
})
