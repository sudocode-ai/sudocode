import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { CheckpointSection } from '@/components/issues/CheckpointSection'
import * as useIssueCheckpointsModule from '@/hooks/useIssueCheckpoints'
import * as usePromoteModule from '@/hooks/usePromote'

// Mock the hooks
vi.mock('@/hooks/useIssueCheckpoints', () => ({
  useIssueCheckpoints: vi.fn(),
  useReviewCheckpoint: vi.fn(),
}))

vi.mock('@/hooks/usePromote', () => ({
  usePromote: vi.fn(),
}))

describe('CheckpointSection', () => {
  const mockIssue = {
    id: 'i-test',
    uuid: 'uuid-test',
    title: 'Test Issue',
    content: 'Test description',
    status: 'in_progress' as const,
    priority: 2,
    archived: false,
    archived_at: undefined,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const mockCheckpoint = {
    id: 'cp-1',
    issue_id: 'i-test',
    execution_id: 'exec-1',
    stream_id: 'stream-1',
    commit_sha: 'abc1234567890',
    changed_files: 5,
    additions: 100,
    deletions: 20,
    message: 'Checkpoint message',
    checkpointed_at: '2024-01-01T00:00:00Z',
    review_status: 'pending' as const,
  }

  const mockReviewMutation = {
    mutate: vi.fn(),
    isPending: false,
  }

  const mockPromoteHook = {
    isPromoteDialogOpen: false,
    setIsPromoteDialogOpen: vi.fn(),
    performPromote: vi.fn(),
    promoteResult: null,
    isPromoting: false,
    closePromoteDialog: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
      data: { checkpoints: [], current: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
    } as any)

    vi.mocked(useIssueCheckpointsModule.useReviewCheckpoint).mockReturnValue(mockReviewMutation as any)
    vi.mocked(usePromoteModule.usePromote).mockReturnValue(mockPromoteHook as any)
  })

  describe('Loading State', () => {
    it('should show loading spinner when loading', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('No Checkpoint State', () => {
    it('should show empty state when no checkpoint exists', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [], current: null },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('No checkpoints yet')).toBeInTheDocument()
      expect(
        screen.getByText(/Run an execution and checkpoint it to save changes for review/)
      ).toBeInTheDocument()
    })
  })

  describe('Pending Checkpoint', () => {
    it('should show approve and reject buttons for pending checkpoint', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument()
    })

    it('should show pending badge', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()
    })

    it('should call approve mutation when approve clicked', async () => {
      const user = userEvent.setup()

      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      const approveButton = screen.getByRole('button', { name: /Approve/i })
      await user.click(approveButton)

      expect(mockReviewMutation.mutate).toHaveBeenCalledWith({
        issueId: 'i-test',
        action: 'approve',
      })
    })

    it('should call reject mutation when reject clicked', async () => {
      const user = userEvent.setup()

      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      const rejectButton = screen.getByRole('button', { name: /Reject/i })
      await user.click(rejectButton)

      expect(mockReviewMutation.mutate).toHaveBeenCalledWith({
        issueId: 'i-test',
        action: 'request_changes',
      })
    })

    it('should disable promote button for pending checkpoint', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      const promoteButton = screen.getByRole('button', { name: /Promote/i })
      expect(promoteButton).toBeDisabled()
    })
  })

  describe('Approved Checkpoint', () => {
    const approvedCheckpoint = {
      ...mockCheckpoint,
      review_status: 'approved' as const,
    }

    it('should show approved badge', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [approvedCheckpoint], current: approvedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('Approved')).toBeInTheDocument()
    })

    it('should show reset review button', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [approvedCheckpoint], current: approvedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByRole('button', { name: /Reset Review/i })).toBeInTheDocument()
    })

    it('should enable promote button for approved checkpoint', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [approvedCheckpoint], current: approvedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      const promoteButton = screen.getByRole('button', { name: /Promote/i })
      expect(promoteButton).toBeEnabled()
    })

    it('should open promote dialog when promote clicked', async () => {
      const user = userEvent.setup()

      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [approvedCheckpoint], current: approvedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      const promoteButton = screen.getByRole('button', { name: /Promote/i })
      await user.click(promoteButton)

      expect(mockPromoteHook.setIsPromoteDialogOpen).toHaveBeenCalledWith(true)
    })
  })

  describe('Rejected Checkpoint', () => {
    const rejectedCheckpoint = {
      ...mockCheckpoint,
      review_status: 'rejected' as const,
    }

    it('should show rejected badge', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [rejectedCheckpoint], current: rejectedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('Rejected')).toBeInTheDocument()
    })

    it('should show approve button to allow re-approval', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [rejectedCheckpoint], current: rejectedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument()
    })
  })

  describe('Merged Checkpoint', () => {
    const mergedCheckpoint = {
      ...mockCheckpoint,
      review_status: 'merged' as const,
    }

    it('should show merged badge', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mergedCheckpoint], current: mergedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('Merged')).toBeInTheDocument()
    })

    it('should show Already Merged button text', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mergedCheckpoint], current: mergedCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByRole('button', { name: /Already Merged/i })).toBeInTheDocument()
    })
  })

  describe('Checkpoint Info Display', () => {
    it('should show commit SHA', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      // Commit SHA is truncated to 7 chars
      expect(screen.getByText('abc1234')).toBeInTheDocument()
    })

    it('should show file changes', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText(/5 files/)).toBeInTheDocument()
    })

    it('should show additions and deletions', () => {
      vi.mocked(useIssueCheckpointsModule.useIssueCheckpoints).mockReturnValue({
        data: { checkpoints: [mockCheckpoint], current: mockCheckpoint },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        isRefetching: false,
      } as any)

      renderWithProviders(<CheckpointSection issue={mockIssue} />)

      expect(screen.getByText('+100')).toBeInTheDocument()
      expect(screen.getByText('-20')).toBeInTheDocument()
    })
  })
})
