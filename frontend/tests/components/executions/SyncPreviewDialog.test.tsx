import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncPreviewDialog } from '@/components/executions/SyncPreviewDialog'
import type { Execution, SyncPreviewResult } from '@/types/execution'

describe('SyncPreviewDialog', () => {
  const mockExecution: Partial<Execution> = {
    id: 'exec-123',
    issue_id: 'i-test',
    status: 'completed',
    mode: 'worktree',
    agent_type: 'claude-code',
    model: 'claude-sonnet-4',
    worktree_path: '/path/to/worktree',
  }

  const mockPreview: SyncPreviewResult = {
    canSync: true,
    conflicts: {
      hasConflicts: false,
      codeConflicts: [],
      jsonlConflicts: [],
      totalFiles: 0,
      summary: 'No conflicts',
    },
    diff: {
      files: ['file1.ts', 'file2.ts', 'file3.ts'],
      additions: 150,
      deletions: 50,
    },
    commits: [
      {
        sha: 'abc123def',
        message: 'Add feature implementation',
        author: 'Test Author',
        timestamp: '2024-01-01T00:00:00Z',
      },
      {
        sha: 'def456ghi',
        message: 'Fix bug',
        author: 'Test Author',
        timestamp: '2024-01-02T00:00:00Z',
      },
    ],
    mergeBase: 'base123',
    uncommittedJSONLChanges: false,
    uncommittedChanges: { files: [], additions: 0, deletions: 0 },
    executionStatus: 'completed',
    warnings: [],
  }

  const defaultProps = {
    execution: mockExecution as Execution,
    preview: mockPreview,
    isOpen: true,
    onClose: vi.fn(),
    onConfirmSync: vi.fn(),
    onOpenIDE: vi.fn(),
    isPreviewing: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render dialog when open', () => {
      render(<SyncPreviewDialog {...defaultProps} />)
      expect(screen.getByText('Merge Changes')).toBeInTheDocument()
      expect(screen.getByText('Review changes before syncing worktree')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(<SyncPreviewDialog {...defaultProps} isOpen={false} />)
      expect(screen.queryByText('Merge Changes')).not.toBeInTheDocument()
    })

    it('should show loading state when previewing', () => {
      render(<SyncPreviewDialog {...defaultProps} isPreviewing={true} />)
      expect(screen.getByText('Loading preview...')).toBeInTheDocument()
    })
  })

  describe('Header Summary', () => {
    it('should display file count and diff stats in header', () => {
      render(<SyncPreviewDialog {...defaultProps} />)
      expect(screen.getByText('3 files')).toBeInTheDocument()
      expect(screen.getByText('+150')).toBeInTheDocument()
      expect(screen.getByText('-50')).toBeInTheDocument()
    })

    it('should display commit count in header', () => {
      render(<SyncPreviewDialog {...defaultProps} />)
      expect(screen.getByText('2 commits')).toBeInTheDocument()
    })

    it('should handle singular file count', () => {
      const singleFilePreview: SyncPreviewResult = {
        ...mockPreview,
        diff: { files: ['file1.ts'], additions: 10, deletions: 5 },
      }
      render(<SyncPreviewDialog {...defaultProps} preview={singleFilePreview} />)
      expect(screen.getByText('1 file')).toBeInTheDocument()
    })

    it('should handle singular commit count', () => {
      const singleCommitPreview: SyncPreviewResult = {
        ...mockPreview,
        commits: [mockPreview.commits[0]],
      }
      render(<SyncPreviewDialog {...defaultProps} preview={singleCommitPreview} />)
      expect(screen.getByText('1 commit')).toBeInTheDocument()
    })
  })

  describe('Conflicts', () => {
    it('should show code conflicts with error state', () => {
      const previewWithConflicts: SyncPreviewResult = {
        ...mockPreview,
        canSync: false,
        conflicts: {
          hasConflicts: true,
          codeConflicts: [
            {
              filePath: 'src/conflict.ts',
              conflictType: 'content',
              description: 'Content conflict',
              canAutoResolve: false,
            },
          ],
          jsonlConflicts: [],
          totalFiles: 1,
          summary: '1 code conflict',
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithConflicts} />)

      expect(screen.getByText('Code Conflicts Detected')).toBeInTheDocument()
      expect(screen.getByText(/src\/conflict\.ts/)).toBeInTheDocument()
      expect(screen.getByText('Open Worktree in IDE')).toBeInTheDocument()
    })

    // Note: JSONL conflicts UI was removed - conflicts are now auto-resolved during sync
    it('should allow sync when only JSONL conflicts exist (auto-resolvable)', () => {
      const previewWithJSONL: SyncPreviewResult = {
        ...mockPreview,
        canSync: true, // JSONL conflicts don't block sync
        conflicts: {
          hasConflicts: true,
          codeConflicts: [],
          jsonlConflicts: [
            {
              filePath: '.sudocode/issues.jsonl',
              entityType: 'issue',
              conflictCount: 3,
              canAutoResolve: true,
            },
          ],
          totalFiles: 1,
          summary: '1 JSONL conflict',
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithJSONL} />)

      // Sync button should be enabled since JSONL conflicts are auto-resolved
      const confirmButton = screen.getByText('Squash and Merge')
      expect(confirmButton).not.toBeDisabled()
    })

    it('should show Open in IDE button for code conflicts', () => {
      const previewWithConflicts: SyncPreviewResult = {
        ...mockPreview,
        canSync: false,
        conflicts: {
          hasConflicts: true,
          codeConflicts: [
            {
              filePath: 'src/conflict.ts',
              conflictType: 'content',
              description: 'Content conflict',
              canAutoResolve: false,
            },
          ],
          jsonlConflicts: [],
          totalFiles: 1,
          summary: '1 code conflict',
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithConflicts} />)

      expect(screen.getByText('Open Worktree in IDE')).toBeInTheDocument()
    })
  })

  describe('Warnings', () => {
    it('should display general warnings', () => {
      const previewWithWarnings: SyncPreviewResult = {
        ...mockPreview,
        warnings: ['Warning 1', 'Warning 2'],
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithWarnings} />)

      expect(screen.getByText('Warning 1')).toBeInTheDocument()
      expect(screen.getByText('Warning 2')).toBeInTheDocument()
    })

    it('should show uncommitted changes notice when files exist', () => {
      const previewWithUncommitted: SyncPreviewResult = {
        ...mockPreview,
        uncommittedChanges: {
          files: ['file1.ts', 'file2.ts'],
          additions: 20,
          deletions: 5,
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithUncommitted} />)

      expect(screen.getByText('Uncommitted Changes')).toBeInTheDocument()
      expect(screen.getByText(/2 uncommitted file/)).toBeInTheDocument()
    })
  })

  describe('Mode Selection', () => {
    it('should show all three sync mode options', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      expect(screen.getByLabelText(/Stage changes only/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Squash and merge/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Merge all commits/)).toBeInTheDocument()
    })

    it('should show commit message input in squash mode', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      expect(screen.getByLabelText('Commit Message (Optional)')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Custom commit message...')).toBeInTheDocument()
    })

    it('should show commit message input by default', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      expect(screen.getByLabelText('Commit Message (Optional)')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Custom commit message...')).toBeInTheDocument()
    })

    it('should hide commit message input when stage mode selected', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      // Select stage mode
      await user.click(screen.getByLabelText(/Stage changes only/))

      // Commit message input should not be visible
      expect(screen.queryByLabelText('Commit Message (Optional)')).not.toBeInTheDocument()
    })

    it('should disable squash and preserve options when there are no commits', () => {
      const previewWithNoCommits: SyncPreviewResult = {
        ...mockPreview,
        commits: [],
        uncommittedChanges: {
          files: ['file1.ts'],
          additions: 10,
          deletions: 5,
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithNoCommits} />)

      // Squash and preserve radio buttons should be disabled
      const squashRadio = screen.getByRole('radio', { name: /Squash and merge/ })
      const preserveRadio = screen.getByRole('radio', { name: /Merge all commits/ })
      const stageRadio = screen.getByRole('radio', { name: /Stage changes only/ })

      expect(squashRadio).toBeDisabled()
      expect(preserveRadio).toBeDisabled()
      expect(stageRadio).not.toBeDisabled()
    })

    it('should auto-select stage mode when there are no commits', () => {
      const previewWithNoCommits: SyncPreviewResult = {
        ...mockPreview,
        commits: [],
        uncommittedChanges: {
          files: ['file1.ts'],
          additions: 10,
          deletions: 5,
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithNoCommits} />)

      // Stage radio should be checked (auto-selected)
      const stageRadio = screen.getByRole('radio', { name: /Stage changes only/ })
      expect(stageRadio).toBeChecked()

      // Button text should reflect stage mode
      expect(screen.getByText('Stage Changes')).toBeInTheDocument()
    })

    it('should show "Requires committed changes" message when there are no commits', () => {
      const previewWithNoCommits: SyncPreviewResult = {
        ...mockPreview,
        commits: [],
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithNoCommits} />)

      // Should show the helper text for both disabled options
      const requiresCommitsMessages = screen.getAllByText('Requires committed changes')
      expect(requiresCommitsMessages).toHaveLength(2) // One for squash, one for preserve
    })

    it('should have include uncommitted checkbox checked by default in stage mode', async () => {
      const user = userEvent.setup()
      const previewWithUncommitted: SyncPreviewResult = {
        ...mockPreview,
        uncommittedChanges: {
          files: ['file1.ts', 'file2.ts'],
          additions: 20,
          deletions: 5,
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithUncommitted} />)

      // Select stage mode to reveal the checkbox
      await user.click(screen.getByLabelText(/Stage changes only/))

      // The checkbox should be checked by default
      const includeUncommittedCheckbox = screen.getByRole('checkbox', {
        name: /Include uncommitted changes/,
      })
      expect(includeUncommittedCheckbox).toBeChecked()
    })

    it('should allow unchecking include uncommitted checkbox', async () => {
      const user = userEvent.setup()
      const previewWithUncommitted: SyncPreviewResult = {
        ...mockPreview,
        uncommittedChanges: {
          files: ['file1.ts'],
          additions: 10,
          deletions: 5,
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithUncommitted} />)

      // Select stage mode
      await user.click(screen.getByLabelText(/Stage changes only/))

      // Uncheck the checkbox
      const includeUncommittedCheckbox = screen.getByRole('checkbox', {
        name: /Include uncommitted changes/,
      })
      await user.click(includeUncommittedCheckbox)

      expect(includeUncommittedCheckbox).not.toBeChecked()

      // Confirm sync and verify the option is false
      await user.click(screen.getByText('Stage Changes'))
      expect(defaultProps.onConfirmSync).toHaveBeenCalledWith('stage', {
        commitMessage: undefined,
        includeUncommitted: false,
      })
    })
  })

  describe('Actions', () => {
    it('should call onClose when Cancel clicked', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      const cancelButton = screen.getByText('Cancel')
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirmSync with squash mode and options', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      // Default is squash mode, just click the confirm button
      const confirmButton = screen.getByText('Squash and Merge')
      await user.click(confirmButton)

      expect(defaultProps.onConfirmSync).toHaveBeenCalledWith('squash', {
        commitMessage: '',
        includeUncommitted: undefined,
      })
    })

    it('should show Squash and Merge button by default', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      expect(screen.getByText('Squash and Merge')).toBeInTheDocument()
    })

    it('should show Stage Changes button when stage mode selected', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      await user.click(screen.getByLabelText(/Stage changes only/))

      expect(screen.getByText('Stage Changes')).toBeInTheDocument()
    })

    it('should call onConfirmSync with stage mode and options (includeUncommitted defaults to true)', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      await user.click(screen.getByLabelText(/Stage changes only/))
      await user.click(screen.getByText('Stage Changes'))

      expect(defaultProps.onConfirmSync).toHaveBeenCalledWith('stage', {
        commitMessage: undefined,
        includeUncommitted: true,
        overrideLocalChanges: false,
      })
    })

    it('should disable confirm button when code conflicts exist', () => {
      const previewWithConflicts: SyncPreviewResult = {
        ...mockPreview,
        canSync: false,
        conflicts: {
          hasConflicts: true,
          codeConflicts: [
            {
              filePath: 'src/conflict.ts',
              conflictType: 'content',
              description: 'Content conflict',
              canAutoResolve: false,
            },
          ],
          jsonlConflicts: [],
          totalFiles: 1,
          summary: '1 code conflict',
        },
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithConflicts} />)

      const confirmButton = screen.getByText('Squash and Merge')
      expect(confirmButton).toBeDisabled()
    })

    it('should disable confirm button when previewing', () => {
      render(<SyncPreviewDialog {...defaultProps} isPreviewing={true} />)

      const confirmButton = screen.getByText('Squash and Merge')
      expect(confirmButton).toBeDisabled()
    })
  })

  describe('Commit History', () => {
    it('should have commits in preview data', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      // Commits are in the preview data
      expect(defaultProps.preview?.commits.length).toBe(2)
      expect(defaultProps.preview?.commits[0].message).toBe('Add feature implementation')
    })
  })
})
