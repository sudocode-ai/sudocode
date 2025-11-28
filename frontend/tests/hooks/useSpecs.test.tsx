import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSpecs, useSpec } from '@/hooks/useSpecs'
import { specsApi } from '@/lib/api'
import type { Spec } from '@/types/api'
import React from 'react'

// Mock Project context - use a mutable ref so tests can change the projectId
let mockProjectId: string | null = 'test-project-id'

// Mock the API module - getCurrentProjectId needs to return mockProjectId
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: () => mockProjectId,
  specsApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getFeedback: vi.fn(),
  },
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
    lastMessage: null,
  }),
}))

vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({
    currentProjectId: mockProjectId,
    setCurrentProjectId: vi.fn(),
    currentProject: null,
    setCurrentProject: vi.fn(),
    clearProject: vi.fn(),
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
    mockProjectId = 'test-project-id' // Reset to default
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
        parent_id: undefined,
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
        parent_id: undefined,
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
      parent_id: undefined,
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
      parent_id: undefined,
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

  it('should archive a spec', async () => {
    const archivedSpec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Archived Spec',
      content: 'Content',
      file_path: '/path/to/spec1.md',
      priority: 1,
      archived: true,
      archived_at: '2024-01-01T12:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T12:00:00Z',
      parent_id: undefined,
    }

    vi.mocked(specsApi.getAll).mockResolvedValue([])
    vi.mocked(specsApi.update).mockResolvedValue(archivedSpec)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.archiveSpec('SPEC-001')

    await waitFor(() => {
      expect(specsApi.update).toHaveBeenCalledWith('SPEC-001', {
        archived: true,
      })
    })
  })

  it('should unarchive a spec', async () => {
    const unarchivedSpec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Unarchived Spec',
      content: 'Content',
      file_path: '/path/to/spec1.md',
      priority: 1,
      archived: false,
      archived_at: undefined,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T12:00:00Z',
      parent_id: undefined,
    }

    vi.mocked(specsApi.getAll).mockResolvedValue([])
    vi.mocked(specsApi.update).mockResolvedValue(unarchivedSpec)

    const { result } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.unarchiveSpec('SPEC-001')

    await waitFor(() => {
      expect(specsApi.update).toHaveBeenCalledWith('SPEC-001', {
        archived: false,
      })
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
    mockProjectId = 'test-project-id' // Reset to default
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
      parent_id: undefined,
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

describe('useSpecs - Project Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should not fetch specs when projectId is null', async () => {
    mockProjectId = null
    const mockSpecs: Spec[] = [
      {
        id: 'SPEC-001',
        uuid: 'uuid-1',
        title: 'Test Spec',
        content: 'Test content',
        file_path: '/path/to/spec.md',
        priority: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        parent_id: undefined,
      },
    ]
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSpecs(), { wrapper })

    // Should not be loading because query is disabled
    expect(result.current.isLoading).toBe(false)
    expect(result.current.specs).toEqual([])
    expect(specsApi.getAll).not.toHaveBeenCalled()
  })

  it('should include projectId in query key for cache separation', async () => {
    const projectASpecs: Spec[] = [
      {
        id: 'PROJECT-A-SPEC',
        uuid: 'uuid-a',
        title: 'Project A Spec',
        content: 'Content A',
        file_path: '/path/to/spec-a.md',
        priority: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        parent_id: undefined,
      },
    ]
    const projectBSpecs: Spec[] = [
      {
        id: 'PROJECT-B-SPEC',
        uuid: 'uuid-b',
        title: 'Project B Spec',
        content: 'Content B',
        file_path: '/path/to/spec-b.md',
        priority: 2,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        parent_id: undefined,
      },
    ]

    // Create a shared query client to test cache separation
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity, // Keep cache for testing
          staleTime: Infinity,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    // Fetch specs for Project A
    mockProjectId = 'project-a'
    vi.mocked(specsApi.getAll).mockResolvedValue(projectASpecs)

    const { result: resultA, unmount: unmountA } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(resultA.current.isLoading).toBe(false)
    })

    expect(resultA.current.specs).toEqual(projectASpecs)
    unmountA()

    // Switch to Project B
    mockProjectId = 'project-b'
    vi.mocked(specsApi.getAll).mockResolvedValue(projectBSpecs)

    const { result: resultB } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(resultB.current.isLoading).toBe(false)
    })

    // Should have fetched new data for Project B, not used Project A's cache
    expect(resultB.current.specs).toEqual(projectBSpecs)
    expect(specsApi.getAll).toHaveBeenCalledTimes(2)
  })

  it('should refetch when projectId changes', async () => {
    const mockSpecs: Spec[] = [
      {
        id: 'SPEC-001',
        uuid: 'uuid-1',
        title: 'Test Spec',
        content: 'Test content',
        file_path: '/path/to/spec.md',
        priority: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        parent_id: undefined,
      },
    ]
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    mockProjectId = 'project-1'
    const { result, rerender } = renderHook(() => useSpecs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(specsApi.getAll).toHaveBeenCalledTimes(1)

    // Change project
    mockProjectId = 'project-2'
    rerender()

    await waitFor(() => {
      expect(specsApi.getAll).toHaveBeenCalledTimes(2)
    })
  })
})

describe('useSpec - Project Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should not fetch spec when projectId is null', async () => {
    mockProjectId = null
    const mockSpec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Test Spec',
      content: 'Test content',
      file_path: '/path/to/spec.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: undefined,
    }
    vi.mocked(specsApi.getById).mockResolvedValue(mockSpec)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSpec('SPEC-001'), { wrapper })

    expect(result.current.spec).toBeUndefined()
    expect(specsApi.getById).not.toHaveBeenCalled()
  })

  it('should include projectId in query key', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          staleTime: Infinity,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    // Fetch spec for Project A
    mockProjectId = 'project-a'
    const specA: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Spec from Project A',
      content: 'Content A',
      file_path: '/path/to/spec.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: undefined,
    }
    vi.mocked(specsApi.getById).mockResolvedValue(specA)

    const { result: resultA, unmount: unmountA } = renderHook(
      () => useSpec('SPEC-001'),
      { wrapper }
    )

    await waitFor(() => {
      expect(resultA.current.isLoading).toBe(false)
    })

    expect(resultA.current.spec).toEqual(specA)
    unmountA()

    // Switch to Project B - same spec ID but different project
    mockProjectId = 'project-b'
    const specB: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Spec from Project B',
      content: 'Content B',
      file_path: '/path/to/spec.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: undefined,
    }
    vi.mocked(specsApi.getById).mockResolvedValue(specB)

    const { result: resultB } = renderHook(() => useSpec('SPEC-001'), { wrapper })

    await waitFor(() => {
      expect(resultB.current.isLoading).toBe(false)
    })

    // Should have fetched new data, not used cached data from Project A
    expect(resultB.current.spec).toEqual(specB)
    expect(specsApi.getById).toHaveBeenCalledTimes(2)
  })
})
