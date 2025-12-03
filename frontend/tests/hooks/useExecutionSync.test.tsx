import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useExecutionSync } from '@/hooks/useExecutionSync'
import { executionsApi } from '@/lib/api'
import type { SyncPreviewResult, SyncResult, Execution } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    syncPreview: vi.fn(),
    syncSquash: vi.fn(),
    syncPreserve: vi.fn(),
    deleteWorktree: vi.fn(),
    openInIde: vi.fn(),
  },
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useExecutionSync', () => {
  let queryClient: QueryClient

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

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      expect(result.current.syncPreview).toBeNull()
      expect(result.current.syncStatus).toBe('idle')
      expect(result.current.syncResult).toBeNull()
      expect(result.current.syncError).toBeNull()
      expect(result.current.isSyncPreviewOpen).toBe(false)
      expect(result.current.isSyncProgressOpen).toBe(false)
      expect(result.current.isPreviewing).toBe(false)
      expect(result.current.isSyncing).toBe(false)
    })
  })

  describe('fetchSyncPreview', () => {
    it('should fetch preview successfully', async () => {
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
          files: ['file1.ts', 'file2.ts'],
          additions: 10,
          deletions: 5,
        },
        commits: [
          {
            sha: 'abc123',
            message: 'Test commit',
            author: 'test@example.com',
            timestamp: '2024-01-01T00:00:00Z',
          },
        ],
        mergeBase: 'def456',
        uncommittedJSONLChanges: false,
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: 'completed',
        warnings: [],
      }

      vi.mocked(executionsApi.syncPreview).mockResolvedValue(mockPreview)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.fetchSyncPreview('exec-123')
      })

      // Wait for success (status will transition through previewing to idle)
      await waitFor(() => {
        expect(result.current.syncStatus).toBe('idle')
      })

      expect(result.current.syncPreview).toEqual(mockPreview)
      expect(result.current.isSyncPreviewOpen).toBe(true)
      expect(result.current.syncError).toBeNull()
    })

    it('should handle preview error with CODE_CONFLICTS', async () => {
      const error = new Error('CODE_CONFLICTS: Cannot sync with code conflicts')
      vi.mocked(executionsApi.syncPreview).mockRejectedValue(error)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.fetchSyncPreview('exec-123')
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('error')
      })

      expect(result.current.syncError).toBe(
        'Code conflicts detected. Open worktree in IDE to resolve conflicts before syncing.'
      )
      expect(result.current.syncPreview).toBeNull()
    })

    it('should handle preview error with DIRTY_WORKING_TREE', async () => {
      const error = new Error('DIRTY_WORKING_TREE: Uncommitted changes')
      vi.mocked(executionsApi.syncPreview).mockRejectedValue(error)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.fetchSyncPreview('exec-123')
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('error')
      })

      expect(result.current.syncError).toBe(
        'Local working tree has uncommitted changes. Commit or stash them first.'
      )
    })

    it('should handle preview error with WORKTREE_MISSING', async () => {
      const error = new Error('WORKTREE_MISSING: Worktree not found')
      vi.mocked(executionsApi.syncPreview).mockRejectedValue(error)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.fetchSyncPreview('exec-123')
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('error')
      })

      expect(result.current.syncError).toBe('Worktree directory not found. It may have been deleted.')
    })

    it('should handle unknown error', async () => {
      const error = new Error('Unknown error occurred')
      vi.mocked(executionsApi.syncPreview).mockRejectedValue(error)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.fetchSyncPreview('exec-123')
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('error')
      })

      expect(result.current.syncError).toBe('Unknown error occurred')
    })
  })

  describe('performSync', () => {
    it('should perform squash sync successfully', async () => {
      const mockResult: SyncResult = {
        success: true,
        finalCommit: 'abc123',
        filesChanged: 5,
        hasConflicts: false,
        uncommittedFilesIncluded: 0,
        cleanupOffered: false,
      }

      vi.mocked(executionsApi.syncSquash).mockResolvedValue(mockResult)

      const onSyncSuccess = vi.fn()
      const { result } = renderHook(() => useExecutionSync({ onSyncSuccess }), { wrapper })

      act(() => {
        result.current.performSync('exec-123', 'squash', { commitMessage: 'Test commit message' })
      })

      // Wait for success (status will transition through syncing to success)
      await waitFor(() => {
        expect(result.current.syncStatus).toBe('success')
      })

      // Check final state
      expect(result.current.isSyncPreviewOpen).toBe(false)
      expect(result.current.isSyncProgressOpen).toBe(true)

      expect(result.current.syncResult).toEqual(mockResult)
      expect(result.current.syncError).toBeNull()
      expect(onSyncSuccess).toHaveBeenCalledWith(mockResult)

      // Verify correct API was called
      expect(executionsApi.syncSquash).toHaveBeenCalledWith('exec-123', {
        mode: 'squash',
        commitMessage: 'Test commit message',
      })
    })

    it('should perform preserve sync successfully', async () => {
      const mockResult: SyncResult = {
        success: true,
        finalCommit: 'def456',
        filesChanged: 3,
        hasConflicts: false,
        uncommittedFilesIncluded: 0,
        cleanupOffered: true,
      }

      vi.mocked(executionsApi.syncPreserve).mockResolvedValue(mockResult)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.performSync('exec-123', 'preserve', {})
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('success')
      })

      expect(result.current.syncResult).toEqual(mockResult)

      // Verify correct API was called (no commitMessage for preserve)
      expect(executionsApi.syncPreserve).toHaveBeenCalledWith('exec-123', {
        mode: 'preserve',
      })
    })

    it('should handle sync failure', async () => {
      const mockResult: SyncResult = {
        success: false,
        filesChanged: 0,
        hasConflicts: true,
        error: 'Merge conflict',
      }

      vi.mocked(executionsApi.syncSquash).mockResolvedValue(mockResult)

      const onSyncError = vi.fn()
      const { result } = renderHook(() => useExecutionSync({ onSyncError }), { wrapper })

      act(() => {
        result.current.performSync('exec-123', 'squash')
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('error')
      })

      expect(result.current.syncError).toBe('Merge conflict')
      expect(onSyncError).toHaveBeenCalledWith('Merge conflict')
    })

    it('should handle sync API error', async () => {
      const error = new Error('API error')
      vi.mocked(executionsApi.syncSquash).mockRejectedValue(error)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      act(() => {
        result.current.performSync('exec-123', 'squash')
      })

      await waitFor(() => {
        expect(result.current.syncStatus).toBe('error')
      })

      expect(result.current.syncError).toBe('API error')
    })
  })

  describe('openWorktreeInIDE', () => {
    it('should call API to open worktree in IDE', async () => {
      const { toast } = await import('sonner')
      vi.mocked(executionsApi.openInIde).mockResolvedValue(undefined as any)

      const execution: Partial<Execution> = {
        id: 'exec-123',
        issue_id: 'i-test',
        worktree_path: '/path/to/worktree',
        status: 'completed',
        mode: 'worktree',
        agent_type: 'claude-code',
        model: 'claude-sonnet-4',
        created_at: '2024-01-01T00:00:00Z',
      }

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      await act(async () => {
        await result.current.openWorktreeInIDE(execution as Execution)
      })

      expect(executionsApi.openInIde).toHaveBeenCalledWith('/path/to/worktree')
      expect(toast.success).toHaveBeenCalledWith('Opening worktree in IDE...')
    })

    it('should handle missing worktree path', async () => {
      const { toast } = await import('sonner')

      const execution: Partial<Execution> = {
        id: 'exec-123',
        issue_id: 'i-test',
        worktree_path: null,
        status: 'completed',
        mode: 'local',
        agent_type: 'claude-code',
        model: 'claude-sonnet-4',
        created_at: '2024-01-01T00:00:00Z',
      }

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      await act(async () => {
        await result.current.openWorktreeInIDE(execution as Execution)
      })

      expect(toast.error).toHaveBeenCalledWith('No worktree path available')
      expect(executionsApi.openInIde).not.toHaveBeenCalled()
    })

    it('should handle API errors', async () => {
      const { toast } = await import('sonner')
      const error = new Error('Failed to open IDE')
      vi.mocked(executionsApi.openInIde).mockRejectedValue(error)

      const execution: Partial<Execution> = {
        id: 'exec-123',
        issue_id: 'i-test',
        worktree_path: '/path/to/worktree',
        status: 'completed',
        mode: 'worktree',
        agent_type: 'claude-code',
        model: 'claude-sonnet-4',
        created_at: '2024-01-01T00:00:00Z',
      }

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      await act(async () => {
        await result.current.openWorktreeInIDE(execution as Execution)
      })

      expect(toast.error).toHaveBeenCalledWith('Failed to open IDE')
    })
  })

  describe('cleanupWorktree', () => {
    it('should cleanup worktree successfully', async () => {
      vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(null as any)

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      // Open progress dialog first
      act(() => {
        result.current.setIsSyncProgressOpen(true)
      })

      await act(async () => {
        await result.current.cleanupWorktree('exec-123')
      })

      // Now uses centralized mutation hook which passes (executionId, deleteBranch)
      expect(executionsApi.deleteWorktree).toHaveBeenCalledWith('exec-123', undefined)
      expect(result.current.isSyncProgressOpen).toBe(false)
    })

    it('should handle cleanup error', async () => {
      const error = new Error('Cleanup failed')
      vi.mocked(executionsApi.deleteWorktree).mockRejectedValue(error)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      let thrownError: Error | undefined
      await act(async () => {
        try {
          await result.current.cleanupWorktree('exec-123')
        } catch (e) {
          thrownError = e as Error
        }
      })

      expect(thrownError).toBeDefined()
      expect(thrownError?.message).toBe('Cleanup failed')
      expect(result.current.syncError).toBe('Cleanup failed')

      consoleSpy.mockRestore()
    })
  })

  describe('closeSyncDialogs', () => {
    it('should reset all state and close dialogs', () => {
      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      // Set some state
      act(() => {
        result.current.setIsSyncPreviewOpen(true)
        result.current.setIsSyncProgressOpen(true)
      })

      // Close dialogs
      act(() => {
        result.current.closeSyncDialogs()
      })

      expect(result.current.isSyncPreviewOpen).toBe(false)
      expect(result.current.isSyncProgressOpen).toBe(false)
      expect(result.current.syncPreview).toBeNull()
      expect(result.current.syncResult).toBeNull()
      expect(result.current.syncError).toBeNull()
      expect(result.current.syncStatus).toBe('idle')
    })
  })

  describe('resetSyncState', () => {
    it('should reset state without closing dialogs', () => {
      const { result } = renderHook(() => useExecutionSync(), { wrapper })

      // Set some state
      act(() => {
        result.current.setIsSyncPreviewOpen(true)
        result.current.setIsSyncProgressOpen(true)
      })

      // Reset state
      act(() => {
        result.current.resetSyncState()
      })

      // Dialogs should still be open
      expect(result.current.isSyncPreviewOpen).toBe(true)
      expect(result.current.isSyncProgressOpen).toBe(true)

      // But data should be reset
      expect(result.current.syncPreview).toBeNull()
      expect(result.current.syncResult).toBeNull()
      expect(result.current.syncError).toBeNull()
      expect(result.current.syncStatus).toBe('idle')
    })
  })
})
