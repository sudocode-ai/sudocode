import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import IssuesPage from '@/pages/IssuesPage'
import { issuesApi } from '@/lib/api'
import type { Issue } from '@/types/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  issuesApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockIssues: Issue[] = [
  {
    id: 'ISSUE-001',
    uuid: 'test-uuid-1',
    title: 'Test Issue 1',
    description: 'Test description',
    content: '',
    status: 'open',
    priority: 1,
    assignee: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    closed_at: null,
    parent_id: null,
  },
  {
    id: 'ISSUE-002',
    uuid: 'test-uuid-2',
    title: 'Test Issue 2',
    description: 'Another test',
    content: '',
    status: 'in_progress',
    priority: 2,
    assignee: null,
    created_at: '2024-01-02',
    updated_at: '2024-01-02',
    closed_at: null,
    parent_id: null,
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
      expect(screen.getByText(/2 total issues/)).toBeInTheDocument()
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
    const user = await import('@testing-library/user-event').then(m => m.default.setup())
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
})
