import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { EntityBadge } from '@/components/entities'
import { issuesApi, executionsApi, specsApi, relationshipsApi } from '@/lib/api'
import type { Issue, Spec } from '@/types/api'
import type { Execution } from '@/types/execution'

// Helper to create partial execution mocks
const createMockExecution = (overrides: Partial<Execution>): Execution =>
  ({
    id: 'exec-default',
    issue_id: 'i-test123',
    issue_uuid: null,
    mode: null,
    prompt: 'Test prompt',
    config: null,
    agent_type: 'claude-code',
    session_id: null,
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'test-branch',
    before_commit: null,
    after_commit: null,
    worktree_path: null,
    status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    started_at: null,
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
    stream_id: null,
    ...overrides,
  }) as Execution

// Mock API modules
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    issuesApi: {
      getById: vi.fn(),
    },
    executionsApi: {
      list: vi.fn(),
    },
    specsApi: {
      getById: vi.fn(),
    },
    relationshipsApi: {
      getForEntity: vi.fn(),
    },
  }
})

describe('EntityBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('issue badge', () => {
    it('should render issue badge with correct variant', () => {
      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      const badge = screen.getByText('i-test123')
      expect(badge).toBeInTheDocument()
      // Check it has issue variant styling (blue)
      expect(badge.closest('div')).toHaveClass('bg-blue-500/10')
    })

    it('should render as a link to issue page', () => {
      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/issues/i-test123')
    })

    it('should display custom displayText when provided', () => {
      renderWithProviders(
        <EntityBadge entityId="i-test123" entityType="issue" displayText="Custom Title" />
      )

      expect(screen.getByText('Custom Title')).toBeInTheDocument()
      expect(screen.queryByText('i-test123')).not.toBeInTheDocument()
    })

    it('should render GitBranch icon for issues', () => {
      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      // GitBranch icon should be present (SVG element)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('spec badge', () => {
    it('should render spec badge with correct variant', () => {
      renderWithProviders(<EntityBadge entityId="s-test123" entityType="spec" />)

      const badge = screen.getByText('s-test123')
      expect(badge).toBeInTheDocument()
      // Check it has spec variant styling (purple)
      expect(badge.closest('div')).toHaveClass('bg-purple-500/10')
    })

    it('should render as a link to spec page', () => {
      renderWithProviders(<EntityBadge entityId="s-test123" entityType="spec" />)

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/specs/s-test123')
    })

    it('should render FileText icon for specs', () => {
      renderWithProviders(<EntityBadge entityId="s-test123" entityType="spec" />)

      // FileText icon should be present (SVG element)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('linkToEntity prop', () => {
    it('should render as link when linkToEntity is true (default)', () => {
      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      expect(screen.getByRole('link')).toBeInTheDocument()
    })

    it('should not render as link when linkToEntity is false', () => {
      renderWithProviders(
        <EntityBadge entityId="i-test123" entityType="issue" linkToEntity={false} />
      )

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('relationshipType prop', () => {
    it('should display relationship type annotation when provided', () => {
      renderWithProviders(
        <EntityBadge entityId="i-test123" entityType="issue" relationshipType="implements" />
      )

      expect(screen.getByText('implements')).toBeInTheDocument()
    })

    it('should not display relationship annotation when not provided', () => {
      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      expect(screen.queryByText('implements')).not.toBeInTheDocument()
    })
  })

  describe('showHoverCard prop', () => {
    const mockIssue: Issue = {
      id: 'i-test123',
      uuid: 'uuid-test',
      title: 'Test Issue',
      status: 'open',
      content: 'Content',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    it('should show hover card on hover when showHoverCard is true (default)', async () => {
      const user = userEvent.setup()

      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue([])

      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      const badge = screen.getByText('i-test123')
      await user.hover(badge)

      // Wait for hover card to appear (after 200ms delay)
      await waitFor(
        () => {
          expect(screen.getByText('Test Issue')).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it('should not show hover card when showHoverCard is false', async () => {
      const user = userEvent.setup()

      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue([])

      renderWithProviders(
        <EntityBadge entityId="i-test123" entityType="issue" showHoverCard={false} />
      )

      const badge = screen.getByText('i-test123')
      await user.hover(badge)

      // Wait a bit and verify hover card doesn't appear
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(screen.queryByText('Test Issue')).not.toBeInTheDocument()
    })
  })

  describe('hover card content - issue', () => {
    const mockIssue: Issue = {
      id: 'i-test123',
      uuid: 'uuid-test',
      title: 'Test Issue Title',
      status: 'in_progress',
      content: 'Content',
      priority: 0,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    const mockExecutions: Execution[] = [createMockExecution({ id: 'exec-001', status: 'running' })]

    it('should display issue details in hover card', async () => {
      const user = userEvent.setup()

      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue(mockExecutions)

      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      const badge = screen.getByText('i-test123')
      await user.hover(badge)

      await waitFor(
        () => {
          expect(screen.getByText('Test Issue Title')).toBeInTheDocument()
        },
        { timeout: 1000 }
      )

      expect(screen.getByText('In Progress')).toBeInTheDocument()
      expect(screen.getByText('P0')).toBeInTheDocument()
      expect(screen.getByText('1 running execution')).toBeInTheDocument()
    })

    it('should show loading state while fetching', async () => {
      const user = userEvent.setup()

      // Create a promise that doesn't resolve immediately
      vi.mocked(issuesApi.getById).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockIssue), 500))
      )
      vi.mocked(executionsApi.list).mockResolvedValue([])

      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      const badge = screen.getByText('i-test123')
      await user.hover(badge)

      // Wait for hover card to open and show loading state
      await waitFor(
        () => {
          const skeletons = document.querySelectorAll('.animate-pulse')
          expect(skeletons.length).toBeGreaterThan(0)
        },
        { timeout: 1000 }
      )
    })
  })

  describe('hover card content - spec', () => {
    const mockSpec: Spec = {
      id: 's-test123',
      uuid: 'uuid-test',
      title: 'Test Spec Title',
      content: 'Content',
      file_path: '/path/to/spec.md',
      priority: 2,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    const mockRelationships = {
      incoming: [
        {
          from_id: 'i-impl001',
          from_uuid: 'uuid-impl001',
          from_type: 'issue' as const,
          to_id: 's-test123',
          to_uuid: 'uuid-test',
          to_type: 'spec' as const,
          relationship_type: 'implements' as const,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
      outgoing: [],
    }

    it('should display spec details in hover card', async () => {
      const user = userEvent.setup()

      vi.mocked(specsApi.getById).mockResolvedValue(mockSpec)
      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue(mockRelationships)

      renderWithProviders(<EntityBadge entityId="s-test123" entityType="spec" />)

      const badge = screen.getByText('s-test123')
      await user.hover(badge)

      await waitFor(
        () => {
          expect(screen.getByText('Test Spec Title')).toBeInTheDocument()
        },
        { timeout: 1000 }
      )

      expect(screen.getByText('Implementing issues')).toBeInTheDocument()
      expect(screen.getByText('i-impl001')).toBeInTheDocument()
    })

    it('should show "No implementing issues" when none exist', async () => {
      const user = userEvent.setup()

      vi.mocked(specsApi.getById).mockResolvedValue(mockSpec)
      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({ incoming: [], outgoing: [] })

      renderWithProviders(<EntityBadge entityId="s-test123" entityType="spec" />)

      const badge = screen.getByText('s-test123')
      await user.hover(badge)

      await waitFor(
        () => {
          expect(screen.getByText('Test Spec Title')).toBeInTheDocument()
        },
        { timeout: 1000 }
      )

      expect(screen.getByText('No implementing issues')).toBeInTheDocument()
    })
  })

  describe('className prop', () => {
    it('should apply custom className to badge', () => {
      renderWithProviders(
        <EntityBadge entityId="i-test123" entityType="issue" className="custom-class" />
      )

      const badge = screen.getByText('i-test123').closest('div')
      expect(badge).toHaveClass('custom-class')
    })
  })

  describe('showTitle prop', () => {
    const mockIssue: Issue = {
      id: 'i-test123',
      uuid: 'uuid-test',
      title: 'Test Issue Title',
      status: 'open',
      content: 'Content',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    const mockSpec: Spec = {
      id: 's-test123',
      uuid: 'uuid-test',
      title: 'Test Spec Title',
      content: 'Content',
      file_path: '/path/to/spec.md',
      priority: 2,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    it('should not fetch title when showTitle is false (default)', () => {
      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" />)

      expect(issuesApi.getById).not.toHaveBeenCalled()
      expect(screen.getByText('i-test123')).toBeInTheDocument()
    })

    it('should fetch and display issue title when showTitle is true', async () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)

      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" showTitle={true} />)

      await waitFor(() => {
        expect(issuesApi.getById).toHaveBeenCalledWith('i-test123')
      })

      await waitFor(() => {
        expect(screen.getByText('i-test123 - Test Issue Title')).toBeInTheDocument()
      })
    })

    it('should fetch and display spec title when showTitle is true', async () => {
      vi.mocked(specsApi.getById).mockResolvedValue(mockSpec)

      renderWithProviders(<EntityBadge entityId="s-test123" entityType="spec" showTitle={true} />)

      await waitFor(() => {
        expect(specsApi.getById).toHaveBeenCalledWith('s-test123')
      })

      await waitFor(() => {
        expect(screen.getByText('s-test123 - Test Spec Title')).toBeInTheDocument()
      })
    })

    it('should truncate long titles with ellipsis', async () => {
      const longTitleIssue: Issue = {
        ...mockIssue,
        title: 'This is a very long title that exceeds the maximum character limit',
      }
      vi.mocked(issuesApi.getById).mockResolvedValue(longTitleIssue)

      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" showTitle={true} />)

      await waitFor(() => {
        // Should truncate at 25 chars (24 + ellipsis)
        expect(screen.getByText('i-test123 - This is a very long titl…')).toBeInTheDocument()
      })
    })

    it('should show loading state while fetching title', async () => {
      // Create a promise that doesn't resolve immediately
      vi.mocked(issuesApi.getById).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockIssue), 500))
      )

      renderWithProviders(<EntityBadge entityId="i-test123" entityType="issue" showTitle={true} />)

      // Should show loading indicator
      expect(screen.getByText('i-test123 - …')).toBeInTheDocument()
    })

    it('should prefer displayText over showTitle', async () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)

      renderWithProviders(
        <EntityBadge
          entityId="i-test123"
          entityType="issue"
          showTitle={true}
          displayText="Custom Display"
        />
      )

      // displayText should take precedence
      expect(screen.getByText('Custom Display')).toBeInTheDocument()
      expect(screen.queryByText('i-test123 - Test Issue Title')).not.toBeInTheDocument()
    })
  })
})
