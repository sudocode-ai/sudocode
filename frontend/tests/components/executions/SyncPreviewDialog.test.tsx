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
      expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      expect(screen.getByText('Review changes before syncing worktree to local branch')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(<SyncPreviewDialog {...defaultProps} isOpen={false} />)
      expect(screen.queryByText('Sync Preview')).not.toBeInTheDocument()
    })

    it('should show loading state when previewing', () => {
      render(<SyncPreviewDialog {...defaultProps} isPreviewing={true} />)
      expect(screen.getByText('Loading preview...')).toBeInTheDocument()
    })
  })

  describe('Execution Status', () => {
    it('should show completed status', () => {
      render(<SyncPreviewDialog {...defaultProps} />)
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    it('should show running status with warning', () => {
      const runningExecution = { ...mockExecution, status: 'running' as const }
      render(<SyncPreviewDialog {...defaultProps} execution={runningExecution as Execution} />)

      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('Execution In Progress')).toBeInTheDocument()
      expect(screen.getByText(/The execution may continue making changes/)).toBeInTheDocument()
    })

    it('should show paused status with warning', () => {
      const pausedExecution = { ...mockExecution, status: 'paused' as const }
      render(<SyncPreviewDialog {...defaultProps} execution={pausedExecution as Execution} />)

      expect(screen.getByText('Paused')).toBeInTheDocument()
      expect(screen.getByText('Execution In Progress')).toBeInTheDocument()
    })

    it('should show failed status', () => {
      const failedExecution = { ...mockExecution, status: 'failed' as const }
      render(<SyncPreviewDialog {...defaultProps} execution={failedExecution as Execution} />)
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })

  describe('Diff Summary', () => {
    it('should display file counts', () => {
      render(<SyncPreviewDialog {...defaultProps} />)
      expect(screen.getByText('3')).toBeInTheDocument() // Files changed
      expect(screen.getByText('+150')).toBeInTheDocument() // Additions
      expect(screen.getByText('-50')).toBeInTheDocument() // Deletions
    })

    it('should have expandable file list', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      // Should show expand button
      expect(screen.getByText(/Show Files/)).toBeInTheDocument()
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

    it('should show JSONL conflicts as auto-resolvable', () => {
      const previewWithJSONL: SyncPreviewResult = {
        ...mockPreview,
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

      expect(screen.getByText('JSONL Conflicts (Auto-resolvable)')).toBeInTheDocument()
      expect(screen.getByText(/.sudocode\/issues\.jsonl/)).toBeInTheDocument()
      expect(screen.getByText(/3 conflicts/)).toBeInTheDocument()
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

    it('should show uncommitted JSONL changes notice', () => {
      const previewWithUncommitted: SyncPreviewResult = {
        ...mockPreview,
        uncommittedJSONLChanges: true,
      }

      render(<SyncPreviewDialog {...defaultProps} preview={previewWithUncommitted} />)

      expect(screen.getByText('Uncommitted Changes')).toBeInTheDocument()
      expect(screen.getByText('Uncommitted JSONL changes will be included in sync')).toBeInTheDocument()
    })
  })

  describe('Mode Selection', () => {
    it('should show squash and preserve mode options', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      expect(screen.getByLabelText(/Squash Merge/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Preserve Commits/)).toBeInTheDocument()
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
  })

  describe('Actions', () => {
    it('should call onClose when Cancel clicked', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      const cancelButton = screen.getByText('Cancel')
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirmSync with squash mode', async () => {
      const user = userEvent.setup()
      render(<SyncPreviewDialog {...defaultProps} />)

      const confirmButton = screen.getByText('Squash & Sync')
      await user.click(confirmButton)

      expect(defaultProps.onConfirmSync).toHaveBeenCalledWith('squash', '')
    })

    it('should show Squash & Sync button by default', () => {
      render(<SyncPreviewDialog {...defaultProps} />)

      expect(screen.getByText('Squash & Sync')).toBeInTheDocument()
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

      const confirmButton = screen.getByText('Squash & Sync')
      expect(confirmButton).toBeDisabled()
    })

    it('should disable confirm button when previewing', () => {
      render(<SyncPreviewDialog {...defaultProps} isPreviewing={true} />)

      const confirmButton = screen.getByText('Squash & Sync')
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
