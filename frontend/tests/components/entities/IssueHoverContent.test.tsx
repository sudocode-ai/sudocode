import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IssueHoverContent } from '@/components/entities/IssueHoverContent'
import type { Issue } from '@/types/api'
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
  deleted_at: null,
  deletion_reason: null,
    ...overrides,
  }) as Execution

describe('IssueHoverContent', () => {
  const mockIssue: Issue = {
    id: 'i-test123',
    uuid: 'uuid-test123',
    title: 'Test Issue Title',
    status: 'in_progress',
    content: 'Test content',
    priority: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const mockExecutions: Execution[] = [
    createMockExecution({ id: 'exec-001', status: 'running' }),
    createMockExecution({ id: 'exec-002', status: 'completed' }),
  ]

  describe('loading state', () => {
    it('should show loading skeleton when isLoading is true', () => {
      render(
        <IssueHoverContent
          issue={undefined}
          executions={[]}
          isLoading={true}
          isError={false}
        />
      )

      // Check for skeleton elements (they have animate-pulse class)
      const skeletons = document.querySelectorAll('.animate-pulse')
      expect(skeletons.length).toBeGreaterThan(0)
    })
  })

  describe('error state', () => {
    it('should show error message when isError is true', () => {
      render(
        <IssueHoverContent
          issue={undefined}
          executions={[]}
          isLoading={false}
          isError={true}
        />
      )

      expect(screen.getByText('Failed to load issue details')).toBeInTheDocument()
    })

    it('should show error message when issue is undefined', () => {
      render(
        <IssueHoverContent
          issue={undefined}
          executions={[]}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('Failed to load issue details')).toBeInTheDocument()
    })
  })

  describe('successful render', () => {
    it('should display issue title', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={[]}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('Test Issue Title')).toBeInTheDocument()
    })

    it('should display issue status', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={[]}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('In Progress')).toBeInTheDocument()
    })

    it('should display priority badge for high priority issues', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={[]}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('P1')).toBeInTheDocument()
    })

    it('should not display priority badge for P4 issues', () => {
      const lowPriorityIssue = { ...mockIssue, priority: 4 }
      render(
        <IssueHoverContent
          issue={lowPriorityIssue}
          executions={[]}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.queryByText('P4')).not.toBeInTheDocument()
    })

    it('should display all status types correctly', () => {
      const statuses = ['open', 'in_progress', 'blocked', 'needs_review', 'closed'] as const

      statuses.forEach((status) => {
        const issueWithStatus = { ...mockIssue, status }
        const { unmount } = render(
          <IssueHoverContent
            issue={issueWithStatus}
            executions={[]}
            isLoading={false}
            isError={false}
          />
        )

        const expectedLabels: Record<string, string> = {
          open: 'Open',
          in_progress: 'In Progress',
          blocked: 'Blocked',
          needs_review: 'Needs Review',
          closed: 'Closed',
        }

        expect(screen.getByText(expectedLabels[status])).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('executions', () => {
    it('should display running executions count', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={mockExecutions}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('1 running execution')).toBeInTheDocument()
    })

    it('should display plural for multiple running executions', () => {
      const multipleRunning: Execution[] = [
        { ...mockExecutions[0], id: 'exec-001' },
        { ...mockExecutions[0], id: 'exec-003' },
      ]

      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={multipleRunning}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('2 running executions')).toBeInTheDocument()
    })

    it('should display recent executions section', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={mockExecutions}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('Recent executions')).toBeInTheDocument()
      expect(screen.getByText('exec-001')).toBeInTheDocument()
      expect(screen.getByText('exec-002')).toBeInTheDocument()
    })

    it('should display execution status badges', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={mockExecutions}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    it('should not show recent executions section when no executions', () => {
      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={[]}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.queryByText('Recent executions')).not.toBeInTheDocument()
    })

    it('should limit displayed executions to 3', () => {
      const manyExecutions: Execution[] = [
        { ...mockExecutions[1], id: 'exec-001' },
        { ...mockExecutions[1], id: 'exec-002' },
        { ...mockExecutions[1], id: 'exec-003' },
        { ...mockExecutions[1], id: 'exec-004' },
      ]

      render(
        <IssueHoverContent
          issue={mockIssue}
          executions={manyExecutions}
          isLoading={false}
          isError={false}
        />
      )

      expect(screen.getByText('exec-001')).toBeInTheDocument()
      expect(screen.getByText('exec-002')).toBeInTheDocument()
      expect(screen.getByText('exec-003')).toBeInTheDocument()
      expect(screen.queryByText('exec-004')).not.toBeInTheDocument()
    })
  })
})
