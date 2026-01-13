import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePromote } from '@/hooks/usePromote'
import { issuesApi } from '@/lib/api'
import type { PromoteResult } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  issuesApi: {
    promote: vi.fn(),
  },
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe('usePromote', () => {
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
      const { result } = renderHook(() => usePromote(), { wrapper })

      expect(result.current.promoteStatus).toBe('idle')
      expect(result.current.promoteResult).toBeNull()
      expect(result.current.promoteError).toBeNull()
      expect(result.current.isPromoteDialogOpen).toBe(false)
      expect(result.current.isPromoting).toBe(false)
    })
  })

  describe('Dialog Controls', () => {
    it('should open promote dialog', () => {
      const { result } = renderHook(() => usePromote(), { wrapper })

      act(() => {
        result.current.openPromoteDialog()
      })

      expect(result.current.isPromoteDialogOpen).toBe(true)
    })

    it('should close promote dialog and reset state', () => {
      const { result } = renderHook(() => usePromote(), { wrapper })

      // Open dialog first
      act(() => {
        result.current.openPromoteDialog()
      })

      // Close dialog
      act(() => {
        result.current.closePromoteDialog()
      })

      expect(result.current.isPromoteDialogOpen).toBe(false)
      expect(result.current.promoteResult).toBeNull()
      expect(result.current.promoteError).toBeNull()
      expect(result.current.promoteStatus).toBe('idle')
    })

    it('should reset promote state without closing dialog', () => {
      const { result } = renderHook(() => usePromote(), { wrapper })

      act(() => {
        result.current.openPromoteDialog()
        result.current.resetPromoteState()
      })

      expect(result.current.isPromoteDialogOpen).toBe(true)
      expect(result.current.promoteResult).toBeNull()
      expect(result.current.promoteError).toBeNull()
      expect(result.current.promoteStatus).toBe('idle')
    })
  })

  describe('Successful Promote', () => {
    it('should promote successfully', async () => {
      const mockResult: PromoteResult = {
        success: true,
        merge_commit: 'abc123def',
        files_changed: 5,
        additions: 100,
        deletions: 20,
      }

      vi.mocked(issuesApi.promote).mockResolvedValue(mockResult)

      const onSuccess = vi.fn()
      const { result } = renderHook(() => usePromote({ onSuccess }), { wrapper })

      act(() => {
        result.current.performPromote('i-test', { strategy: 'squash' })
      })

      // Should transition to promoting state and then to success
      await waitFor(() => {
        expect(result.current.promoteStatus).toBe('success')
      })

      expect(result.current.promoteResult).toEqual(mockResult)
      expect(onSuccess).toHaveBeenCalledWith(mockResult)
      expect(issuesApi.promote).toHaveBeenCalledWith('i-test', { strategy: 'squash' })
    })
  })

  describe('Blocked Promote', () => {
    it('should handle blocked by dependencies', async () => {
      const mockResult: PromoteResult = {
        success: false,
        blocked_by: ['i-parent1', 'i-parent2'],
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      vi.mocked(issuesApi.promote).mockResolvedValue(mockResult)

      const onBlocked = vi.fn()
      const { result } = renderHook(() => usePromote({ onBlocked }), { wrapper })

      act(() => {
        result.current.performPromote('i-test')
      })

      await waitFor(() => {
        expect(result.current.promoteStatus).toBe('blocked')
      })

      expect(result.current.promoteResult).toEqual(mockResult)
      expect(onBlocked).toHaveBeenCalledWith(['i-parent1', 'i-parent2'])
    })
  })

  describe('Requires Approval', () => {
    it('should handle requires approval', async () => {
      const mockResult: PromoteResult = {
        success: false,
        requires_approval: true,
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      vi.mocked(issuesApi.promote).mockResolvedValue(mockResult)

      const onRequiresApproval = vi.fn()
      const { result } = renderHook(() => usePromote({ onRequiresApproval }), { wrapper })

      act(() => {
        result.current.performPromote('i-test')
      })

      await waitFor(() => {
        expect(result.current.promoteStatus).toBe('requires_approval')
      })

      expect(onRequiresApproval).toHaveBeenCalled()
    })
  })

  describe('Conflicts', () => {
    it('should handle merge conflicts', async () => {
      const mockResult: PromoteResult = {
        success: false,
        conflicts: [
          { id: 'conflict-1', streamId: 'stream-1', path: 'src/file1.ts', detectedAt: Date.now() },
          { id: 'conflict-2', streamId: 'stream-1', path: 'src/file2.ts', detectedAt: Date.now() },
        ],
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      vi.mocked(issuesApi.promote).mockResolvedValue(mockResult)

      const onConflict = vi.fn()
      const { result } = renderHook(() => usePromote({ onConflict }), { wrapper })

      act(() => {
        result.current.performPromote('i-test')
      })

      await waitFor(() => {
        expect(result.current.promoteStatus).toBe('conflict')
      })

      expect(onConflict).toHaveBeenCalledWith(mockResult)
    })
  })

  describe('Error Handling', () => {
    it('should handle generic error from result', async () => {
      const mockResult: PromoteResult = {
        success: false,
        error: 'Something went wrong',
        files_changed: 0,
        additions: 0,
        deletions: 0,
      }

      vi.mocked(issuesApi.promote).mockResolvedValue(mockResult)

      const onError = vi.fn()
      const { result } = renderHook(() => usePromote({ onError }), { wrapper })

      act(() => {
        result.current.performPromote('i-test')
      })

      await waitFor(() => {
        expect(result.current.promoteStatus).toBe('error')
      })

      expect(result.current.promoteError).toBe('Something went wrong')
      expect(onError).toHaveBeenCalledWith('Something went wrong')
    })

    it('should handle API errors', async () => {
      const error = new Error('Network error')
      vi.mocked(issuesApi.promote).mockRejectedValue(error)

      const onError = vi.fn()
      const { result } = renderHook(() => usePromote({ onError }), { wrapper })

      act(() => {
        result.current.performPromote('i-test')
      })

      await waitFor(() => {
        expect(result.current.promoteStatus).toBe('error')
      })

      expect(result.current.promoteError).toBe('Network error')
      expect(onError).toHaveBeenCalledWith('Network error')
    })
  })
})
