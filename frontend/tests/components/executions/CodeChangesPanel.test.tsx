/**
 * CodeChangesPanel Component Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeChangesPanel } from '@/components/executions/CodeChangesPanel'
import { useExecutionChanges } from '@/hooks/useExecutionChanges'
import type { ExecutionChangesResult } from '@/types/execution'

// Mock the useExecutionChanges hook
vi.mock('@/hooks/useExecutionChanges')

const mockUseExecutionChanges = vi.mocked(useExecutionChanges)

describe('CodeChangesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear localStorage to ensure consistent test behavior
    localStorage.clear()
  })

  describe('Loading State', () => {
    it('should display loading state', () => {
      mockUseExecutionChanges.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(screen.getByText('Loading code changes...')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should display error message when fetch fails', () => {
      mockUseExecutionChanges.mockReturnValue({
        data: null,
        loading: false,
        error: new Error('Network error'),
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(screen.getByText(/Failed to load changes/)).toBeInTheDocument()
      expect(screen.getByText(/Network error/)).toBeInTheDocument()
    })
  })

  describe('Unavailable State', () => {
    it('should display message for missing commits', () => {
      const data: ExecutionChangesResult = {
        available: false,
        reason: 'missing_commits',
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(
        screen.getByText('Changes unavailable: Commit information not captured')
      ).toBeInTheDocument()
    })

    it('should display message for commits not found', () => {
      const data: ExecutionChangesResult = {
        available: false,
        reason: 'commits_not_found',
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(
        screen.getByText('Changes unavailable: Commits no longer exist in repository')
      ).toBeInTheDocument()
    })

    it('should display message for incomplete execution', () => {
      const data: ExecutionChangesResult = {
        available: false,
        reason: 'incomplete_execution',
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(
        screen.getByText('Changes unavailable: Execution did not complete successfully')
      ).toBeInTheDocument()
    })

    it('should display message for git error', () => {
      const data: ExecutionChangesResult = {
        available: false,
        reason: 'git_error',
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(screen.getByText('Changes unavailable: Git operation failed')).toBeInTheDocument()
    })

    it('should display message for worktree deleted with uncommitted changes', () => {
      const data: ExecutionChangesResult = {
        available: false,
        reason: 'worktree_deleted_with_uncommitted_changes',
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(
        screen.getByText('Changes unavailable: Worktree was deleted before changes were committed')
      ).toBeInTheDocument()
    })

    it('should display generic message for unknown reason', () => {
      const data: ExecutionChangesResult = {
        available: false,
        reason: 'unknown_reason' as any,
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      expect(screen.getByText('Changes unavailable: Unknown reason')).toBeInTheDocument()
    })
  })

  describe('Available Changes - File List', () => {
    it('should display file list with status badges', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 20, deletions: 0, status: 'A' },
            { path: 'src/file3.ts', additions: 0, deletions: 15, status: 'D' },
            { path: 'src/file4.ts', additions: 5, deletions: 3, status: 'R' },
          ],
          summary: {
            totalFiles: 4,
            totalAdditions: 35,
            totalDeletions: 23,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand the panel first
      await user.click(screen.getByTitle('Expand code changes'))

      // Check file paths
      expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
      expect(screen.getByText('src/file2.ts')).toBeInTheDocument()
      expect(screen.getByText('src/file3.ts')).toBeInTheDocument()
      expect(screen.getByText('src/file4.ts')).toBeInTheDocument()

      // Check status badges (now single letters)
      expect(screen.getByText('M')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('D')).toBeInTheDocument()
      expect(screen.getByText('R')).toBeInTheDocument()
    })

    it('should display file statistics (additions and deletions)', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand the panel first
      await user.click(screen.getByTitle('Expand code changes'))

      // Check for additions and deletions in the file row (now with + and - prefix)
      const fileRow = screen.getByText('src/file1.ts').closest('div')
      expect(fileRow).toHaveTextContent('+10')
      expect(fileRow).toHaveTextContent('-5')
    })

    it('should not display statistics for files with zero changes', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 0, deletions: 0, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 0,
            totalDeletions: 0,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand the panel first
      await user.click(screen.getByTitle('Expand code changes'))

      // Should not display 0 additions or deletions
      const fileRow = screen.getByText('src/file1.ts').closest('div')
      expect(fileRow).not.toHaveTextContent('+0')
      expect(fileRow).not.toHaveTextContent('-0')
    })
  })

  describe('Available Changes - Summary', () => {
    it('should display summary statistics in collapsed state', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 20, deletions: 8, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 30,
            totalDeletions: 13,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // In collapsed state, shows "2 FILES" as header
      expect(screen.getByText('2 FILES')).toBeInTheDocument()
      expect(screen.getByText('+30')).toBeInTheDocument()
      expect(screen.getByText('-13')).toBeInTheDocument()
    })

    it('should display summary statistics in expanded state', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 20, deletions: 8, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 30,
            totalDeletions: 13,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      await user.click(screen.getByTitle('Expand code changes'))

      // In expanded state, header still shows "2 FILES"
      expect(screen.getByText('2 FILES')).toBeInTheDocument()
      expect(screen.getByText('+30')).toBeInTheDocument()
      expect(screen.getByText('-13')).toBeInTheDocument()
    })

    it('should use singular form for single file', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // In collapsed state (now "1 FILE" as header)
      expect(screen.getByText('1 FILE')).toBeInTheDocument()
    })

    it('should not display summary stats when zero', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 0, deletions: 0, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 0,
            totalDeletions: 0,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should not display +0 or -0 in summary
      const header = screen.getByText('1 FILE').closest('div')
      expect(header).not.toHaveTextContent('+0')
      expect(header).not.toHaveTextContent('-0')
    })
  })

  describe('Uncommitted Changes', () => {
    it('should display uncommitted section for uncommitted changes', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        uncommitted: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: null,
          uncommitted: true,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see the section
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText(/Uncommitted \(1 file\)/)).toBeInTheDocument()
    })


    it('should display committed section for committed changes', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        uncommitted: false,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see the section
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText(/Committed \(1 file\)/)).toBeInTheDocument()
      expect(screen.queryByText(/Uncommitted/)).not.toBeInTheDocument()
    })

    it('should display both committed and uncommitted sections', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        uncommitted: false,
        captured: {
          files: [
            { path: 'src/committed1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/committed2.ts', additions: 3, deletions: 0, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 13,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
        uncommittedSnapshot: {
          files: [{ path: 'src/uncommitted1.ts', additions: 7, deletions: 2, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 7,
            totalDeletions: 2,
          },
          commitRange: null,
          uncommitted: true,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should show combined totals in header
      expect(screen.getByText('3 FILES')).toBeInTheDocument()
      expect(screen.getByText('+20')).toBeInTheDocument()
      expect(screen.getByText('-7')).toBeInTheDocument()

      // Expand to see both sections
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText(/Committed \(2 files\)/)).toBeInTheDocument()
      expect(screen.getByText(/Uncommitted \(1 file\)/)).toBeInTheDocument()

      // Check files are in the right sections
      expect(screen.getByText('src/committed1.ts')).toBeInTheDocument()
      expect(screen.getByText('src/committed2.ts')).toBeInTheDocument()
      expect(screen.getByText('src/uncommitted1.ts')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should not render when no files changed', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [],
          summary: {
            totalFiles: 0,
            totalAdditions: 0,
            totalDeletions: 0,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const { container } = render(<CodeChangesPanel executionId="exec-123" />)

      // Should not render anything
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Null Data', () => {
    it('should not render anything when data is null and not loading', () => {
      mockUseExecutionChanges.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const { container } = render(<CodeChangesPanel executionId="exec-123" />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Deleted Resources', () => {
    it('should display "Branch deleted" badge when branch is deleted', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'deleted-branch',
        branchExists: false,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see the badge (now shows "Branch no longer exists")
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText('Branch no longer exists')).toBeInTheDocument()
    })

    it('should display "Worktree deleted" badge when worktree is deleted', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        worktreeExists: false,
        executionMode: 'worktree',
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see the badge
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText('Worktree deleted')).toBeInTheDocument()
    })

    it('should display both badges when both branch and worktree are deleted', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'deleted-branch',
        branchExists: false,
        worktreeExists: false,
        executionMode: 'worktree',
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see the badges
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText('Branch no longer exists')).toBeInTheDocument()
      expect(screen.getByText('Worktree deleted')).toBeInTheDocument()
    })

    it('should not display "Worktree deleted" for local mode executions', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        worktreeExists: false,
        executionMode: 'local',
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see if the badge appears (it shouldn't)
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.queryByText('Worktree deleted')).not.toBeInTheDocument()
    })

    it('should not display badges when branch and worktree exist', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'feature-branch',
        branchExists: true,
        worktreeExists: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to check
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.queryByText('Branch no longer exists')).not.toBeInTheDocument()
      expect(screen.queryByText('Worktree deleted')).not.toBeInTheDocument()
    })

    it('should display additional commits badge when current state exists', () => {
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'feature-branch',
        branchExists: true,
        additionalCommits: 3,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
        current: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 5, deletions: 0, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 15,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'ghi789' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // In collapsed state, shows "+3 new"
      expect(screen.getByText('+3 new')).toBeInTheDocument()
    })

    it('should use singular form for 1 additional commit', () => {
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'feature-branch',
        additionalCommits: 1,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
        current: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'ghi789' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // In collapsed state, shows "+1 new"
      expect(screen.getByText('+1 new')).toBeInTheDocument()
    })

    it('should show current state info when current state exists', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'feature-branch',
        current: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'ghi789' },
          uncommitted: false,
        },
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand to see current state info
      await user.click(screen.getByTitle('Expand code changes'))

      expect(screen.getByText(/Showing current state of branch: feature-branch/)).toBeInTheDocument()
    })
  })

  describe('Auto-refresh Behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should call refresh on interval when autoRefreshInterval is provided', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      render(<CodeChangesPanel executionId="exec-123" autoRefreshInterval={5000} />)

      // Initially not called
      expect(refreshMock).not.toHaveBeenCalled()

      // After 5 seconds, should be called once
      vi.advanceTimersByTime(5000)
      expect(refreshMock).toHaveBeenCalledTimes(1)

      // After another 5 seconds, should be called again
      vi.advanceTimersByTime(5000)
      expect(refreshMock).toHaveBeenCalledTimes(2)
    })

    it('should not set up interval when autoRefreshInterval is not provided', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Advance time significantly - should not call refresh
      vi.advanceTimersByTime(60000)
      expect(refreshMock).not.toHaveBeenCalled()
    })

    it('should call refresh when execution status changes from running to completed', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      const { rerender } = render(
        <CodeChangesPanel executionId="exec-123" executionStatus="running" />
      )

      // Initially not called
      expect(refreshMock).not.toHaveBeenCalled()

      // Change status to completed
      rerender(<CodeChangesPanel executionId="exec-123" executionStatus="completed" />)

      // Should call refresh
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    it('should call refresh when execution status changes from running to stopped', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      const { rerender } = render(
        <CodeChangesPanel executionId="exec-123" executionStatus="running" />
      )

      expect(refreshMock).not.toHaveBeenCalled()

      // Change status to stopped
      rerender(<CodeChangesPanel executionId="exec-123" executionStatus="stopped" />)

      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    it('should call refresh when execution status changes from running to failed', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      const { rerender } = render(
        <CodeChangesPanel executionId="exec-123" executionStatus="running" />
      )

      expect(refreshMock).not.toHaveBeenCalled()

      // Change status to failed
      rerender(<CodeChangesPanel executionId="exec-123" executionStatus="failed" />)

      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    it('should not call refresh when status changes between non-terminal states', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      const { rerender } = render(
        <CodeChangesPanel executionId="exec-123" executionStatus="pending" />
      )

      // Change status to running (non-terminal to non-terminal)
      rerender(<CodeChangesPanel executionId="exec-123" executionStatus="running" />)

      // Should not call refresh
      expect(refreshMock).not.toHaveBeenCalled()
    })

    it('should not call refresh when status changes between terminal states', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      const { rerender } = render(
        <CodeChangesPanel executionId="exec-123" executionStatus="completed" />
      )

      // Change status to stopped (terminal to terminal)
      rerender(<CodeChangesPanel executionId="exec-123" executionStatus="stopped" />)

      // Should not call refresh
      expect(refreshMock).not.toHaveBeenCalled()
    })

    it('should call refresh when clicking the refresh button', async () => {
      // Temporarily use real timers for this user interaction test
      vi.useRealTimers()

      const user = userEvent.setup()
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      const refreshButton = screen.getByTitle('Refresh changes')
      expect(refreshMock).not.toHaveBeenCalled()

      await user.click(refreshButton)

      expect(refreshMock).toHaveBeenCalledTimes(1)

      // Restore fake timers
      vi.useFakeTimers()
    })

    it('should disable refresh button while loading', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: true,
        error: null,
        refresh: refreshMock,
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      const refreshButton = screen.getByTitle('Refresh changes')
      expect(refreshButton).toBeDisabled()
    })

    it('should show spinning icon on refresh button while loading', () => {
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: true,
        error: null,
        refresh: refreshMock,
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      const refreshButton = screen.getByTitle('Refresh changes')
      const icon = refreshButton.querySelector('svg')
      expect(icon).toHaveClass('animate-spin')
    })
  })

  describe('Collapse/Expand Behavior', () => {
    it('should start in collapsed state by default', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 20, deletions: 8, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 30,
            totalDeletions: 13,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should show expand button
      expect(screen.getByTitle('Expand code changes')).toBeInTheDocument()

      // Should not show collapse button
      expect(screen.queryByTitle('Collapse code changes')).not.toBeInTheDocument()

      // Should not show file list
      expect(screen.queryByText('src/file1.ts')).not.toBeInTheDocument()
      expect(screen.queryByText('src/file2.ts')).not.toBeInTheDocument()

      // Should show summary stats (now "2 FILES" in header)
      expect(screen.getByText('2 FILES')).toBeInTheDocument()
      expect(screen.getByText('+30')).toBeInTheDocument()
      expect(screen.getByText('-13')).toBeInTheDocument()
    })

    it('should show expanded view when expand button is clicked', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 20, deletions: 8, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 30,
            totalDeletions: 13,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Initially collapsed
      expect(screen.getByTitle('Expand code changes')).toBeInTheDocument()
      expect(screen.queryByText('src/file1.ts')).not.toBeInTheDocument()

      // Click expand button
      await user.click(screen.getByTitle('Expand code changes'))

      // Should now show collapse button
      expect(screen.getByTitle('Collapse code changes')).toBeInTheDocument()
      expect(screen.queryByTitle('Expand code changes')).not.toBeInTheDocument()

      // Should show file list
      expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
      expect(screen.getByText('src/file2.ts')).toBeInTheDocument()

      // Should show status badges (now single letters)
      expect(screen.getByText('M')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should collapse when collapse button is clicked', async () => {
      const user = userEvent.setup()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Expand first
      await user.click(screen.getByTitle('Expand code changes'))
      expect(screen.getByText('src/file1.ts')).toBeInTheDocument()

      // Click collapse button
      await user.click(screen.getByTitle('Collapse code changes'))

      // Should now show expand button
      expect(screen.getByTitle('Expand code changes')).toBeInTheDocument()
      expect(screen.queryByTitle('Collapse code changes')).not.toBeInTheDocument()

      // Should not show file list
      expect(screen.queryByText('src/file1.ts')).not.toBeInTheDocument()
    })

    it('should show additional commits badge in collapsed state', () => {
      const data: ExecutionChangesResult = {
        available: true,
        branchName: 'feature-branch',
        additionalCommits: 3,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
        current: {
          files: [
            { path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' },
            { path: 'src/file2.ts', additions: 5, deletions: 0, status: 'A' },
          ],
          summary: {
            totalFiles: 2,
            totalAdditions: 15,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'ghi789' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should show abbreviated badge in collapsed state
      expect(screen.getByText('+3 new')).toBeInTheDocument()
    })

    it('should allow refresh in collapsed state', async () => {
      const user = userEvent.setup()
      const refreshMock = vi.fn()
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: refreshMock,
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should show refresh button in collapsed state
      const refreshButton = screen.getByTitle('Refresh changes')
      expect(refreshButton).toBeInTheDocument()

      // Click refresh button
      await user.click(refreshButton)

      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    it('should use singular form for 1 file in collapsed state', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 5,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should show singular "FILE" not "FILES"
      expect(screen.getByText('1 FILE')).toBeInTheDocument()
    })

    it('should not show zero stats in collapsed state', () => {
      const data: ExecutionChangesResult = {
        available: true,
        captured: {
          files: [{ path: 'src/file1.ts', additions: 10, deletions: 0, status: 'A' }],
          summary: {
            totalFiles: 1,
            totalAdditions: 10,
            totalDeletions: 0,
          },
          commitRange: { before: 'abc123', after: 'def456' },
          uncommitted: false,
        },
      }

      mockUseExecutionChanges.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      render(<CodeChangesPanel executionId="exec-123" />)

      // Should show +10 but not -0
      expect(screen.getByText('+10')).toBeInTheDocument()
      expect(screen.queryByText('-0')).not.toBeInTheDocument()
    })
  })

  describe('Diff Mode Behavior', () => {
    // Mock executionsApi.getFileDiff
    beforeEach(() => {
      vi.mock('@/lib/api', () => ({
        executionsApi: {
          getFileDiff: vi.fn(),
        },
      }))
    })

    describe('Inline Mode (default)', () => {
      it('should show chevron icons in inline mode by default', async () => {
        const user = userEvent.setup()
        const data: ExecutionChangesResult = {
          available: true,
          captured: {
            files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
            summary: {
              totalFiles: 1,
              totalAdditions: 10,
              totalDeletions: 5,
            },
            commitRange: { before: 'abc123', after: 'def456' },
            uncommitted: false,
          },
        }

        mockUseExecutionChanges.mockReturnValue({
          data,
          loading: false,
          error: null,
          refresh: vi.fn(),
        })

        render(<CodeChangesPanel executionId="exec-123" />)

        // Expand to see files
        await user.click(screen.getByTitle('Expand code changes'))

        // File row should have chevron icon (not maximize icon)
        const fileRow = screen.getByText('src/file1.ts').closest('button')
        expect(fileRow).toBeInTheDocument()

        // Should not show maximize icon in inline mode
        expect(fileRow?.querySelector('svg')).toBeInTheDocument()
      })

      it('should explicitly work in inline mode when diffMode="inline"', async () => {
        const user = userEvent.setup()
        const data: ExecutionChangesResult = {
          available: true,
          captured: {
            files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
            summary: {
              totalFiles: 1,
              totalAdditions: 10,
              totalDeletions: 5,
            },
            commitRange: { before: 'abc123', after: 'def456' },
            uncommitted: false,
          },
        }

        mockUseExecutionChanges.mockReturnValue({
          data,
          loading: false,
          error: null,
          refresh: vi.fn(),
        })

        render(<CodeChangesPanel executionId="exec-123" diffMode="inline" />)

        // Expand to see files
        await user.click(screen.getByTitle('Expand code changes'))

        // Should have file row
        expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
      })
    })

    describe('Modal Mode', () => {
      it('should work in modal mode when diffMode="modal"', async () => {
        const user = userEvent.setup()
        const data: ExecutionChangesResult = {
          available: true,
          captured: {
            files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
            summary: {
              totalFiles: 1,
              totalAdditions: 10,
              totalDeletions: 5,
            },
            commitRange: { before: 'abc123', after: 'def456' },
            uncommitted: false,
          },
        }

        mockUseExecutionChanges.mockReturnValue({
          data,
          loading: false,
          error: null,
          refresh: vi.fn(),
        })

        render(<CodeChangesPanel executionId="exec-123" diffMode="modal" />)

        // Expand to see files
        await user.click(screen.getByTitle('Expand code changes'))

        // Should have file row
        expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
      })

      it('should have maximize icon in modal mode', async () => {
        const user = userEvent.setup()
        const data: ExecutionChangesResult = {
          available: true,
          captured: {
            files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
            summary: {
              totalFiles: 1,
              totalAdditions: 10,
              totalDeletions: 5,
            },
            commitRange: { before: 'abc123', after: 'def456' },
            uncommitted: false,
          },
        }

        mockUseExecutionChanges.mockReturnValue({
          data,
          loading: false,
          error: null,
          refresh: vi.fn(),
        })

        render(<CodeChangesPanel executionId="exec-123" diffMode="modal" />)

        // Expand panel
        await user.click(screen.getByTitle('Expand code changes'))

        // File row should have a button
        const fileButton = screen.getByText('src/file1.ts').closest('button')
        expect(fileButton).toBeInTheDocument()
      })

      it('should show loading state when fetching diff in modal mode', async () => {
        const user = userEvent.setup()
        const { executionsApi } = await import('@/lib/api')

        // Mock with a delayed promise to catch loading state
        const mockGetFileDiff = vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({
            oldContent: 'old content',
            newContent: 'new content',
          }), 100))
        )
        ;(executionsApi.getFileDiff as any) = mockGetFileDiff

        const data: ExecutionChangesResult = {
          available: true,
          captured: {
            files: [{ path: 'src/file1.ts', additions: 10, deletions: 5, status: 'M' }],
            summary: {
              totalFiles: 1,
              totalAdditions: 10,
              totalDeletions: 5,
            },
            commitRange: { before: 'abc123', after: 'def456' },
            uncommitted: false,
          },
        }

        mockUseExecutionChanges.mockReturnValue({
          data,
          loading: false,
          error: null,
          refresh: vi.fn(),
        })

        render(<CodeChangesPanel executionId="exec-123" diffMode="modal" />)

        // Expand panel
        await user.click(screen.getByTitle('Expand code changes'))

        // Click file row
        const fileButton = screen.getByText('src/file1.ts').closest('button')
        if (fileButton) {
          await user.click(fileButton)
        }

        // Should show loading spinner briefly
        const fileRow = screen.getByText('src/file1.ts').closest('button')
        expect(fileRow?.querySelector('.animate-spin')).toBeInTheDocument()
      })
    })

  })
})
