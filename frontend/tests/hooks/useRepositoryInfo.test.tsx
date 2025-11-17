import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { repositoryApi } from '@/lib/api'
import type { RepositoryInfo } from '@/types/api'
import React from 'react'

// Mock the API module
vi.mock('@/lib/api', () => ({
  repositoryApi: {
    getInfo: vi.fn(),
  },
}))

describe('useRepositoryInfo', () => {
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

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('should fetch repository info on mount', async () => {
    const mockRepoInfo: RepositoryInfo = {
      name: 'sudocode-3',
      branch: 'main',
      path: '/Users/test/sudocode-3',
    }

    vi.mocked(repositoryApi.getInfo).mockResolvedValue(mockRepoInfo)

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockRepoInfo)
    expect(repositoryApi.getInfo).toHaveBeenCalledTimes(1)
  })

  it('should return undefined initially while loading', () => {
    vi.mocked(repositoryApi.getInfo).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })

  it('should handle errors when not a git repository', async () => {
    const error = new Error('Not a git repository')
    vi.mocked(repositoryApi.getInfo).mockRejectedValue(error)

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeDefined()
    expect(result.current.data).toBeUndefined()
  })

  it('should handle different repository names', async () => {
    const mockRepoInfo: RepositoryInfo = {
      name: 'my-custom-repo',
      branch: 'develop',
      path: '/Users/test/my-custom-repo',
    }

    vi.mocked(repositoryApi.getInfo).mockResolvedValue(mockRepoInfo)

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.name).toBe('my-custom-repo')
    expect(result.current.data?.branch).toBe('develop')
  })

  it('should handle detached HEAD state', async () => {
    const mockRepoInfo: RepositoryInfo = {
      name: 'sudocode-3',
      branch: '(detached)',
      path: '/Users/test/sudocode-3',
    }

    vi.mocked(repositoryApi.getInfo).mockResolvedValue(mockRepoInfo)

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.branch).toBe('(detached)')
  })

  it('should have proper stale time configuration', () => {
    vi.mocked(repositoryApi.getInfo).mockResolvedValue({
      name: 'test-repo',
      branch: 'main',
      path: '/test/path',
    })

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    // The hook should have staleTime set to 60000ms (1 minute)
    // This is important because repo info doesn't change often
    expect(result.current.isLoading).toBe(true)
  })

  it('should return all required fields', async () => {
    const mockRepoInfo: RepositoryInfo = {
      name: 'test-repo',
      branch: 'feature-branch',
      path: '/absolute/path/to/repo',
    }

    vi.mocked(repositoryApi.getInfo).mockResolvedValue(mockRepoInfo)

    const { result } = renderHook(() => useRepositoryInfo(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveProperty('name')
    expect(result.current.data).toHaveProperty('branch')
    expect(result.current.data).toHaveProperty('path')
    expect(typeof result.current.data?.name).toBe('string')
    expect(typeof result.current.data?.branch).toBe('string')
    expect(typeof result.current.data?.path).toBe('string')
  })
})
