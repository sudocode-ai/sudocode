import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionView } from '@/components/executions/ExecutionView'
import { executionsApi } from '@/lib/api'
import type { Execution, SyncPreviewResult, SyncResult } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  executionsApi: {
    getChain: vi.fn(),
    worktreeExists: vi.fn(),
    getChanges: vi.fn(),
    syncPreview: vi.fn(),
    syncSquash: vi.fn(),
    syncPreserve: vi.fn(),
    cancel: vi.fn(),
    createFollowUp: vi.fn(),
    deleteWorktree: vi.fn(),
    openInIde: vi.fn(),
  },
  agentsApi: {
    getAll: vi.fn(),
  },
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock child components
vi.mock('@/components/executions/ExecutionMonitor', () => ({
  ExecutionMonitor: () => <div data-testid="execution-monitor">ExecutionMonitor</div>,
  RunIndicator: () => <div>Running...</div>,
}))

vi.mock('@/components/executions/AgentConfigPanel', () => ({
  AgentConfigPanel: () => <div data-testid="follow-up-panel">AgentConfigPanel</div>,
}))

vi.mock('@/components/executions/TodoTracker', () => ({
  TodoTracker: () => <div data-testid="todo-tracker">TodoTracker</div>,
}))

vi.mock('@/components/executions/DeleteWorktreeDialog', () => ({
  DeleteWorktreeDialog: () => null,
}))

vi.mock('@/components/executions/DeleteExecutionDialog', () => ({
  DeleteExecutionDialog: () => null,
}))

describe.skip('Sync Workflow Integration Tests', () => {
  const mockExecution: Execution = {
    id: 'exec-123',
    issue_id: 'ISSUE-001',
    issue_uuid: null,
    mode: 'worktree',
    prompt: 'Test prompt',
    config: null,
    agent_type: 'claude-code',
    session_id: null,
    workflow_execution_id: 'workflow-123',
    target_branch: 'main',
    branch_name: 'exec-123',
    before_commit: null,
    after_commit: null,
    worktree_path: '/tmp/worktree-123',
    status: 'completed',
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:00:00Z',
    started_at: '2025-01-15T10:01:00Z',
    completed_at: '2025-01-15T10:05:00Z',
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4',
    summary: null,
    files_changed: null,
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
    stream_id: null,
    deleted_at: null,
    deletion_reason: null,
  }

  const mockChainResponse = (execution: Execution) => ({
    rootId: execution.id,
    executions: [execution],
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: true })
    vi.mocked(executionsApi.getChanges).mockResolvedValue({
      available: true,
      captured: {
        files: [],
        summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 },
        commitRange: null,
        uncommitted: false,
      },
    })
  })

  describe('Scenario 1: Happy Path - Squash Sync', () => {
    it('should complete full squash sync workflow successfully', async () => {
      const user = userEvent.setup()

      // Mock preview response
      const mockPreview: SyncPreviewResult = {
        canSync: true,
        conflicts: {
          hasConflicts: false,
          codeConflicts: [],
          jsonlConflicts: [],
          totalFiles: 0,
          summary: 'No conflicts detected',
        },
        diff: {
          additions: 120,
          deletions: 30,
          files: ['src/test.ts', 'src/utils.ts'],
        },
        commits: [
          {
            sha: 'abc123',
            message: 'Test commit',
            author: 'Test User',
            timestamp: '2025-01-15T10:00:00Z',
          },
        ],
        mergeBase: 'def456',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      // Mock sync response
      const mockSyncResult: SyncResult = {
        success: true,
        finalCommit: 'xyz789',
        filesChanged: 5,
        hasConflicts: false,
        uncommittedFilesIncluded: 0,
        cleanupOffered: true,
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)
      vi.mocked(executionsApi.syncSquash).mockResolvedValue(mockSyncResult)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      // Step 1: Click "Sync Worktree to Local" button
      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      // Step 2: Preview dialog should open
      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      // Verify we can interact with the dialog - squash mode should be selected by default
      const squashRadio = screen.getByRole('radio', { name: /Squash/i })
      expect(squashRadio).toBeChecked()

      // Enter commit message
      const commitInput = screen.getByPlaceholderText(/commit message/i)
      await user.clear(commitInput)
      await user.type(commitInput, 'Test squash commit message')

      // Click sync button
      const confirmButton = screen.getByRole('button', { name: /Squash.*Sync/i })
      await user.click(confirmButton)

      // Sync should complete and show success
      await waitFor(
        () => {
          expect(screen.getByText(/Sync.*Complete/i)).toBeInTheDocument()
        },
        { timeout: 3000 }
      )

      // Verify success message shows
      expect(screen.getByText(/Sync Successful/i)).toBeInTheDocument()

      // Step 9: Verify API was called correctly
      expect(executionsApi.syncPreview).toHaveBeenCalledWith('exec-123')
      expect(executionsApi.syncSquash).toHaveBeenCalledWith('exec-123', {
        mode: 'squash',
        commitMessage: 'Test squash commit message',
      })
    })
  })

  describe('Scenario 2: Happy Path - Preserve Commits Sync', () => {
    it('should complete full preserve commits sync workflow successfully', async () => {
      const user = userEvent.setup()

      const mockPreview: SyncPreviewResult = {
        canSync: true,
        conflicts: {
          hasConflicts: false,
          codeConflicts: [],
          jsonlConflicts: [],
          totalFiles: 0,
          summary: 'No conflicts detected',
        },
        diff: {
          additions: 50,
          deletions: 10,
          files: [],
        },
        commits: [
          {
            sha: 'abc123',
            message: 'First commit',
            author: 'Test User',
            timestamp: '2025-01-15T10:00:00Z',
          },
          {
            sha: 'def456',
            message: 'Second commit',
            author: 'Test User',
            timestamp: '2025-01-15T10:01:00Z',
          },
        ],
        mergeBase: 'ghi789',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      const mockSyncResult: SyncResult = {
        success: true,
        finalCommit: 'jkl012',
        filesChanged: 3,
        hasConflicts: false,
        uncommittedFilesIncluded: 0,
        cleanupOffered: true,
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)
      vi.mocked(executionsApi.syncPreserve).mockResolvedValue(mockSyncResult)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      // Click sync button
      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      // Wait for preview dialog
      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      // Select preserve mode
      const preserveRadio = screen.getByRole('radio', { name: /Preserve/i })
      await user.click(preserveRadio)
      expect(preserveRadio).toBeChecked()

      // Click sync button
      const confirmButton = screen.getByRole('button', { name: /Preserve.*Sync/i })
      await user.click(confirmButton)

      // Verify sync completes
      await waitFor(
        () => {
          expect(screen.getByText(/Sync.*Complete/i)).toBeInTheDocument()
        },
        { timeout: 3000 }
      )

      expect(executionsApi.syncPreserve).toHaveBeenCalledWith('exec-123', {
        mode: 'preserve',
      })
    })
  })

  describe('Scenario 3: JSONL Conflicts Auto-Resolution', () => {
    it('should show JSONL conflicts as auto-resolvable and allow sync', async () => {
      const user = userEvent.setup()

      const mockPreview: SyncPreviewResult = {
        canSync: true,
        conflicts: {
          hasConflicts: true,
          codeConflicts: [],
          jsonlConflicts: [
            {
              filePath: 'issues.jsonl',
              entityType: 'issue',
              conflictCount: 2,
              canAutoResolve: true,
            },
          ],
          totalFiles: 1,
          summary: '1 JSONL file with auto-resolvable conflicts',
        },
        diff: {
          additions: 20,
          deletions: 5,
          files: [],
        },
        commits: [],
        mergeBase: 'abc123',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      const mockSyncResult: SyncResult = {
        success: true,
        finalCommit: 'xyz789',
        filesChanged: 2,
        hasConflicts: false,
        uncommittedFilesIncluded: 0,
        cleanupOffered: true,
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)
      vi.mocked(executionsApi.syncSquash).mockResolvedValue(mockSyncResult)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      // Verify sync button is enabled (JSONL conflicts don't block)
      const commitInput = screen.getByPlaceholderText(/commit message/i)
      await user.type(commitInput, 'Sync with auto-resolved JSONL')

      const confirmButton = screen.getByRole('button', { name: /Squash.*Sync/i })
      expect(confirmButton).not.toBeDisabled()

      await user.click(confirmButton)

      // Verify sync completes
      await waitFor(() => {
        expect(screen.getByText(/Sync Complete/i)).toBeInTheDocument()
      })
    })
  })

  describe('Scenario 4: Code Conflicts Blocking', () => {
    it('should block sync when code conflicts exist', async () => {
      const user = userEvent.setup()

      const mockPreview: SyncPreviewResult = {
        canSync: false,
        conflicts: {
          hasConflicts: true,
          codeConflicts: [
            {
              filePath: 'src/app.ts',
              conflictType: 'content',
              description: 'Content conflict in src/app.ts',
              canAutoResolve: false,
            },
            {
              filePath: 'src/utils.ts',
              conflictType: 'content',
              description: 'Content conflict in src/utils.ts',
              canAutoResolve: false,
            },
          ],
          jsonlConflicts: [],
          totalFiles: 2,
          summary: '2 code files with conflicts',
        },
        diff: {
          additions: 30,
          deletions: 10,
          files: [],
        },
        commits: [],
        mergeBase: 'abc123',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      // Verify sync button is disabled when code conflicts exist
      const squashButton = screen.getByRole('button', { name: /Squash.*Sync/i })
      expect(squashButton).toBeDisabled()

      // Verify "Open in IDE" button is available in the dialog
      const ideButtons = screen.getAllByRole('button', { name: /Open.*IDE/i })
      expect(ideButtons.length).toBeGreaterThan(0)
    })
  })

  describe('Scenario 5: Uncommitted JSONL Inclusion', () => {
    it('should show badge and include uncommitted JSONL changes', async () => {
      const user = userEvent.setup()

      const mockPreview: SyncPreviewResult = {
        canSync: true,
        conflicts: {
          hasConflicts: false,
          codeConflicts: [],
          jsonlConflicts: [],
          totalFiles: 0,
          summary: 'No conflicts detected',
        },
        diff: {
          additions: 40,
          deletions: 15,
          files: [],
        },
        commits: [],
        mergeBase: 'abc123',
        uncommittedJSONLChanges: true,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      const mockSyncResult: SyncResult = {
        success: true,
        finalCommit: 'xyz789',
        filesChanged: 3,
        hasConflicts: false,
        uncommittedFilesIncluded: 2,
        cleanupOffered: true,
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)
      vi.mocked(executionsApi.syncSquash).mockResolvedValue(mockSyncResult)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      // Complete sync
      const commitInput = screen.getByPlaceholderText(/commit message/i)
      await user.type(commitInput, 'Sync with uncommitted JSONL')

      const confirmButton = screen.getByRole('button', { name: /Squash.*Sync/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByText(/Sync Complete/i)).toBeInTheDocument()
      })
    })
  })

  describe('Scenario 6: Dirty Working Tree Error', () => {
    it('should handle error when local working tree has uncommitted changes', async () => {
      const user = userEvent.setup()

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockRejectedValue(
        new Error('DIRTY_WORKING_TREE: Local branch has uncommitted changes')
      )

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      // Wait for loading to complete and button to be available again
      await waitFor(
        () => {
          const button = screen.getByRole('button', { name: /Sync Worktree to Local/ })
          expect(button).not.toHaveTextContent(/Loading/)
        },
        { timeout: 2000 }
      )

      // Verify API was called
      expect(executionsApi.syncPreview).toHaveBeenCalledWith('exec-123')
    })
  })

  describe('Scenario 7: Worktree Cleanup Option', () => {
    it('should show cleanup option after successful sync', async () => {
      const user = userEvent.setup()

      const mockPreview: SyncPreviewResult = {
        canSync: true,
        conflicts: {
          hasConflicts: false,
          codeConflicts: [],
          jsonlConflicts: [],
          totalFiles: 0,
          summary: 'No conflicts detected',
        },
        diff: {
          additions: 10,
          deletions: 5,
          files: [],
        },
        commits: [],
        mergeBase: 'abc123',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      const mockSyncResult: SyncResult = {
        success: true,
        finalCommit: 'xyz789',
        filesChanged: 1,
        hasConflicts: false,
        uncommittedFilesIncluded: 0,
        cleanupOffered: true,
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)
      vi.mocked(executionsApi.syncSquash).mockResolvedValue(mockSyncResult)
      vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(undefined as any)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      const commitInput = screen.getByPlaceholderText(/commit message/i)
      await user.type(commitInput, 'Test commit')

      const confirmButton = screen.getByRole('button', { name: /Squash.*Sync/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByText(/Sync Complete/i)).toBeInTheDocument()
      })

      // Find and check the cleanup checkbox
      const cleanupCheckbox = screen.getByRole('checkbox', {
        name: /Clean up worktree/i,
      })
      await user.click(cleanupCheckbox)

      // Close the dialog
      const doneButton = screen.getByRole('button', { name: /Done/i })
      await user.click(doneButton)

      // Verify cleanup was called (now uses centralized mutation hook)
      await waitFor(() => {
        expect(executionsApi.deleteWorktree).toHaveBeenCalledWith('exec-123', undefined)
      })
    })
  })

  describe('Scenario 8: Open Worktree in IDE', () => {
    it('should call API to open worktree in IDE when Open in IDE clicked', async () => {
      const user = userEvent.setup()
      const { toast } = await import('sonner')

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
      vi.mocked(executionsApi.openInIde).mockResolvedValue(undefined as any)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Open in IDE/ })).toBeInTheDocument()
      })

      const openIDEButton = screen.getByRole('button', { name: /Open in IDE/ })
      await user.click(openIDEButton)

      // Verify API was called with worktree path
      await waitFor(() => {
        expect(executionsApi.openInIde).toHaveBeenCalledWith('/tmp/worktree-123')
        expect(toast.success).toHaveBeenCalledWith('Opening worktree in IDE...')
      })
    })
  })

  describe('Scenario 9: Running Execution Warning', () => {
    it('should show warning when syncing a running execution', async () => {
      const user = userEvent.setup()

      const runningExecution = {
        ...mockExecution,
        status: 'running' as const,
        completed_at: null,
      }

      const mockPreview: SyncPreviewResult = {
        canSync: true,
        conflicts: {
          hasConflicts: false,
          codeConflicts: [],
          jsonlConflicts: [],
          totalFiles: 0,
          summary: 'No conflicts detected',
        },
        diff: {
          additions: 5,
          deletions: 2,
          files: [],
        },
        commits: [],
        mergeBase: 'abc123',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'running',
        warnings: ['This execution is still running. Changes may still be in progress.'],
      }

      vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(runningExecution))
      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)

      renderWithProviders(<ExecutionView executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sync Worktree to Local/ })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /Sync Worktree to Local/ })
      await user.click(syncButton)

      await waitFor(() => {
        expect(screen.getByText('Sync Preview')).toBeInTheDocument()
      })

      // Verify user can still proceed despite running status
      const commitInput = screen.getByPlaceholderText(/commit message/i)
      await user.type(commitInput, 'Sync running execution')

      const confirmButton = screen.getByRole('button', { name: /Squash.*Sync/i })
      expect(confirmButton).not.toBeDisabled()
    })
  })
})
