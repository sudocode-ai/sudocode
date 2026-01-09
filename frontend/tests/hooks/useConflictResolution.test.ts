import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useConflictResolution } from '@/hooks/useConflictResolution'
import { executionsApi } from '@/lib/api'
import React from 'react'

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    getConflicts: vi.fn(),
    resolveConflict: vi.fn(),
    resolveAllConflicts: vi.fn(),
    retryAfterConflictResolution: vi.fn(),
  },
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe('useConflictResolution', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    queryClient.clear()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  it('should return empty conflicts when not initialized', () => {
    const { result } = renderHook(() => useConflictResolution(undefined), { wrapper })

    expect(result.current.conflicts).toEqual([])
    expect(result.current.hasUnresolved).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it('should fetch conflicts when execution ID is provided', async () => {
    const mockConflicts = {
      conflicts: [
        {
          id: 'conflict-1',
          execution_id: 'exec-123',
          path: 'src/test.ts',
          type: 'code' as const,
          auto_resolvable: false,
          detected_at: '2024-01-01T00:00:00Z',
        },
      ],
      hasUnresolved: true,
    }

    vi.mocked(executionsApi.getConflicts).mockResolvedValue(mockConflicts)

    const { result } = renderHook(() => useConflictResolution('exec-123'), { wrapper })

    await waitFor(() => {
      expect(result.current.conflicts).toHaveLength(1)
    })

    expect(result.current.conflicts[0].path).toBe('src/test.ts')
    expect(result.current.hasUnresolved).toBe(true)
  })

  it('should resolve a single conflict', async () => {
    const mockConflicts = {
      conflicts: [
        {
          id: 'conflict-1',
          execution_id: 'exec-123',
          path: 'src/test.ts',
          type: 'code' as const,
          auto_resolvable: false,
          detected_at: '2024-01-01T00:00:00Z',
        },
      ],
      hasUnresolved: true,
    }

    vi.mocked(executionsApi.getConflicts).mockResolvedValue(mockConflicts)
    vi.mocked(executionsApi.resolveConflict).mockResolvedValue({
      resolved: true,
      allResolved: true,
      remainingConflicts: 0,
    })

    const onAllResolved = vi.fn()
    const { result } = renderHook(
      () => useConflictResolution('exec-123', { onAllResolved }),
      { wrapper }
    )

    await waitFor(() => {
      expect(result.current.conflicts).toHaveLength(1)
    })

    // Resolve the conflict
    result.current.resolveConflict('conflict-1', 'ours')

    await waitFor(() => {
      expect(executionsApi.resolveConflict).toHaveBeenCalledWith('exec-123', 'conflict-1', 'ours')
    })
  })

  it('should resolve all conflicts', async () => {
    const mockConflicts = {
      conflicts: [
        {
          id: 'conflict-1',
          execution_id: 'exec-123',
          path: 'src/test.ts',
          type: 'code' as const,
          auto_resolvable: false,
          detected_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'conflict-2',
          execution_id: 'exec-123',
          path: 'src/test2.ts',
          type: 'code' as const,
          auto_resolvable: false,
          detected_at: '2024-01-01T00:00:00Z',
        },
      ],
      hasUnresolved: true,
    }

    vi.mocked(executionsApi.getConflicts).mockResolvedValue(mockConflicts)
    vi.mocked(executionsApi.resolveAllConflicts).mockResolvedValue({
      resolved: 2,
      failed: 0,
      allResolved: true,
    })

    const { result } = renderHook(() => useConflictResolution('exec-123'), { wrapper })

    await waitFor(() => {
      expect(result.current.conflicts).toHaveLength(2)
    })

    // Resolve all conflicts
    result.current.resolveAll('theirs')

    await waitFor(() => {
      expect(executionsApi.resolveAllConflicts).toHaveBeenCalledWith('exec-123', 'theirs')
    })
  })

  it('should separate resolved and unresolved conflicts', async () => {
    const mockConflicts = {
      conflicts: [
        {
          id: 'conflict-1',
          execution_id: 'exec-123',
          path: 'src/test.ts',
          type: 'code' as const,
          auto_resolvable: false,
          detected_at: '2024-01-01T00:00:00Z',
          resolved_at: '2024-01-01T01:00:00Z',
          resolution_strategy: 'ours',
        },
        {
          id: 'conflict-2',
          execution_id: 'exec-123',
          path: 'src/test2.ts',
          type: 'code' as const,
          auto_resolvable: false,
          detected_at: '2024-01-01T00:00:00Z',
        },
      ],
      hasUnresolved: true,
    }

    vi.mocked(executionsApi.getConflicts).mockResolvedValue(mockConflicts)

    const { result } = renderHook(() => useConflictResolution('exec-123'), { wrapper })

    await waitFor(() => {
      expect(result.current.conflicts).toHaveLength(2)
    })

    expect(result.current.resolvedConflicts).toHaveLength(1)
    expect(result.current.unresolvedConflicts).toHaveLength(1)
    expect(result.current.resolvedConflicts[0].path).toBe('src/test.ts')
    expect(result.current.unresolvedConflicts[0].path).toBe('src/test2.ts')
  })
})
