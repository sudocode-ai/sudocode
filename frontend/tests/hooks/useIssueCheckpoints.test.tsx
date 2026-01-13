import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useIssueCheckpoints,
  useCurrentCheckpoint,
  useReviewCheckpoint,
} from '@/hooks/useIssueCheckpoints'
import { issuesApi } from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  issuesApi: {
    getCheckpoints: vi.fn(),
    getCurrentCheckpoint: vi.fn(),
    reviewCheckpoint: vi.fn(),
  },
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useIssueCheckpoints hooks', () => {
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

  describe('useIssueCheckpoints', () => {
    it('should fetch checkpoints for an issue', async () => {
      const mockCheckpoints = {
        checkpoints: [
          {
            id: 'cp-1',
            issue_id: 'i-test',
            execution_id: 'exec-1',
            stream_id: 'stream-1',
            commit_sha: 'abc123',
            changed_files: 3,
            additions: 50,
            deletions: 10,
            message: 'First checkpoint',
            checkpointed_at: '2024-01-01T00:00:00Z',
            review_status: 'pending' as const,
          },
        ],
        current: {
          id: 'cp-1',
          issue_id: 'i-test',
          execution_id: 'exec-1',
          stream_id: 'stream-1',
          commit_sha: 'abc123',
          changed_files: 3,
          additions: 50,
          deletions: 10,
          message: 'First checkpoint',
          checkpointed_at: '2024-01-01T00:00:00Z',
          review_status: 'pending' as const,
        },
      }

      vi.mocked(issuesApi.getCheckpoints).mockResolvedValue(mockCheckpoints)

      const { result } = renderHook(() => useIssueCheckpoints('i-test'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockCheckpoints)
      expect(issuesApi.getCheckpoints).toHaveBeenCalledWith('i-test')
    })

    it('should not fetch when issueId is null', () => {
      renderHook(() => useIssueCheckpoints(null), { wrapper })

      expect(issuesApi.getCheckpoints).not.toHaveBeenCalled()
    })

    it('should not fetch when issueId is undefined', () => {
      renderHook(() => useIssueCheckpoints(undefined), { wrapper })

      expect(issuesApi.getCheckpoints).not.toHaveBeenCalled()
    })
  })

  describe('useCurrentCheckpoint', () => {
    it('should fetch current checkpoint for an issue', async () => {
      const mockCheckpoint = {
        id: 'cp-1',
        issue_id: 'i-test',
        execution_id: 'exec-1',
        stream_id: 'stream-1',
        commit_sha: 'abc123',
        changed_files: 3,
        additions: 50,
        deletions: 10,
        message: 'Current checkpoint',
        checkpointed_at: '2024-01-01T00:00:00Z',
        review_status: 'approved' as const,
      }

      vi.mocked(issuesApi.getCurrentCheckpoint).mockResolvedValue(mockCheckpoint)

      const { result } = renderHook(() => useCurrentCheckpoint('i-test'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockCheckpoint)
      expect(issuesApi.getCurrentCheckpoint).toHaveBeenCalledWith('i-test')
    })

    it('should not fetch when issueId is null', () => {
      renderHook(() => useCurrentCheckpoint(null), { wrapper })

      expect(issuesApi.getCurrentCheckpoint).not.toHaveBeenCalled()
    })
  })

  describe('useReviewCheckpoint', () => {
    it('should approve a checkpoint', async () => {
      const mockResponse = {
        issue_id: 'i-test',
        checkpoint_id: 'cp-1',
        review_status: 'approved' as const,
        reviewed_at: '2024-01-01T00:00:00Z',
        reviewed_by: 'user-1',
      }

      vi.mocked(issuesApi.reviewCheckpoint).mockResolvedValue(mockResponse)

      const { result } = renderHook(() => useReviewCheckpoint(), { wrapper })

      act(() => {
        result.current.mutate({
          issueId: 'i-test',
          action: 'approve',
          reviewed_by: 'user-1',
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(issuesApi.reviewCheckpoint).toHaveBeenCalledWith('i-test', {
        action: 'approve',
        reviewed_by: 'user-1',
      })
    })

    it('should request changes on a checkpoint', async () => {
      const mockResponse = {
        issue_id: 'i-test',
        checkpoint_id: 'cp-1',
        review_status: 'changes_requested' as const,
        reviewed_at: '2024-01-01T00:00:00Z',
        review_notes: 'Please add tests',
      }

      vi.mocked(issuesApi.reviewCheckpoint).mockResolvedValue(mockResponse)

      const { result } = renderHook(() => useReviewCheckpoint(), { wrapper })

      act(() => {
        result.current.mutate({
          issueId: 'i-test',
          action: 'request_changes',
          notes: 'Please add tests',
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(issuesApi.reviewCheckpoint).toHaveBeenCalledWith('i-test', {
        action: 'request_changes',
        notes: 'Please add tests',
      })
    })

    it('should reset review status', async () => {
      const mockResponse = {
        issue_id: 'i-test',
        checkpoint_id: 'cp-1',
        review_status: 'pending' as const,
        reviewed_at: '2024-01-01T00:00:00Z',
      }

      vi.mocked(issuesApi.reviewCheckpoint).mockResolvedValue(mockResponse)

      const { result } = renderHook(() => useReviewCheckpoint(), { wrapper })

      act(() => {
        result.current.mutate({
          issueId: 'i-test',
          action: 'reset',
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(issuesApi.reviewCheckpoint).toHaveBeenCalledWith('i-test', {
        action: 'reset',
      })
    })

    it('should handle review errors', async () => {
      const error = new Error('Review failed')
      vi.mocked(issuesApi.reviewCheckpoint).mockRejectedValue(error)

      const { result } = renderHook(() => useReviewCheckpoint(), { wrapper })

      act(() => {
        result.current.mutate({
          issueId: 'i-test',
          action: 'approve',
        })
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toEqual(error)
    })
  })
})
