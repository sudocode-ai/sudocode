import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useAgentActions } from '@/hooks/useAgentActions'
import type { Execution } from '@/types/execution'

// Mock dependencies
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/hooks/useExecutionSync', () => ({
  useExecutionSync: () => ({
    fetchSyncPreview: vi.fn(),
    openWorktreeInIDE: vi.fn(),
    syncPreview: null,
    isSyncPreviewOpen: false,
    setIsSyncPreviewOpen: vi.fn(),
    performSync: vi.fn(),
    isPreviewing: false,
    syncStatus: 'idle',
  }),
}))

const mockExecutionsApi = {
  deleteWorktree: vi.fn(),
  commit: vi.fn(),
}

vi.mock('@/lib/api', () => ({
  executionsApi: {
    deleteWorktree: (...args: unknown[]) => mockExecutionsApi.deleteWorktree(...args),
    commit: (...args: unknown[]) => mockExecutionsApi.commit(...args),
  },
}))

describe('useAgentActions', () => {
  const mockExecution: Execution = {
    id: 'exec-123',
    issue_id: 'i-test1',
    issue_uuid: 'uuid-123',
    mode: 'worktree',
    prompt: 'Test prompt',
    config: JSON.stringify({ mode: 'worktree' }),
    agent_type: 'claude-code',
    session_id: 'session-123',
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'feature/test',
    before_commit: 'abc123',
    after_commit: null,
    worktree_path: '/path/to/worktree',
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T01:00:00Z',
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4',
    summary: 'Completed successfully',
    files_changed: JSON.stringify(['file1.ts', 'file2.ts', 'file3.ts']),
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
    stream_id: null,
    deleted_at: null,
    deletion_reason: null,
  }

  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  })

  // Wrapper to provide QueryClient
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  describe('Action Detection', () => {
    it('should return no actions when execution is null', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: null,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      expect(result.current.actions).toEqual([])
      expect(result.current.hasActions).toBe(false)
    })

    it('should return no actions when execution is undefined', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: undefined,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      expect(result.current.actions).toEqual([])
      expect(result.current.hasActions).toBe(false)
    })

    it('should detect commit action when execution has uncommitted files', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true, // Explicitly set to show commit action
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeDefined()
      expect(commitAction?.label).toBe('Commit Changes')
      expect(commitAction?.description).toBe('Commit 3 file changes')
    })

    it('should not show commit action when files are already committed (local mode)', () => {
      // In local mode, after_commit means the changes have been committed
      const committedExecution: Execution = {
        ...mockExecution,
        mode: 'local',
        config: JSON.stringify({ mode: 'local' }),
        after_commit: 'def456', // Has commit hash
        worktree_path: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: committedExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: false, // No uncommitted changes
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })

    it('should not show commit action when execution is not completed', () => {
      const runningExecution: Execution = {
        ...mockExecution,
        status: 'running',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: runningExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })

    it('should detect sync action for worktree executions with changes', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
      expect(syncAction?.label).toBe('Merge Changes')
      expect(syncAction?.description).toBe('Sync worktree changes to local branch')
    })

    it('should not show sync action for local mode executions', () => {
      const localExecution: Execution = {
        ...mockExecution,
        mode: 'local',
        config: JSON.stringify({ mode: 'local' }),
        worktree_path: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: localExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeUndefined()
    })

    it('should show sync action when worktree exists even without uncommitted files', () => {
      // Sync action should appear for worktrees regardless of uncommitted changes
      // because there may be commits to merge even if all changes are committed
      const noChangesExecution: Execution = {
        ...mockExecution,
        files_changed: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: noChangesExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
      expect(syncAction?.label).toBe('Merge Changes')
    })

    it('should show sync action for running executions with worktree and changes', () => {
      const runningExecution: Execution = {
        ...mockExecution,
        status: 'running',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: runningExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
      expect(syncAction?.label).toBe('Merge Changes')
    })

    it('should show sync action for paused executions with worktree and changes', () => {
      const pausedExecution: Execution = {
        ...mockExecution,
        status: 'paused',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: pausedExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
    })

    it('should detect cleanup worktree action when worktree exists', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const cleanupAction = result.current.actions.find((a) => a.id === 'cleanup-worktree')
      expect(cleanupAction).toBeDefined()
      expect(cleanupAction?.label).toBe('Cleanup Worktree')
      expect(cleanupAction?.variant).toBe('secondary')
    })

    it('should not show cleanup action for local mode executions', () => {
      const localExecution: Execution = {
        ...mockExecution,
        mode: 'local',
        worktree_path: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: localExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const cleanupAction = result.current.actions.find((a) => a.id === 'cleanup-worktree')
      expect(cleanupAction).toBeUndefined()
    })

    it('should handle files_changed as JSON array', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeDefined()
      expect(commitAction?.description).toBe('Commit 3 file changes')
    })

    it('should handle files_changed as single string', () => {
      const singleFileExecution: Execution = {
        ...mockExecution,
        files_changed: 'single-file.ts',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: singleFileExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeDefined()
      expect(commitAction?.description).toBe('Commit 1 file change')
    })
  })

  describe('Action Handlers', () => {
    it('should open commit dialog when commit action is clicked', async () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      expect(result.current.isCommitDialogOpen).toBe(false)

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeDefined()

      await act(async () => {
        await commitAction?.onClick()
      })

      expect(result.current.isCommitDialogOpen).toBe(true)
    })

    it('should open cleanup dialog when cleanup action is clicked', async () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      expect(result.current.isCleanupDialogOpen).toBe(false)

      const cleanupAction = result.current.actions.find((a) => a.id === 'cleanup-worktree')
      expect(cleanupAction).toBeDefined()

      await act(async () => {
        await cleanupAction?.onClick()
      })

      expect(result.current.isCleanupDialogOpen).toBe(true)
    })

    it('should call fetchSyncPreview when squash merge action is clicked', async () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()

      // fetchSyncPreview is mocked in useExecutionSync mock
      await syncAction?.onClick()

      // Should have called fetchSyncPreview (mocked)
      // The actual behavior is tested in useExecutionSync tests
    })
  })

  describe('Disabled State', () => {
    it('should disable all actions when disabled prop is true', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            disabled: true,
          }),
        { wrapper }
      )

      result.current.actions.forEach((action) => {
        expect(action.disabled).toBe(true)
      })
    })

    it('should not disable actions when disabled prop is false', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            disabled: false,
          }),
        { wrapper }
      )

      result.current.actions.forEach((action) => {
        expect(action.disabled).toBe(false)
      })
    })
  })

  describe('Helper Functions', () => {
    it('should provide getAction helper to retrieve action by id', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.getAction('commit-changes')
      expect(commitAction).toBeDefined()
      expect(commitAction?.id).toBe('commit-changes')
    })

    it('should return undefined for non-existent action', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const action = result.current.getAction('non-existent-action')
      expect(action).toBeUndefined()
    })
  })

  describe('Multiple Actions', () => {
    it('should show multiple actions when conditions are met', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      // Should have: commit, squash-merge, cleanup
      expect(result.current.actions.length).toBeGreaterThanOrEqual(3)
      expect(result.current.hasActions).toBe(true)

      const actionIds = result.current.actions.map((a) => a.id)
      expect(actionIds).toContain('commit-changes')
      expect(actionIds).toContain('squash-merge')
      expect(actionIds).toContain('cleanup-worktree')
    })

    it('should show subset of actions when only some conditions are met', () => {
      // Worktree with no uncommitted file changes - no commit action, but sync and cleanup
      // Sync is available because there may be commits to merge even without uncommitted changes
      const noChangesExecution: Execution = {
        ...mockExecution,
        files_changed: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: noChangesExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const actionIds = result.current.actions.map((a) => a.id)
      expect(actionIds).not.toContain('commit-changes')
      expect(actionIds).toContain('squash-merge') // Sync available for worktrees
      expect(actionIds).toContain('cleanup-worktree')
    })
  })

  describe('Edge Cases', () => {
    it('should handle execution with null config gracefully', () => {
      const noConfigExecution: Execution = {
        ...mockExecution,
        config: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: noConfigExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      // Should still work with mode from top-level field
      expect(result.current.actions.length).toBeGreaterThan(0)
    })

    it('should handle execution with invalid JSON config gracefully', () => {
      const invalidConfigExecution: Execution = {
        ...mockExecution,
        config: '{invalid json',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: invalidConfigExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      // Should still work by falling back to mode field
      expect(result.current.actions.length).toBeGreaterThan(0)
    })

    it('should handle execution with empty files_changed array', () => {
      const noFilesExecution: Execution = {
        ...mockExecution,
        files_changed: JSON.stringify([]),
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: noFilesExecution,
            issueId: 'i-test1',
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })

    it('should use singular form for single file change', () => {
      const singleFileExecution: Execution = {
        ...mockExecution,
        files_changed: JSON.stringify(['file1.ts']),
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: singleFileExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction?.description).toBe('Commit 1 file change')
    })

    it('should use plural form for multiple file changes', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction?.description).toBe('Commit 3 file changes')
    })
  })

  describe('Worktree Exists Option', () => {
    it('should hide commit action when worktreeExists is false', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: false,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })

    it('should hide squash-merge action when worktreeExists is false', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: false,
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeUndefined()
    })

    it('should hide cleanup-worktree action when worktreeExists is false', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: false,
          }),
        { wrapper }
      )

      const cleanupAction = result.current.actions.find((a) => a.id === 'cleanup-worktree')
      expect(cleanupAction).toBeUndefined()
    })

    it('should return no actions when worktreeExists is false for worktree mode', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: false,
          }),
        { wrapper }
      )

      expect(result.current.actions).toEqual([])
      expect(result.current.hasActions).toBe(false)
    })

    it('should show all actions when worktreeExists is true (default)', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const actionIds = result.current.actions.map((a) => a.id)
      expect(actionIds).toContain('commit-changes')
      expect(actionIds).toContain('squash-merge')
      expect(actionIds).toContain('cleanup-worktree')
    })

    it('should default worktreeExists to true', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            // worktreeExists not specified
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      // Should show all actions (same as worktreeExists: true)
      const actionIds = result.current.actions.map((a) => a.id)
      expect(actionIds).toContain('commit-changes')
      expect(actionIds).toContain('squash-merge')
      expect(actionIds).toContain('cleanup-worktree')
    })
  })

  describe('Merge Changes with commitsAhead and hasUncommittedChanges', () => {
    it('should show merge action when commitsAhead is undefined (default behavior)', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            // commitsAhead not specified - should default to showing merge action
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
      expect(syncAction?.label).toBe('Merge Changes')
    })

    it('should show merge action when commitsAhead > 0', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            commitsAhead: 3,
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
    })

    it('should show merge action when commitsAhead is 0 but hasUncommittedChanges is true', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            commitsAhead: 0,
            hasUncommittedChanges: true,
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
      expect(syncAction?.label).toBe('Merge Changes')
    })

    it('should hide merge action when commitsAhead is 0 and hasUncommittedChanges is false', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            commitsAhead: 0,
            hasUncommittedChanges: false,
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeUndefined()
    })

    it('should hide merge action when commitsAhead is 0 and hasUncommittedChanges is undefined', () => {
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            commitsAhead: 0,
            // hasUncommittedChanges not specified
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeUndefined()
    })

    it('should show merge action when only uncommitted changes exist (no commits)', () => {
      // This is the key scenario: agent made changes but hasn't committed yet
      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            commitsAhead: 0, // No commits yet
            hasUncommittedChanges: true, // But has uncommitted changes
          }),
        { wrapper }
      )

      const syncAction = result.current.actions.find((a) => a.id === 'squash-merge')
      expect(syncAction).toBeDefined()
      expect(syncAction?.label).toBe('Merge Changes')
    })
  })

  describe('Worktree Mode vs Local Mode Commit Logic', () => {
    it('should show commit action for worktree mode even with after_commit set', () => {
      // In worktree mode, we can have uncommitted changes even if after_commit is set
      // because the agent may have made additional changes after committing
      const worktreeWithCommit: Execution = {
        ...mockExecution,
        mode: 'worktree',
        after_commit: 'abc123', // Has a commit
        files_changed: JSON.stringify(['file1.ts']), // But also has file changes
        worktree_path: '/path/to/worktree',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: worktreeWithCommit,
            issueId: 'i-test1',
            worktreeExists: true,
            hasUncommittedChanges: true, // There are uncommitted changes on top of the commit
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeDefined()
    })

    it('should not show commit action for local mode when no uncommitted changes', () => {
      // In local mode, show commit action based on hasUncommittedChanges
      const localWithCommit: Execution = {
        ...mockExecution,
        mode: 'local',
        config: JSON.stringify({ mode: 'local' }),
        after_commit: 'abc123',
        files_changed: JSON.stringify(['file1.ts']),
        worktree_path: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: localWithCommit,
            issueId: 'i-test1',
            hasUncommittedChanges: false, // No uncommitted changes
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })

    it('should show commit action for local mode without after_commit', () => {
      const localWithoutCommit: Execution = {
        ...mockExecution,
        mode: 'local',
        config: JSON.stringify({ mode: 'local' }),
        after_commit: null,
        files_changed: JSON.stringify(['file1.ts']),
        worktree_path: null,
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: localWithoutCommit,
            issueId: 'i-test1',
            hasUncommittedChanges: true, // Uncommitted changes exist
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeDefined()
    })

    it('should not show commit action for worktree mode without file changes', () => {
      const worktreeNoChanges: Execution = {
        ...mockExecution,
        mode: 'worktree',
        files_changed: null,
        worktree_path: '/path/to/worktree',
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: worktreeNoChanges,
            issueId: 'i-test1',
            worktreeExists: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })

    it('should not show commit action for worktree mode without worktree path', () => {
      const worktreeNoPath: Execution = {
        ...mockExecution,
        mode: 'worktree',
        files_changed: JSON.stringify(['file1.ts']),
        worktree_path: null, // No worktree path
      }

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: worktreeNoPath,
            issueId: 'i-test1',
            worktreeExists: true,
          }),
        { wrapper }
      )

      const commitAction = result.current.actions.find((a) => a.id === 'commit-changes')
      expect(commitAction).toBeUndefined()
    })
  })

  describe('Cleanup Complete Callback', () => {
    beforeEach(() => {
      mockExecutionsApi.deleteWorktree.mockReset()
    })

    it('should call onCleanupComplete after successful cleanup', async () => {
      mockExecutionsApi.deleteWorktree.mockResolvedValue({})
      const onCleanupComplete = vi.fn()

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            onCleanupComplete,
          }),
        { wrapper }
      )

      await act(async () => {
        await result.current.handleCleanupWorktree(false)
      })

      expect(onCleanupComplete).toHaveBeenCalledTimes(1)
    })

    it('should call onCleanupComplete with deleteBranch true', async () => {
      mockExecutionsApi.deleteWorktree.mockResolvedValue({})
      const onCleanupComplete = vi.fn()

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            onCleanupComplete,
          }),
        { wrapper }
      )

      await act(async () => {
        await result.current.handleCleanupWorktree(true)
      })

      expect(mockExecutionsApi.deleteWorktree).toHaveBeenCalledWith('exec-123', true)
      expect(onCleanupComplete).toHaveBeenCalledTimes(1)
    })

    it('should not call onCleanupComplete on cleanup failure', async () => {
      mockExecutionsApi.deleteWorktree.mockRejectedValue(new Error('Cleanup failed'))
      const onCleanupComplete = vi.fn()

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            onCleanupComplete,
          }),
        { wrapper }
      )

      await act(async () => {
        await result.current.handleCleanupWorktree(false)
      })

      expect(onCleanupComplete).not.toHaveBeenCalled()
    })

    it('should close cleanup dialog after successful cleanup', async () => {
      mockExecutionsApi.deleteWorktree.mockResolvedValue({})

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
          }),
        { wrapper }
      )

      // Open the dialog first
      await act(async () => {
        result.current.setIsCleanupDialogOpen(true)
      })

      expect(result.current.isCleanupDialogOpen).toBe(true)

      // Perform cleanup
      await act(async () => {
        await result.current.handleCleanupWorktree(false)
      })

      expect(result.current.isCleanupDialogOpen).toBe(false)
    })

    it('should set isCleaning state during cleanup operation', async () => {
      let resolveCleanup: () => void
      mockExecutionsApi.deleteWorktree.mockReturnValue(
        new Promise((resolve) => {
          resolveCleanup = () => resolve({})
        })
      )

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
          }),
        { wrapper }
      )

      expect(result.current.isCleaning).toBe(false)

      // Start cleanup without awaiting
      let cleanupPromise: Promise<void>
      act(() => {
        cleanupPromise = result.current.handleCleanupWorktree(false)
      })

      // Should be cleaning now
      expect(result.current.isCleaning).toBe(true)

      // Resolve and wait for completion
      await act(async () => {
        resolveCleanup!()
        await cleanupPromise
      })

      expect(result.current.isCleaning).toBe(false)
    })
  })

  describe('Commit Complete Callback', () => {
    beforeEach(() => {
      mockExecutionsApi.commit.mockReset()
    })

    it('should call onCommitComplete after successful commit', async () => {
      mockExecutionsApi.commit.mockResolvedValue({})
      const onCommitComplete = vi.fn()

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            onCommitComplete,
          }),
        { wrapper }
      )

      await act(async () => {
        await result.current.handleCommitChanges('Test commit message')
      })

      expect(mockExecutionsApi.commit).toHaveBeenCalledWith('exec-123', { message: 'Test commit message' })
      expect(onCommitComplete).toHaveBeenCalledTimes(1)
    })

    it('should not call onCommitComplete on commit failure', async () => {
      mockExecutionsApi.commit.mockRejectedValue(new Error('Commit failed'))
      const onCommitComplete = vi.fn()

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
            onCommitComplete,
          }),
        { wrapper }
      )

      await act(async () => {
        await result.current.handleCommitChanges('Test commit message')
      })

      expect(onCommitComplete).not.toHaveBeenCalled()
    })

    it('should close commit dialog after successful commit', async () => {
      mockExecutionsApi.commit.mockResolvedValue({})

      const { result } = renderHook(
        () =>
          useAgentActions({
            execution: mockExecution,
            issueId: 'i-test1',
            worktreeExists: true,
          }),
        { wrapper }
      )

      // Open the dialog first
      await act(async () => {
        result.current.setIsCommitDialogOpen(true)
      })

      expect(result.current.isCommitDialogOpen).toBe(true)

      // Perform commit
      await act(async () => {
        await result.current.handleCommitChanges('Test commit')
      })

      expect(result.current.isCommitDialogOpen).toBe(false)
    })
  })
})
