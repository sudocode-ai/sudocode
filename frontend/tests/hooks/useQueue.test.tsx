import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useQueue, useQueueMutations, groupQueueByStack } from '@/hooks/useQueue'
import { queueApi } from '@/lib/api'
import type { QueueListResponse, EnrichedQueueEntry, ReorderResponse } from '@/types/queue'
import { createElement, type ReactNode } from 'react'

// Mock Project context
let mockProjectId: string | null = 'test-project-id'

// Mock the API
vi.mock('@/lib/api', () => ({
  queueApi: {
    getAll: vi.fn(),
    reorder: vi.fn(),
    getStats: vi.fn(),
  },
  getCurrentProjectId: () => mockProjectId,
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

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
  }),
}))

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

const mockQueueEntry1: EnrichedQueueEntry = {
  id: 'q-001',
  executionId: 'exec-001',
  streamId: 'stream-001',
  targetBranch: 'main',
  position: 1,
  priority: 10,
  status: 'pending',
  addedAt: Date.now(),
  issueId: 'i-001',
  issueTitle: 'Test Issue 1',
  stackId: 'stk-001',
  stackName: 'Test Stack',
  stackDepth: 0,
  dependencies: [],
  canPromote: false,
}

const mockQueueEntry2: EnrichedQueueEntry = {
  id: 'q-002',
  executionId: 'exec-002',
  streamId: 'stream-002',
  targetBranch: 'main',
  position: 2,
  priority: 20,
  status: 'ready',
  addedAt: Date.now(),
  issueId: 'i-002',
  issueTitle: 'Test Issue 2',
  stackId: 'stk-001',
  stackName: 'Test Stack',
  stackDepth: 1,
  dependencies: ['i-001'],
  canPromote: true,
}

const mockStandaloneEntry: EnrichedQueueEntry = {
  id: 'q-003',
  executionId: 'exec-003',
  streamId: 'stream-003',
  targetBranch: 'main',
  position: 3,
  priority: 30,
  status: 'pending',
  addedAt: Date.now(),
  issueId: 'i-003',
  issueTitle: 'Standalone Issue',
  stackDepth: 0,
  dependencies: [],
  canPromote: false,
}

const mockQueueResponse: QueueListResponse = {
  entries: [mockQueueEntry1, mockQueueEntry2, mockStandaloneEntry],
  stats: {
    total: 3,
    byStatus: {
      pending: 2,
      ready: 1,
      merging: 0,
      merged: 0,
      failed: 0,
      cancelled: 0,
    },
    byStack: {
      'stk-001': 2,
      standalone: 1,
    },
  },
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should fetch and return queue data', async () => {
    vi.mocked(queueApi.getAll).mockResolvedValue(mockQueueResponse)

    const { result } = renderHook(() => useQueue(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockQueueResponse)
    expect(result.current.entries).toHaveLength(3)
    expect(result.current.stats?.total).toBe(3)
  })

  it('should handle error state', async () => {
    const error = new Error('Failed to fetch queue')
    vi.mocked(queueApi.getAll).mockRejectedValue(error)

    const { result } = renderHook(() => useQueue(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
  })

  it('should not fetch when projectId is null', async () => {
    mockProjectId = null
    vi.mocked(queueApi.getAll).mockResolvedValue(mockQueueResponse)

    const { result } = renderHook(() => useQueue(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(queueApi.getAll).not.toHaveBeenCalled()
  })

  it('should pass filter options to API', async () => {
    vi.mocked(queueApi.getAll).mockResolvedValue(mockQueueResponse)

    const { result } = renderHook(
      () =>
        useQueue({
          targetBranch: 'develop',
          status: ['pending', 'ready'],
          includeMerged: true,
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(queueApi.getAll).toHaveBeenCalledWith({
      targetBranch: 'develop',
      status: ['pending', 'ready'],
      includeMerged: true,
    })
  })

  it('should return empty entries array when no data', async () => {
    const emptyResponse: QueueListResponse = {
      entries: [],
      stats: {
        total: 0,
        byStatus: {
          pending: 0,
          ready: 0,
          merging: 0,
          merged: 0,
          failed: 0,
          cancelled: 0,
        },
        byStack: {},
      },
    }
    vi.mocked(queueApi.getAll).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useQueue(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.entries).toEqual([])
  })
})

describe('useQueueMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should reorder a queue entry', async () => {
    const reorderResponse: ReorderResponse = {
      new_order: ['exec-002', 'exec-001', 'exec-003'],
    }
    vi.mocked(queueApi.reorder).mockResolvedValue(reorderResponse)

    const { result } = renderHook(() => useQueueMutations(), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.reorder({
        executionId: 'exec-001',
        newPosition: 2,
      })
    })

    await waitFor(() => {
      expect(result.current.isReordering).toBe(false)
    })

    expect(queueApi.reorder).toHaveBeenCalledWith('exec-001', 2, undefined)
  })

  it('should pass target branch to reorder API', async () => {
    const reorderResponse: ReorderResponse = {
      new_order: ['exec-002', 'exec-001'],
    }
    vi.mocked(queueApi.reorder).mockResolvedValue(reorderResponse)

    const { result } = renderHook(() => useQueueMutations(), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.reorder({
        executionId: 'exec-001',
        newPosition: 2,
        targetBranch: 'develop',
      })
    })

    await waitFor(() => {
      expect(result.current.isReordering).toBe(false)
    })

    expect(queueApi.reorder).toHaveBeenCalledWith('exec-001', 2, 'develop')
  })

  it('should track isReordering state', async () => {
    let resolveReorder: (value: ReorderResponse) => void
    const reorderPromise = new Promise<ReorderResponse>((resolve) => {
      resolveReorder = resolve
    })
    vi.mocked(queueApi.reorder).mockReturnValue(reorderPromise)

    const { result } = renderHook(() => useQueueMutations(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isReordering).toBe(false)

    act(() => {
      result.current.reorder({
        executionId: 'exec-001',
        newPosition: 2,
      })
    })

    await waitFor(() => {
      expect(result.current.isReordering).toBe(true)
    })

    // Resolve the promise
    resolveReorder!({ new_order: ['exec-002', 'exec-001'] })

    await waitFor(() => {
      expect(result.current.isReordering).toBe(false)
    })
  })

  it('should handle reorder error', async () => {
    const error = new Error('Dependency violation')
    vi.mocked(queueApi.reorder).mockRejectedValue(error)

    const { result } = renderHook(() => useQueueMutations(), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.reorder({
        executionId: 'exec-001',
        newPosition: 1,
      })
    })

    await waitFor(() => {
      expect(result.current.isReordering).toBe(false)
    })

    // Error toast should be called (mocked)
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Dependency violation')
  })

  it('should show warning toast when result has warning', async () => {
    const reorderResponse: ReorderResponse = {
      new_order: ['exec-002', 'exec-001'],
      warning: 'Some warning message',
    }
    vi.mocked(queueApi.reorder).mockResolvedValue(reorderResponse)

    const { result } = renderHook(() => useQueueMutations(), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.reorder({
        executionId: 'exec-001',
        newPosition: 2,
      })
    })

    await waitFor(() => {
      expect(result.current.isReordering).toBe(false)
    })

    const { toast } = await import('sonner')
    expect(toast.warning).toHaveBeenCalledWith('Some warning message')
  })
})

describe('groupQueueByStack', () => {
  it('should group entries by stack', () => {
    const entries: EnrichedQueueEntry[] = [mockQueueEntry1, mockQueueEntry2, mockStandaloneEntry]
    const groups = groupQueueByStack(entries)

    expect(groups).toHaveLength(2)

    // Stack group
    const stackGroup = groups.find((g) => g.stackId === 'stk-001')
    expect(stackGroup).toBeDefined()
    expect(stackGroup?.stackName).toBe('Test Stack')
    expect(stackGroup?.entries).toHaveLength(2)

    // Standalone group
    const standaloneGroup = groups.find((g) => g.stackId === null)
    expect(standaloneGroup).toBeDefined()
    expect(standaloneGroup?.entries).toHaveLength(1)
  })

  it('should handle empty entries', () => {
    const groups = groupQueueByStack([])
    expect(groups).toHaveLength(0)
  })

  it('should handle all standalone entries', () => {
    const entries: EnrichedQueueEntry[] = [mockStandaloneEntry]
    const groups = groupQueueByStack(entries)

    expect(groups).toHaveLength(1)
    expect(groups[0].stackId).toBeNull()
    expect(groups[0].entries).toHaveLength(1)
  })

  it('should sort stacks before standalone', () => {
    // Put standalone first in input
    const entries: EnrichedQueueEntry[] = [mockStandaloneEntry, mockQueueEntry1]
    const groups = groupQueueByStack(entries)

    // Stack should come first in output
    expect(groups[0].stackId).toBe('stk-001')
    expect(groups[1].stackId).toBeNull()
  })

  it('should sort stacks alphabetically by name', () => {
    const entryA: EnrichedQueueEntry = {
      ...mockQueueEntry1,
      id: 'q-a',
      stackId: 'stk-a',
      stackName: 'Stack A',
    }
    const entryB: EnrichedQueueEntry = {
      ...mockQueueEntry1,
      id: 'q-b',
      stackId: 'stk-b',
      stackName: 'Stack B',
    }

    const groups = groupQueueByStack([entryB, entryA]) // Input in reverse order

    expect(groups[0].stackName).toBe('Stack A')
    expect(groups[1].stackName).toBe('Stack B')
  })
})
