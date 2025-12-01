import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWorktreeMutations } from '@/hooks/useWorktreeMutations'
import { executionsApi } from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    deleteWorktree: vi.fn(),
  },
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useWorktreeMutations', () => {
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

  describe('deleteWorktree', () => {
    it('should delete worktree successfully', async () => {
      vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(undefined as any)
      vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useWorktreeMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteWorktree({ executionId: 'exec-123' })
      })

      expect(executionsApi.deleteWorktree).toHaveBeenCalledWith('exec-123', undefined)
    })

    it('should delete worktree with deleteBranch option', async () => {
      vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useWorktreeMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteWorktree({ executionId: 'exec-123', deleteBranch: true })
      })

      expect(executionsApi.deleteWorktree).toHaveBeenCalledWith('exec-123', true)
    })

    it('should invalidate worktrees and executions caches on success', async () => {
      vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(undefined as any)

      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useWorktreeMutations(), { wrapper })

      await act(async () => {
        await result.current.deleteWorktree({ executionId: 'exec-123' })
      })

      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['worktrees'] })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['executions'] })
    })

    it('should show error toast on failure', async () => {
      const { toast } = await import('sonner')
      const error = new Error('Delete failed')
      vi.mocked(executionsApi.deleteWorktree).mockRejectedValue(error)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useWorktreeMutations(), { wrapper })

      await act(async () => {
        try {
          await result.current.deleteWorktree({ executionId: 'exec-123' })
        } catch {
          // Expected to throw
        }
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to delete worktree')
      })
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should track pending state correctly', async () => {
      vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useWorktreeMutations(), { wrapper })

      expect(result.current.isDeletingWorktree).toBe(false)

      await act(async () => {
        await result.current.deleteWorktree({ executionId: 'exec-123' })
      })

      // After completion, should be false
      expect(result.current.isDeletingWorktree).toBe(false)
    })
  })
})
