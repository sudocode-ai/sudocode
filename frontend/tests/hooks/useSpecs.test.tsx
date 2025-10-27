import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSpecs, useSpec } from '@/hooks/useSpecs'
import { specsApi } from '@/lib/api'
import type { Spec } from '@/types/api'
import React from 'react'

// Mock the API module
vi.mock('@/lib/api', () => ({
  specsApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getFeedback: vi.fn(),
  },
}))

// Mock WebSocket hook
vi.mock('@/lib/websocket', () => ({
  useWebSocket: () => ({
    connected: false,
    subscribe: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

describe('useSpecs', () => {
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

  it('should fetch specs on mount', async () => {
    const mockSpecs: Spec[] = [
      {
        id: 'SPEC-001',
        uuid: 'uuid-1',
        title: 'Test Spec 1',
        content: 'Content 1',
        file_path: '/path/to/spec1.md',
        priority: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        parent_id: null,
      },
      {
        id: 'SPEC-002',
        uuid: 'uuid-2',
        title: 'Test Spec 2',
        content: 'Content 2',
        file_path: '/path/to/spec2.md',
        priority: 2,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        parent_id: null,
      },
    ]

    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.specs).toEqual(mockSpecs)
    expect(specsApi.getAll).toHaveBeenCalledTimes(1)
  })

  it('should return empty array initially', () => {
    vi.mocked(specsApi.getAll).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    const { result } = renderHook(() => useSpecs(), { wrapper })

    expect(result.current.specs).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('should handle errors', async () => {
    const error = new Error('Failed to fetch specs')
    vi.mocked(specsApi.getAll).mockRejectedValue(error)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeDefined()
  })

  it('should create a spec', async () => {
    const newSpec: Spec = {
      id: 'SPEC-003',
      uuid: 'uuid-3',
      title: 'New Spec',
      content: 'New content',
      file_path: '/path/to/spec3.md',
      priority: 1,
      created_at: '2024-01-03T00:00:00Z',
      updated_at: '2024-01-03T00:00:00Z',
      parent_id: null,
    }

    vi.mocked(specsApi.getAll).mockResolvedValue([])
    vi.mocked(specsApi.create).mockResolvedValue(newSpec)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.createSpec({
      title: 'New Spec',
      content: 'New content',
      priority: 1,
    })

    await waitFor(() => {
      expect(specsApi.create).toHaveBeenCalledWith(
        {
          title: 'New Spec',
          content: 'New content',
          priority: 1,
        },
        expect.any(Object)
      )
    })
  })

  it('should update a spec', async () => {
    const updatedSpec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Updated Spec',
      content: 'Updated content',
      file_path: '/path/to/spec1.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T12:00:00Z',
      parent_id: null,
    }

    vi.mocked(specsApi.getAll).mockResolvedValue([])
    vi.mocked(specsApi.update).mockResolvedValue(updatedSpec)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.updateSpec({
      id: 'SPEC-001',
      data: { title: 'Updated Spec' },
    })

    await waitFor(() => {
      expect(specsApi.update).toHaveBeenCalledWith('SPEC-001', {
        title: 'Updated Spec',
      })
    })
  })

  it('should delete a spec', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue([])
    vi.mocked(specsApi.delete).mockResolvedValue(undefined as any)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.deleteSpec('SPEC-001')

    await waitFor(() => {
      expect(specsApi.delete).toHaveBeenCalledWith('SPEC-001', expect.any(Object))
    })
  })
})

describe('useSpec', () => {
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

  it('should fetch a single spec', async () => {
    const mockSpec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Test Spec',
      content: 'Test content',
      file_path: '/path/to/spec.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: null,
    }

    vi.mocked(specsApi.getById).mockResolvedValue(mockSpec)

    const { result } = renderHook(() => useSpec('SPEC-001'), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.spec).toEqual(mockSpec)
    expect(specsApi.getById).toHaveBeenCalledWith('SPEC-001')
  })

  it('should not fetch if id is empty', () => {
    const { result } = renderHook(() => useSpec(''), { wrapper })

    expect(result.current.spec).toBeUndefined()
    expect(specsApi.getById).not.toHaveBeenCalled()
  })

  it('should handle errors when fetching spec', async () => {
    const error = new Error('Spec not found')
    vi.mocked(specsApi.getById).mockRejectedValue(error)

    const { result } = renderHook(() => useSpec('SPEC-999'), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeDefined()
  })
})
