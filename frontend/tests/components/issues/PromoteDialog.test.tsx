import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { PromoteDialog } from '@/components/issues/PromoteDialog'
import type { Checkpoint, PromoteResult } from '@/types/execution'

describe('PromoteDialog', () => {
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

  const mockCheckpoint: Checkpoint = {
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
    review_status: 'approved',
  }

  const defaultProps = {
    issue: mockIssue,
    checkpoint: mockCheckpoint,
    isOpen: true,
    onClose: vi.fn(),
    onPromote: vi.fn(),
    isPromoting: false,
    promoteResult: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Closed State', () => {
    it('should not render when isOpen is false', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('Promote to Base Branch')).not.toBeInTheDocument()
    })
  })

  describe('Initial Form State', () => {
    it('should render dialog title and description', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} />)

      expect(screen.getByText('Promote to Base Branch')).toBeInTheDocument()
      expect(screen.getByText(/Merge issue checkpoint to the base branch/)).toBeInTheDocument()
    })

    it('should show merge strategy options', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} />)

      // Use radio role to find the strategy options specifically
      // (avoid matching "Merge" in the default commit message)
      expect(screen.getByRole('radio', { name: /Squash/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /Merge/i })).toBeInTheDocument()
    })

    it('should have squash selected by default', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} />)

      const squashRadio = screen.getByRole('radio', { name: /Squash/i })
      expect(squashRadio).toBeChecked()
    })

    it('should show commit message textarea', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should generate default commit message from issue', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue(`Merge ${mockIssue.id}: ${mockIssue.title}`)
    })
  })

  describe('Promote Action', () => {
    it('should call onPromote with squash strategy', async () => {
      const user = userEvent.setup()
      const onPromote = vi.fn()

      renderWithProviders(<PromoteDialog {...defaultProps} onPromote={onPromote} />)

      const promoteButton = screen.getByRole('button', { name: /Promote/i })
      await user.click(promoteButton)

      expect(onPromote).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'squash',
        })
      )
    })

    it('should call onPromote with merge strategy when selected', async () => {
      const user = userEvent.setup()
      const onPromote = vi.fn()

      renderWithProviders(<PromoteDialog {...defaultProps} onPromote={onPromote} />)

      // Select merge strategy
      const mergeRadio = screen.getByRole('radio', { name: /Merge/i })
      await user.click(mergeRadio)

      const promoteButton = screen.getByRole('button', { name: /Promote/i })
      await user.click(promoteButton)

      expect(onPromote).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'merge',
        })
      )
    })

    it('should call onPromote with custom message', async () => {
      const user = userEvent.setup()
      const onPromote = vi.fn()

      renderWithProviders(<PromoteDialog {...defaultProps} onPromote={onPromote} />)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Custom commit message')

      const promoteButton = screen.getByRole('button', { name: /Promote/i })
      await user.click(promoteButton)

      expect(onPromote).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Custom commit message',
        })
      )
    })

    it('should disable promote button when promoting', () => {
      renderWithProviders(<PromoteDialog {...defaultProps} isPromoting={true} />)

      const promoteButton = screen.getByRole('button', { name: /Promoting/i })
      expect(promoteButton).toBeDisabled()
    })
  })

  describe('Success State', () => {
    it('should show success message', () => {
      const successResult: PromoteResult = {
        success: true,
        merge_commit: 'abc123def',
        files_changed: 5,
        additions: 100,
        deletions: 20,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={successResult} />)

      expect(screen.getByText('Successfully Promoted')).toBeInTheDocument()
    })

    it('should show merge commit info', () => {
      const successResult: PromoteResult = {
        success: true,
        merge_commit: 'abc123def',
        files_changed: 5,
        additions: 100,
        deletions: 20,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={successResult} />)

      // Shows truncated commit SHA
      expect(screen.getByText('abc123d')).toBeInTheDocument()
    })

    it('should show files changed count', () => {
      const successResult: PromoteResult = {
        success: true,
        merge_commit: 'abc123def',
        files_changed: 5,
        additions: 100,
        deletions: 20,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={successResult} />)

      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should show Done button', () => {
      const successResult: PromoteResult = {
        success: true,
        merge_commit: 'abc123def',
        files_changed: 5,
        additions: 100,
        deletions: 20,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={successResult} />)

      expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument()
    })

    it('should call onClose when Done clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const successResult: PromoteResult = {
        success: true,
        merge_commit: 'abc123def',
        files_changed: 5,
        additions: 100,
        deletions: 20,
      }

      renderWithProviders(
        <PromoteDialog {...defaultProps} onClose={onClose} promoteResult={successResult} />
      )

      const doneButton = screen.getByRole('button', { name: /Done/i })
      await user.click(doneButton)

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Blocked State', () => {
    it('should show blocked error', () => {
      const blockedResult: PromoteResult = {
        success: false,
        blocked_by: ['i-parent1', 'i-parent2'],
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={blockedResult} />)

      expect(screen.getByText('Promote Failed')).toBeInTheDocument()
      expect(screen.getByText(/Blocked by unmerged issues/)).toBeInTheDocument()
    })

    it('should show blocked issue IDs', () => {
      const blockedResult: PromoteResult = {
        success: false,
        blocked_by: ['i-parent1', 'i-parent2'],
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={blockedResult} />)

      expect(screen.getByText(/i-parent1/)).toBeInTheDocument()
      expect(screen.getByText(/i-parent2/)).toBeInTheDocument()
    })
  })

  describe('Requires Approval State', () => {
    it('should show approval required message', () => {
      const approvalResult: PromoteResult = {
        success: false,
        requires_approval: true,
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={approvalResult} />)

      expect(screen.getByText('Promote Failed')).toBeInTheDocument()
      expect(screen.getByText(/Approval required/)).toBeInTheDocument()
    })
  })

  describe('Conflict State', () => {
    it('should show conflicts detected message', () => {
      const conflictResult: PromoteResult = {
        success: false,
        conflicts: [
          { id: 'conflict-1', streamId: 'stream-1', path: 'src/file1.ts', detectedAt: Date.now() },
          { id: 'conflict-2', streamId: 'stream-1', path: 'src/file2.ts', detectedAt: Date.now() },
        ],
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={conflictResult} />)

      expect(screen.getByText('Promote Failed')).toBeInTheDocument()
      expect(screen.getByText(/Conflicts detected/)).toBeInTheDocument()
    })

    it('should list conflicting files', () => {
      const conflictResult: PromoteResult = {
        success: false,
        conflicts: [
          { id: 'conflict-1', streamId: 'stream-1', path: 'src/file1.ts', detectedAt: Date.now() },
          { id: 'conflict-2', streamId: 'stream-1', path: 'src/file2.ts', detectedAt: Date.now() },
        ],
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={conflictResult} />)

      expect(screen.getByText(/src\/file1.ts/)).toBeInTheDocument()
      expect(screen.getByText(/src\/file2.ts/)).toBeInTheDocument()
    })
  })

  describe('Generic Error State', () => {
    it('should show error message', () => {
      const errorResult: PromoteResult = {
        success: false,
        error: 'Something went wrong',
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      renderWithProviders(<PromoteDialog {...defaultProps} promoteResult={errorResult} />)

      expect(screen.getByText('Promote Failed')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
  })
})
