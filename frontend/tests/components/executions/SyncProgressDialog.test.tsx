import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncProgressDialog } from '@/components/executions/SyncProgressDialog'
import type { Execution, SyncResult } from '@/types/execution'

describe('SyncProgressDialog', () => {
  const mockExecution: Partial<Execution> = {
    id: 'exec-123',
    issue_id: 'i-test',
    status: 'completed',
    mode: 'worktree',
    agent_type: 'claude-code',
    model: 'claude-sonnet-4',
    worktree_path: '/path/to/worktree',
  }

  const mockSyncResult: SyncResult = {
    success: true,
    finalCommit: 'abc123def456',
    filesChanged: 5,
    conflictsResolved: 2,
    uncommittedJSONLIncluded: false,
    cleanupOffered: true,
  }

  const defaultProps = {
    execution: mockExecution as Execution,
    syncStatus: 'idle' as const,
    syncResult: null,
    syncError: null,
    isOpen: true,
    onClose: vi.fn(),
    onCleanupWorktree: vi.fn(),
    onRetry: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render dialog when open', () => {
      render(<SyncProgressDialog {...defaultProps} syncStatus="syncing" />)
      expect(screen.getByText('Syncing Changes')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(<SyncProgressDialog {...defaultProps} isOpen={false} />)
      expect(screen.queryByText('Syncing Changes')).not.toBeInTheDocument()
    })
  })

  describe('Syncing State', () => {
    it('should show syncing state with progress indicator', () => {
      render(<SyncProgressDialog {...defaultProps} syncStatus="syncing" />)

      expect(screen.getByText('Syncing Changes')).toBeInTheDocument()
      expect(screen.getByText('Please wait while changes are synced to your local branch')).toBeInTheDocument()
      expect(screen.getByText('Syncing changes to local branch...')).toBeInTheDocument()
      expect(screen.getByText('This may take a few moments')).toBeInTheDocument()
    })

    it('should show disabled button while syncing', () => {
      render(<SyncProgressDialog {...defaultProps} syncStatus="syncing" />)

      const button = screen.getByRole('button', { name: /Syncing.../i })
      expect(button).toBeDisabled()
    })

    it('should prevent closing while syncing', async () => {
      const user = userEvent.setup()
      render(<SyncProgressDialog {...defaultProps} syncStatus="syncing" />)

      // Try to close with Escape - should not call onClose
      await user.keyboard('{Escape}')
      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('Success State', () => {
    it('should show success state with summary', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      expect(screen.getByText('Sync Complete')).toBeInTheDocument()
      expect(screen.getByText('Changes have been successfully synced to your local branch')).toBeInTheDocument()
      expect(screen.getByText('Sync Successful')).toBeInTheDocument()
      expect(screen.getByText('All changes have been merged to your local branch')).toBeInTheDocument()
    })

    it('should display summary with correct values', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('Conflicts Resolved')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should show commit SHA when available', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      expect(screen.getByText('Commit:')).toBeInTheDocument()
      expect(screen.getByText('abc123d')).toBeInTheDocument()
    })

    it('should show uncommitted JSONL badge when included', () => {
      const resultWithJSONL: SyncResult = {
        ...mockSyncResult,
        uncommittedJSONLIncluded: true,
      }

      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={resultWithJSONL}
        />
      )

      expect(screen.getByText('Uncommitted JSONL changes included')).toBeInTheDocument()
    })

    it('should show cleanup option when cleanupOffered is true', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      expect(screen.getByText('Clean up worktree after closing')).toBeInTheDocument()
      expect(screen.getByText('Remove worktree directory to free up space. You can recreate it later if needed.')).toBeInTheDocument()
    })

    it('should not show cleanup option when cleanupOffered is false', () => {
      const resultNoCleanup: SyncResult = {
        ...mockSyncResult,
        cleanupOffered: false,
      }

      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={resultNoCleanup}
        />
      )

      expect(screen.queryByText('Clean up worktree after closing')).not.toBeInTheDocument()
    })

    it('should call onClose when Done clicked', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      const doneButton = screen.getByText('Done')
      await user.click(doneButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onCleanupWorktree when checkbox is checked and dialog closed', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      // Check the cleanup checkbox
      const checkbox = screen.getByRole('checkbox', { name: /Clean up worktree after closing/i })
      await user.click(checkbox)

      // Close the dialog
      const doneButton = screen.getByText('Done')
      await user.click(doneButton)

      expect(defaultProps.onCleanupWorktree).toHaveBeenCalledTimes(1)
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onCleanupWorktree when checkbox is unchecked', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      // Don't check the checkbox, just close
      const doneButton = screen.getByText('Done')
      await user.click(doneButton)

      expect(defaultProps.onCleanupWorktree).not.toHaveBeenCalled()
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error State', () => {
    it('should show error state with message', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Code conflicts detected"
        />
      )

      expect(screen.getAllByText('Sync Failed')).toHaveLength(2) // Title and error message
      expect(screen.getByText('An error occurred while syncing changes')).toBeInTheDocument()
      expect(screen.getByText('Code conflicts detected')).toBeInTheDocument()
    })

    it('should show default error message when syncError is null', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError={null}
        />
      )

      expect(screen.getAllByText('Sync Failed')).toHaveLength(2) // Title and error message
      expect(screen.getByText('An unknown error occurred during sync')).toBeInTheDocument()
    })

    it('should show suggested action for code conflicts', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Code conflicts detected in worktree"
        />
      )

      expect(screen.getByText('Suggested Action')).toBeInTheDocument()
      expect(screen.getByText('Open worktree in IDE to resolve conflicts')).toBeInTheDocument()
    })

    it('should show suggested action for uncommitted changes', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Uncommitted changes in working directory"
        />
      )

      expect(screen.getByText('Suggested Action')).toBeInTheDocument()
      expect(screen.getByText('Commit or stash local changes first')).toBeInTheDocument()
    })

    it('should show suggested action for missing worktree', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Worktree directory not found"
        />
      )

      expect(screen.getByText('Suggested Action')).toBeInTheDocument()
      expect(screen.getByText('Worktree was deleted, cannot sync')).toBeInTheDocument()
    })

    it('should show Cancel and Retry buttons for errors', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Some error"
        />
      )

      expect(screen.getByText('Cancel')).toBeInTheDocument()
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('should not show Retry button for WORKTREE_MISSING error', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="WORKTREE_MISSING: Cannot find worktree"
        />
      )

      expect(screen.getByText('Cancel')).toBeInTheDocument()
      expect(screen.queryByText('Retry')).not.toBeInTheDocument()
    })

    it('should call onClose when Cancel clicked', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Some error"
        />
      )

      const cancelButton = screen.getByText('Cancel')
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onRetry when Retry clicked', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Some error"
        />
      )

      const retryButton = screen.getByText('Retry')
      await user.click(retryButton)

      expect(defaultProps.onRetry).toHaveBeenCalledTimes(1)
    })

    it('should not show Retry button when onRetry is not provided', () => {
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Some error"
          onRetry={undefined}
        />
      )

      expect(screen.queryByText('Retry')).not.toBeInTheDocument()
    })
  })

  describe('Dialog Behavior', () => {
    it('should allow closing when in success state', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="success"
          syncResult={mockSyncResult}
        />
      )

      await user.keyboard('{Escape}')
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should allow closing when in error state', async () => {
      const user = userEvent.setup()
      render(
        <SyncProgressDialog
          {...defaultProps}
          syncStatus="error"
          syncError="Some error"
        />
      )

      await user.keyboard('{Escape}')
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })
})
