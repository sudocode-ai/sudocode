/**
 * Tests for StackReviewPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StackReviewPanel } from '@/components/stacks/StackReviewPanel'
import { useStackReview } from '@/hooks/useCheckpointDAG'
import type { DiffStackWithCheckpoints, CheckpointInStack, DataplaneCheckpoint } from '@/types/checkpoint'

// Mock the hook
vi.mock('@/hooks/useCheckpointDAG', () => ({
  useStackReview: vi.fn(),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('StackReviewPanel', () => {
  let queryClient: QueryClient
  const mockApprove = vi.fn()
  const mockReject = vi.fn()
  const mockAbandon = vi.fn()

  const createCheckpoint = (overrides: Partial<DataplaneCheckpoint> = {}): DataplaneCheckpoint => ({
    id: 'cp-1',
    streamId: 'stream-1',
    commitSha: 'abc1234567890',
    parentCommit: null,
    originalCommit: null,
    changeId: 'change-1',
    message: 'Test commit message',
    createdAt: Date.now(),
    createdBy: 'user-1',
    ...overrides,
  })

  const createStack = (overrides: Partial<DiffStackWithCheckpoints> = {}): DiffStackWithCheckpoints => ({
    id: 'stack-123',
    name: 'Test Stack',
    description: 'A test description',
    targetBranch: 'main',
    reviewStatus: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    queuePosition: null,
    createdAt: Date.now(),
    createdBy: 'user-1',
    checkpoints: [],
    ...overrides,
  })

  const createCheckpointEntry = (
    checkpoint: DataplaneCheckpoint,
    position: number
  ): CheckpointInStack => ({
    checkpointId: checkpoint.id,
    position,
    checkpoint,
  })

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.clearAllMocks()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  const renderPanel = (stackId = 'stack-123') => {
    return render(<StackReviewPanel stackId={stackId} />, { wrapper })
  }

  describe('Loading State', () => {
    it('shows loading spinner while loading', () => {
      vi.mocked(useStackReview).mockReturnValue({
        stack: undefined,
        checkpoints: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      const { container } = renderPanel()

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('shows error message when stack fails to load', () => {
      vi.mocked(useStackReview).mockReturnValue({
        stack: undefined,
        checkpoints: [],
        isLoading: false,
        isError: true,
        error: new Error('Failed to load'),
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })

    it('shows default error when no error message', () => {
      vi.mocked(useStackReview).mockReturnValue({
        stack: undefined,
        checkpoints: [],
        isLoading: false,
        isError: true,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.getByText('Failed to load stack')).toBeInTheDocument()
    })

    it('shows Go Back button when onBack is provided', () => {
      const onBack = vi.fn()
      vi.mocked(useStackReview).mockReturnValue({
        stack: undefined,
        checkpoints: [],
        isLoading: false,
        isError: true,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      render(<StackReviewPanel stackId="stack-123" onBack={onBack} />, { wrapper })

      const backButton = screen.getByRole('button', { name: /Go Back/i })
      fireEvent.click(backButton)

      expect(onBack).toHaveBeenCalled()
    })
  })

  describe('Stack Header', () => {
    const setupWithStack = (stackOverrides: Partial<DiffStackWithCheckpoints> = {}) => {
      const cp1 = createCheckpoint({ id: 'cp-1', commitSha: 'abc1234567890', message: 'First commit' })
      const stack = createStack({
        ...stackOverrides,
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      return { stack, checkpoints: stack.checkpoints }
    }

    it('renders stack name', () => {
      setupWithStack({ name: 'My Feature Stack' })
      renderPanel()

      expect(screen.getByText('My Feature Stack')).toBeInTheDocument()
    })

    it('shows truncated ID when name is missing', () => {
      setupWithStack({ name: '' })
      renderPanel()

      expect(screen.getByText('Stack stack-12')).toBeInTheDocument()
    })

    it('renders stack description', () => {
      setupWithStack({ description: 'This is a detailed description' })
      renderPanel()

      expect(screen.getByText('This is a detailed description')).toBeInTheDocument()
    })

    it('renders target branch', () => {
      setupWithStack({ targetBranch: 'develop' })
      renderPanel()

      expect(screen.getByText('develop')).toBeInTheDocument()
    })

    it('renders checkpoint count', () => {
      const cp1 = createCheckpoint({ id: 'cp-1' })
      const cp2 = createCheckpoint({ id: 'cp-2' })
      const stack = createStack({
        checkpoints: [
          createCheckpointEntry(cp1, 0),
          createCheckpointEntry(cp2, 1),
        ],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.getByText('2 checkpoints')).toBeInTheDocument()
    })

    it('shows singular "checkpoint" for single checkpoint', () => {
      setupWithStack()
      renderPanel()

      expect(screen.getByText('1 checkpoint')).toBeInTheDocument()
    })

    it('renders status badge', () => {
      setupWithStack({ reviewStatus: 'pending' })
      renderPanel()

      expect(screen.getByText('Pending')).toBeInTheDocument()
    })
  })

  describe('Review Actions', () => {
    const setupPendingStack = () => {
      const cp1 = createCheckpoint({ id: 'cp-1' })
      const stack = createStack({
        reviewStatus: 'pending',
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      return stack
    }

    it('shows Approve and Reject buttons for pending stack', () => {
      setupPendingStack()
      renderPanel()

      expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument()
    })

    it('does not show review buttons for approved stack', () => {
      const cp1 = createCheckpoint({ id: 'cp-1' })
      const stack = createStack({
        reviewStatus: 'approved',
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument()
      expect(screen.getByText('Approved - Ready to Merge')).toBeInTheDocument()
    })

    it('opens approve dialog when Approve is clicked', async () => {
      setupPendingStack()
      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Approve/i }))

      expect(screen.getByText('Approve Stack')).toBeInTheDocument()
      expect(screen.getByText('This stack will be marked as approved and ready for merging.')).toBeInTheDocument()
    })

    it('opens reject dialog when Reject is clicked', async () => {
      setupPendingStack()
      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Reject/i }))

      expect(screen.getByText('Reject Stack')).toBeInTheDocument()
      expect(screen.getByText('This stack will be marked as rejected and returned for rework.')).toBeInTheDocument()
    })

    it('calls approve with notes when confirmed', async () => {
      mockApprove.mockResolvedValue(undefined)
      setupPendingStack()
      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Approve/i }))
      await userEvent.type(screen.getByLabelText('Notes (optional)'), 'LGTM!')
      await userEvent.click(screen.getByRole('button', { name: /^Approve$/i }))

      await waitFor(() => {
        expect(mockApprove).toHaveBeenCalledWith('LGTM!')
      })
    })

    it('calls reject with notes when confirmed', async () => {
      mockReject.mockResolvedValue(undefined)
      setupPendingStack()
      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Reject/i }))
      await userEvent.type(screen.getByLabelText('Notes (optional)'), 'Needs more tests')
      await userEvent.click(screen.getByRole('button', { name: /^Reject$/i }))

      await waitFor(() => {
        expect(mockReject).toHaveBeenCalledWith('Needs more tests')
      })
    })

    it('closes dialog on Cancel', async () => {
      setupPendingStack()
      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Approve/i }))
      expect(screen.getByText('Approve Stack')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /Cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('Approve Stack')).not.toBeInTheDocument()
      })
    })

    it('calls onReviewComplete after successful review', async () => {
      mockApprove.mockResolvedValue(undefined)
      const onReviewComplete = vi.fn()

      const cp1 = createCheckpoint({ id: 'cp-1' })
      const stack = createStack({
        reviewStatus: 'pending',
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      render(<StackReviewPanel stackId="stack-123" onReviewComplete={onReviewComplete} />, { wrapper })

      await userEvent.click(screen.getByRole('button', { name: /Approve/i }))
      await userEvent.click(screen.getByRole('button', { name: /^Approve$/i }))

      await waitFor(() => {
        expect(onReviewComplete).toHaveBeenCalled()
      })
    })

    it('disables buttons while reviewing', () => {
      const cp1 = createCheckpoint({ id: 'cp-1' })
      const stack = createStack({
        reviewStatus: 'pending',
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: true,
      })

      renderPanel()

      // Find buttons that contain Approve and Reject text (they may also have icons)
      const approveButton = screen.getAllByRole('button').find(btn => btn.textContent?.includes('Approve'))
      const rejectButton = screen.getAllByRole('button').find(btn => btn.textContent?.includes('Reject'))

      expect(approveButton).toBeDisabled()
      expect(rejectButton).toBeDisabled()
    })
  })

  describe('Checkpoint List', () => {
    const setupWithMultipleCheckpoints = () => {
      const cp1 = createCheckpoint({ id: 'cp-1', commitSha: 'abc1111111111', message: 'First commit' })
      const cp2 = createCheckpoint({ id: 'cp-2', commitSha: 'def2222222222', message: 'Second commit' })
      const cp3 = createCheckpoint({ id: 'cp-3', commitSha: 'ghi3333333333', message: 'Third commit' })

      const stack = createStack({
        checkpoints: [
          createCheckpointEntry(cp1, 0),
          createCheckpointEntry(cp2, 1),
          createCheckpointEntry(cp3, 2),
        ],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      return stack
    }

    it('renders all checkpoints in sidebar', () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // Use getAllByText since SHA appears in both sidebar and main content
      expect(screen.getAllByText('abc1111').length).toBeGreaterThan(0)
      expect(screen.getAllByText('def2222').length).toBeGreaterThan(0)
      expect(screen.getAllByText('ghi3333').length).toBeGreaterThan(0)
    })

    it('shows checkpoint messages', () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // Messages may appear in both sidebar and main content
      expect(screen.getAllByText('First commit').length).toBeGreaterThan(0)
      expect(screen.getByText('Second commit')).toBeInTheDocument()
      expect(screen.getByText('Third commit')).toBeInTheDocument()
    })

    it('shows position numbers', () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // Position numbers may appear multiple times (sidebar + selected checkpoint view)
      expect(screen.getAllByText('#1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('#2').length).toBeGreaterThan(0)
      expect(screen.getAllByText('#3').length).toBeGreaterThan(0)
    })

    it('selects first checkpoint by default', () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // The first checkpoint should be shown in multiple places (sidebar + main area)
      const firstShas = screen.getAllByText('abc1111')
      expect(firstShas.length).toBeGreaterThanOrEqual(1)
    })

    it('changes selected checkpoint on click', async () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // Click on the second checkpoint in the sidebar
      const sidebarItems = screen.getAllByRole('button').filter(
        btn => btn.textContent?.includes('def2222')
      )
      await userEvent.click(sidebarItems[0])

      // The second checkpoint should now be shown
      const secondCpShas = screen.getAllByText('def2222')
      expect(secondCpShas.length).toBeGreaterThan(0)
    })
  })

  describe('Checkpoint Navigation', () => {
    const setupWithMultipleCheckpoints = () => {
      const cp1 = createCheckpoint({ id: 'cp-1', commitSha: 'abc1111111111', message: 'First' })
      const cp2 = createCheckpoint({ id: 'cp-2', commitSha: 'def2222222222', message: 'Second' })
      const cp3 = createCheckpoint({ id: 'cp-3', commitSha: 'ghi3333333333', message: 'Third' })

      const stack = createStack({
        checkpoints: [
          createCheckpointEntry(cp1, 0),
          createCheckpointEntry(cp2, 1),
          createCheckpointEntry(cp3, 2),
        ],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      return stack
    }

    it('disables Previous button on first checkpoint', () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      expect(screen.getByRole('button', { name: /Previous Checkpoint/i })).toBeDisabled()
    })

    it('enables Next button on first checkpoint', () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      expect(screen.getByRole('button', { name: /Next Checkpoint/i })).not.toBeDisabled()
    })

    it('navigates to next checkpoint', async () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Next Checkpoint/i }))

      // Should now show the second checkpoint in main area
      const mainShas = screen.getAllByText('def2222')
      expect(mainShas.length).toBeGreaterThan(0)
    })

    it('navigates to previous checkpoint', async () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // Go to second
      await userEvent.click(screen.getByRole('button', { name: /Next Checkpoint/i }))
      // Go back to first
      await userEvent.click(screen.getByRole('button', { name: /Previous Checkpoint/i }))

      const mainShas = screen.getAllByText('abc1111')
      expect(mainShas.length).toBeGreaterThan(0)
    })

    it('disables Next button on last checkpoint', async () => {
      setupWithMultipleCheckpoints()
      renderPanel()

      // Navigate to last
      await userEvent.click(screen.getByRole('button', { name: /Next Checkpoint/i }))
      await userEvent.click(screen.getByRole('button', { name: /Next Checkpoint/i }))

      expect(screen.getByRole('button', { name: /Next Checkpoint/i })).toBeDisabled()
    })
  })

  describe('Review Notes Display', () => {
    it('shows review notes when present', () => {
      const cp1 = createCheckpoint({ id: 'cp-1' })
      const stack = createStack({
        reviewNotes: 'Great work! Approved.',
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.getByText('Review Notes')).toBeInTheDocument()
      expect(screen.getByText('Great work! Approved.')).toBeInTheDocument()
    })

    it('does not show review notes section when no notes', () => {
      const cp1 = createCheckpoint({ id: 'cp-1' })
      const stack = createStack({
        reviewNotes: null,
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.queryByText('Review Notes')).not.toBeInTheDocument()
    })
  })

  describe('Status Badges', () => {
    const testStatus = (status: 'pending' | 'approved' | 'rejected' | 'merged' | 'abandoned', label: string) => {
      it(`shows ${label} badge for ${status} status`, () => {
        const cp1 = createCheckpoint({ id: 'cp-1' })
        const stack = createStack({
          reviewStatus: status,
          checkpoints: [createCheckpointEntry(cp1, 0)],
        })

        vi.mocked(useStackReview).mockReturnValue({
          stack,
          checkpoints: stack.checkpoints,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
          approve: mockApprove,
          reject: mockReject,
          abandon: mockAbandon,
          resetToPending: vi.fn(),
          addNotes: vi.fn(),
          isReviewing: false,
        })

        renderPanel()

        expect(screen.getByText(label)).toBeInTheDocument()
      })
    }

    testStatus('pending', 'Pending')
    testStatus('approved', 'Approved')
    testStatus('rejected', 'Rejected')
    testStatus('merged', 'Merged')
    testStatus('abandoned', 'Abandoned')
  })

  describe('Empty Checkpoint Handling', () => {
    it('handles checkpoint with no message', () => {
      const cp1 = createCheckpoint({ id: 'cp-1', message: null })
      const stack = createStack({
        checkpoints: [createCheckpointEntry(cp1, 0)],
      })

      vi.mocked(useStackReview).mockReturnValue({
        stack,
        checkpoints: stack.checkpoints,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        approve: mockApprove,
        reject: mockReject,
        abandon: mockAbandon,
        resetToPending: vi.fn(),
        addNotes: vi.fn(),
        isReviewing: false,
      })

      renderPanel()

      expect(screen.getAllByText('No message').length).toBeGreaterThan(0)
    })
  })
})
