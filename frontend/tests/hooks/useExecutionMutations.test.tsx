import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useExecutionMutations } from '@/hooks/useExecutionMutations'
import { executionsApi } from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    delete: vi.fn(),
  },
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useExecutionMutations', () => {
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

  describe('deleteExecution', () => {
    it('should delete execution successfully', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123' })
      })

      expect(executionsApi.delete).toHaveBeenCalledWith('exec-123', undefined, undefined)
    })

    it('should delete execution with deleteBranch option', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123', deleteBranch: true })
      })

      expect(executionsApi.delete).toHaveBeenCalledWith('exec-123', true, undefined)
    })

    it('should delete execution with deleteWorktree option', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123', deleteWorktree: true })
      })

      expect(executionsApi.delete).toHaveBeenCalledWith('exec-123', undefined, true)
    })

    it('should delete execution with both deleteBranch and deleteWorktree options', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({
          executionId: 'exec-123',
          deleteBranch: true,
          deleteWorktree: true,
        })
      })

      expect(executionsApi.delete).toHaveBeenCalledWith('exec-123', true, true)
    })

    it('should invalidate executions cache on success', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123' })
      })

      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['executions'] })
    })

    it('should invalidate worktrees cache when deleteWorktree is true', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123', deleteWorktree: true })
      })

      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['executions'] })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['worktrees'] })
    })

    it('should NOT invalidate worktrees cache when deleteWorktree is false', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123', deleteWorktree: false })
      })

      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['executions'] })
      expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({ queryKey: ['worktrees'] })
    })

    it('should show error toast on failure', async () => {
      const { toast } = await import('sonner')
      const error = new Error('Delete failed')
      vi.mocked(executionsApi.delete).mockRejectedValue(error)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      await act(async () => {
        try {
          await result.current.deleteExecution({ executionId: 'exec-123' })
        } catch {
          // Expected to throw
        }
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to delete execution')
      })
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should track pending state correctly', async () => {
      vi.mocked(executionsApi.delete).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useExecutionMutations(), { wrapper })

      expect(result.current.isDeletingExecution).toBe(false)

      await act(async () => {
        await result.current.deleteExecution({ executionId: 'exec-123' })
      })

      // After completion, should be false
      expect(result.current.isDeletingExecution).toBe(false)
    })
  })
})
