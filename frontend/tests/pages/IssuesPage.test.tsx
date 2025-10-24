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
      expect(screen.getByText(/Found 2 issues/)).toBeInTheDocument()
    })
  })

  it('should display issue status badges', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    renderWithProviders(<IssuesPage />)

    await waitFor(() => {
      expect(screen.getByText('open')).toBeInTheDocument()
      expect(screen.getByText('in_progress')).toBeInTheDocument()
    })
  })
})
