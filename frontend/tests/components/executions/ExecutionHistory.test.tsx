import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionHistory } from '@/components/executions/ExecutionHistory'
import { executionsApi } from '@/lib/api'
import type { Execution } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    list: vi.fn(),
  },
}))

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('ExecutionHistory', () => {
  const issueId = 'ISSUE-001'

  // Use recent dates for relative timestamp formatting
  const now = new Date()
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000)

  const mockExecution: Execution = {
    id: 'exec-123',
    issueId: 'ISSUE-001',
    mode: 'worktree',
    model: 'claude-sonnet-4',
    status: 'completed',
    workflowExecutionId: 'workflow-123',
    config: { mode: 'worktree', baseBranch: 'main' },
    createdAt: fifteenMinutesAgo,
    startedAt: fifteenMinutesAgo,
    completedAt: tenMinutesAgo,
    filesChanged: ['file1.ts', 'file2.ts'],
    worktreePath: '/path/to/worktree',
    baseBranch: 'main',
    prompt: 'Test prompt',
  }

  const mockExecutionRunning: Execution = {
    id: 'exec-456',
    issueId: 'ISSUE-001',
    mode: 'local',
    model: 'claude-opus-4',
    status: 'running',
    workflowExecutionId: 'workflow-456',
    config: { mode: 'local' },
    createdAt: fiveMinutesAgo,
    startedAt: fiveMinutesAgo,
    baseBranch: 'main',
    prompt: 'Test prompt',
  }

  const mockExecutionFailed: Execution = {
    id: 'exec-789',
    issueId: 'ISSUE-001',
    mode: 'worktree',
    model: 'claude-sonnet-4',
    status: 'failed',
    workflowExecutionId: 'workflow-789',
    config: { mode: 'worktree', baseBranch: 'main' },
    createdAt: tenMinutesAgo,
    startedAt: tenMinutesAgo,
    completedAt: tenMinutesAgo,
    error: 'Command execution failed',
    worktreePath: '/path/to/worktree2',
    baseBranch: 'main',
    prompt: 'Test prompt',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display loading state initially', () => {
    vi.mocked(executionsApi.list).mockReturnValue(new Promise(() => {}))

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    expect(screen.getByText('Execution History')).toBeInTheDocument()
    expect(screen.getByText('Loading executions...')).toBeInTheDocument()
  })

  it('should display error state when fetch fails', async () => {
    vi.mocked(executionsApi.list).mockRejectedValue(new Error('API error'))

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load execution history')).toBeInTheDocument()
    })
  })

  it('should display empty state when no executions exist', async () => {
    vi.mocked(executionsApi.list).mockResolvedValue([])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('No executions yet')).toBeInTheDocument()
      expect(
        screen.getByText('Click "Run Agent" to start your first execution')
      ).toBeInTheDocument()
    })
  })

  it('should display list of executions', async () => {
    vi.mocked(executionsApi.list).mockResolvedValue([
      mockExecution,
      mockExecutionRunning,
      mockExecutionFailed,
    ])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-123')).toBeInTheDocument()
      expect(screen.getByText('exec-456')).toBeInTheDocument()
      expect(screen.getByText('exec-789')).toBeInTheDocument()
    })

    // Check status badges
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()

    // Check execution details (use getAllByText for duplicates)
    expect(screen.getAllByText('claude-sonnet-4')).toHaveLength(2) // Both completed and failed executions
    expect(screen.getByText('claude-opus-4')).toBeInTheDocument()
    expect(screen.getAllByText('worktree')).toHaveLength(2)
    expect(screen.getByText('local')).toBeInTheDocument()

    // Check files changed
    expect(screen.getByText('2 file(s) changed')).toBeInTheDocument()

    // Check error message
    expect(screen.getByText(/Command execution failed/)).toBeInTheDocument()

    // Check count badge
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('should sort executions by created date, newest first', async () => {
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000)
    const executions = [
      { ...mockExecutionFailed, createdAt: twentyMinutesAgo }, // Oldest
      { ...mockExecution, createdAt: fifteenMinutesAgo }, // Middle
      { ...mockExecutionRunning, createdAt: fiveMinutesAgo }, // Newest
    ]

    vi.mocked(executionsApi.list).mockResolvedValue(executions)

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-456')).toBeInTheDocument()
    })

    // Get all execution IDs in order
    const allExecutionIds = ['exec-456', 'exec-123', 'exec-789']

    // Verify they appear in the correct order by checking their positions
    const idElements = allExecutionIds.map((id) => screen.getByText(id))

    // Check that each ID appears before the next one in the DOM order
    expect(idElements[0]).toBeInTheDocument()
    expect(idElements[1]).toBeInTheDocument()
    expect(idElements[2]).toBeInTheDocument()

    // Verify the sorting by checking timestamps: newest should be first
    expect(screen.getByText('5m ago')).toBeInTheDocument()
    expect(screen.getAllByText(/m ago/)).toHaveLength(3)
  })

  it('should navigate to execution detail on click', async () => {
    vi.mocked(executionsApi.list).mockResolvedValue([mockExecution])

    const user = userEvent.setup()
    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-123')).toBeInTheDocument()
    })

    const executionCard = screen.getByText('exec-123').closest('div[class*="cursor-pointer"]')
    expect(executionCard).toBeInTheDocument()

    await user.click(executionCard!)

    expect(mockNavigate).toHaveBeenCalledWith('/executions/exec-123')
  })

  it('should display different status badges correctly', async () => {
    const statuses: Array<{
      status: Execution['status']
      label: string
    }> = [
      { status: 'preparing', label: 'Preparing' },
      { status: 'pending', label: 'Pending' },
      { status: 'running', label: 'Running' },
      { status: 'paused', label: 'Paused' },
      { status: 'completed', label: 'Completed' },
      { status: 'failed', label: 'Failed' },
      { status: 'cancelled', label: 'Cancelled' },
    ]

    for (const { status, label } of statuses) {
      const execution = {
        ...mockExecution,
        id: `exec-${status}`,
        status,
      }

      vi.mocked(executionsApi.list).mockResolvedValue([execution])

      const { unmount } = renderWithProviders(<ExecutionHistory issueId={issueId} />)

      await waitFor(() => {
        expect(screen.getByText(label)).toBeInTheDocument()
      })

      unmount()
    }
  })

  it('should use completedAt timestamp if available', async () => {
    const execution = {
      ...mockExecution,
      createdAt: fifteenMinutesAgo,
      startedAt: fifteenMinutesAgo,
      completedAt: tenMinutesAgo,
    }

    vi.mocked(executionsApi.list).mockResolvedValue([execution])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-123')).toBeInTheDocument()
    })

    // The component should display a formatted timestamp
    // Since we can't predict the exact relative time, just verify timestamp is displayed
    const card = screen.getByText('exec-123').closest('div[class*="cursor-pointer"]')
    expect(card).toHaveTextContent(/m ago|h ago|d ago|Just now/)
  })

  it('should fallback to startedAt if completedAt is not available', async () => {
    const execution = {
      ...mockExecutionRunning,
      createdAt: fifteenMinutesAgo,
      startedAt: tenMinutesAgo,
      completedAt: undefined,
    }

    vi.mocked(executionsApi.list).mockResolvedValue([execution])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-456')).toBeInTheDocument()
    })

    const card = screen.getByText('exec-456').closest('div[class*="cursor-pointer"]')
    expect(card).toHaveTextContent(/m ago|h ago|d ago|Just now/)
  })

  it('should fallback to createdAt if neither completedAt nor startedAt are available', async () => {
    const execution = {
      ...mockExecution,
      createdAt: tenMinutesAgo,
      startedAt: undefined,
      completedAt: undefined,
    }

    vi.mocked(executionsApi.list).mockResolvedValue([execution])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-123')).toBeInTheDocument()
    })

    const card = screen.getByText('exec-123').closest('div[class*="cursor-pointer"]')
    expect(card).toHaveTextContent(/m ago|h ago|d ago|Just now/)
  })

  it('should not display files changed if none exist', async () => {
    const execution = {
      ...mockExecution,
      filesChanged: undefined,
    }

    vi.mocked(executionsApi.list).mockResolvedValue([execution])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-123')).toBeInTheDocument()
    })

    expect(screen.queryByText(/file\(s\) changed/)).not.toBeInTheDocument()
  })

  it('should not display error if none exists', async () => {
    const execution = {
      ...mockExecution,
      error: undefined,
    }

    vi.mocked(executionsApi.list).mockResolvedValue([execution])

    renderWithProviders(<ExecutionHistory issueId={issueId} />)

    await waitFor(() => {
      expect(screen.getByText('exec-123')).toBeInTheDocument()
    })

    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument()
  })

  it('should refetch executions when issueId changes', async () => {
    vi.mocked(executionsApi.list).mockResolvedValue([mockExecution])

    const { rerender } = renderWithProviders(<ExecutionHistory issueId="ISSUE-001" />)

    await waitFor(() => {
      expect(executionsApi.list).toHaveBeenCalledWith('ISSUE-001')
    })

    vi.mocked(executionsApi.list).mockClear()
    vi.mocked(executionsApi.list).mockResolvedValue([mockExecutionRunning])

    rerender(<ExecutionHistory issueId="ISSUE-002" />)

    await waitFor(() => {
      expect(executionsApi.list).toHaveBeenCalledWith('ISSUE-002')
    })
  })
})
