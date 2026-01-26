/**
 * Tests for useCheckpointDAG hooks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCheckpointDAG, useDiffStacks, useStackReview, useMergeQueue } from '@/hooks/useCheckpointDAG'
import { diffStacksApi, getCurrentProjectId } from '@/lib/api'
import type {
  DataplaneCheckpoint,
  DiffStackWithCheckpoints,
  CheckpointsResponse,
  MergeResult,
} from '@/types/checkpoint'

// Mock the API
vi.mock('@/lib/api', () => ({
  diffStacksApi: {
    listCheckpoints: vi.fn(),
    getCheckpointStats: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addCheckpoints: vi.fn(),
    removeCheckpoint: vi.fn(),
    reorderCheckpoints: vi.fn(),
    review: vi.fn(),
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    merge: vi.fn(),
  },
  getCurrentProjectId: vi.fn(),
}))

// Mock useProject hook
vi.mock('@/hooks/useProject', () => ({
  useProject: vi.fn(() => ({
    currentProjectId: 'test-project',
  })),
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: vi.fn(() => ({
    connected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
  })),
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('useCheckpointDAG hooks', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.clearAllMocks()
    vi.mocked(getCurrentProjectId).mockReturnValue('test-project')
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  // Test fixtures
  const mockCheckpoints: DataplaneCheckpoint[] = [
    {
      id: 'cp-1',
      streamId: 'stream-1',
      commitSha: 'abc123',
      parentCommit: null,
      originalCommit: null,
      changeId: 'change-1',
      message: 'First commit',
      createdAt: Date.now(),
      createdBy: 'user-1',
    },
    {
      id: 'cp-2',
      streamId: 'stream-1',
      commitSha: 'def456',
      parentCommit: 'abc123',
      originalCommit: null,
      changeId: 'change-2',
      message: 'Second commit',
      createdAt: Date.now(),
      createdBy: 'user-1',
    },
  ]

  const mockCheckpointsResponse: CheckpointsResponse = {
    checkpoints: mockCheckpoints,
    streams: [
      {
        id: 'stream-1',
        name: 'main-stream',
        agentId: 'agent-1',
        baseCommit: 'base123',
        parentStream: null,
        branchPointCommit: null,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  }

  const mockDiffStacks: DiffStackWithCheckpoints[] = [
    {
      id: 'stack-1',
      name: 'Test Stack',
      description: 'A test stack',
      targetBranch: 'main',
      reviewStatus: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      queuePosition: null,
      createdAt: Date.now(),
      createdBy: 'user-1',
      checkpoints: [
        { checkpointId: 'cp-1', position: 0 },
        { checkpointId: 'cp-2', position: 1 },
      ],
    },
  ]

  describe('useCheckpointDAG', () => {
    it('should have correct initial state', () => {
      vi.mocked(diffStacksApi.listCheckpoints).mockResolvedValue(mockCheckpointsResponse)
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)

      const { result } = renderHook(() => useCheckpointDAG(), { wrapper })

      expect(result.current.checkpoints).toEqual([])
      expect(result.current.streams).toEqual([])
      expect(result.current.diffStacks).toEqual([])
      expect(result.current.isLoading).toBe(true)
    })

    it('should fetch checkpoints and streams', async () => {
      vi.mocked(diffStacksApi.listCheckpoints).mockResolvedValue(mockCheckpointsResponse)
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)

      const { result } = renderHook(() => useCheckpointDAG(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.checkpoints).toEqual(mockCheckpointsResponse.checkpoints)
      expect(result.current.streams).toEqual(mockCheckpointsResponse.streams)
    })

    it('should fetch diff stacks', async () => {
      vi.mocked(diffStacksApi.listCheckpoints).mockResolvedValue(mockCheckpointsResponse)
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)

      const { result } = renderHook(() => useCheckpointDAG(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.diffStacks).toEqual(mockDiffStacks)
    })

    it('should handle errors', async () => {
      vi.mocked(diffStacksApi.listCheckpoints).mockRejectedValue(new Error('API Error'))
      vi.mocked(diffStacksApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useCheckpointDAG(), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toBeDefined()
    })

    it('should filter by issueId', async () => {
      vi.mocked(diffStacksApi.listCheckpoints).mockResolvedValue(mockCheckpointsResponse)
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)

      renderHook(() => useCheckpointDAG({ issueId: 'issue-123' }), { wrapper })

      await waitFor(() => {
        expect(diffStacksApi.listCheckpoints).toHaveBeenCalledWith({
          issueId: 'issue-123',
          streamId: undefined,
          includeStats: undefined,
        })
      })
    })

    it('should filter by streamId', async () => {
      vi.mocked(diffStacksApi.listCheckpoints).mockResolvedValue(mockCheckpointsResponse)
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)

      renderHook(() => useCheckpointDAG({ streamId: 'stream-1' }), { wrapper })

      await waitFor(() => {
        expect(diffStacksApi.listCheckpoints).toHaveBeenCalledWith({
          issueId: undefined,
          streamId: 'stream-1',
          includeStats: undefined,
        })
      })
    })
  })

  describe('useDiffStacks', () => {
    it('should have correct initial state', () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      expect(result.current.stacks).toEqual([])
      expect(result.current.isLoading).toBe(true)
    })

    it('should fetch stacks', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.stacks).toEqual(mockDiffStacks)
    })

    it('should create a stack', async () => {
      const newStack = { ...mockDiffStacks[0], id: 'stack-new' }
      vi.mocked(diffStacksApi.list).mockResolvedValue([])
      vi.mocked(diffStacksApi.create).mockResolvedValue(newStack)

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.createStack({
          name: 'New Stack',
          checkpointIds: ['cp-1', 'cp-2'],
        })
      })

      expect(diffStacksApi.create).toHaveBeenCalledWith({
        name: 'New Stack',
        checkpointIds: ['cp-1', 'cp-2'],
      })
    })

    it('should update a stack', async () => {
      const updatedStack = { ...mockDiffStacks[0], name: 'Updated Stack' }
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.update).mockResolvedValue(updatedStack)

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.updateStack({
          id: 'stack-1',
          data: { name: 'Updated Stack' },
        })
      })

      expect(diffStacksApi.update).toHaveBeenCalledWith('stack-1', { name: 'Updated Stack' })
    })

    it('should delete a stack', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.delete).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.deleteStack('stack-1')
      })

      expect(diffStacksApi.delete).toHaveBeenCalledWith('stack-1')
    })

    it('should add checkpoints to a stack', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.addCheckpoints).mockResolvedValue(mockDiffStacks[0])

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.addCheckpoints({
          stackId: 'stack-1',
          checkpointIds: ['cp-3'],
        })
      })

      expect(diffStacksApi.addCheckpoints).toHaveBeenCalledWith('stack-1', ['cp-3'])
    })

    it('should remove checkpoint from a stack', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.removeCheckpoint).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useDiffStacks(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.removeCheckpoint({
          stackId: 'stack-1',
          checkpointId: 'cp-1',
        })
      })

      expect(diffStacksApi.removeCheckpoint).toHaveBeenCalledWith('stack-1', 'cp-1')
    })
  })

  describe('useStackReview', () => {
    it('should fetch stack details', async () => {
      vi.mocked(diffStacksApi.get).mockResolvedValue(mockDiffStacks[0])

      const { result } = renderHook(() => useStackReview('stack-1'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.stack).toEqual(mockDiffStacks[0])
      expect(result.current.checkpoints).toEqual(mockDiffStacks[0].checkpoints)
    })

    it('should approve a stack', async () => {
      vi.mocked(diffStacksApi.get).mockResolvedValue(mockDiffStacks[0])
      vi.mocked(diffStacksApi.review).mockResolvedValue({ ...mockDiffStacks[0], reviewStatus: 'approved' })

      const { result } = renderHook(() => useStackReview('stack-1'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.approve('LGTM!')
      })

      expect(diffStacksApi.review).toHaveBeenCalledWith('stack-1', {
        status: 'approved',
        notes: 'LGTM!',
      })
    })

    it('should reject a stack', async () => {
      vi.mocked(diffStacksApi.get).mockResolvedValue(mockDiffStacks[0])
      vi.mocked(diffStacksApi.review).mockResolvedValue({ ...mockDiffStacks[0], reviewStatus: 'rejected' })

      const { result } = renderHook(() => useStackReview('stack-1'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.reject('Needs changes')
      })

      expect(diffStacksApi.review).toHaveBeenCalledWith('stack-1', {
        status: 'rejected',
        notes: 'Needs changes',
      })
    })

    it('should abandon a stack', async () => {
      vi.mocked(diffStacksApi.get).mockResolvedValue(mockDiffStacks[0])
      vi.mocked(diffStacksApi.review).mockResolvedValue({ ...mockDiffStacks[0], reviewStatus: 'abandoned' })

      const { result } = renderHook(() => useStackReview('stack-1'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.abandon('No longer needed')
      })

      expect(diffStacksApi.review).toHaveBeenCalledWith('stack-1', {
        status: 'abandoned',
        notes: 'No longer needed',
      })
    })

    it('should reset to pending', async () => {
      vi.mocked(diffStacksApi.get).mockResolvedValue({ ...mockDiffStacks[0], reviewStatus: 'approved' })
      vi.mocked(diffStacksApi.review).mockResolvedValue({ ...mockDiffStacks[0], reviewStatus: 'pending' })

      const { result } = renderHook(() => useStackReview('stack-1'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.resetToPending()
      })

      expect(diffStacksApi.review).toHaveBeenCalledWith('stack-1', {
        status: 'pending',
      })
    })
  })

  describe('useMergeQueue', () => {
    it('should fetch queued stacks', async () => {
      const queuedStacks = mockDiffStacks.map((s) => ({ ...s, queuePosition: 1 }))
      vi.mocked(diffStacksApi.list).mockResolvedValue(queuedStacks)

      const { result } = renderHook(() => useMergeQueue('main'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.queue).toEqual(queuedStacks)
    })

    it('should enqueue a stack', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue([])
      vi.mocked(diffStacksApi.enqueue).mockResolvedValue({ ...mockDiffStacks[0], queuePosition: 1 })

      const { result } = renderHook(() => useMergeQueue('main'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.enqueue('stack-1')
      })

      expect(diffStacksApi.enqueue).toHaveBeenCalledWith('stack-1', undefined)
    })

    it('should enqueue a stack at specific position', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue([])
      vi.mocked(diffStacksApi.enqueue).mockResolvedValue({ ...mockDiffStacks[0], queuePosition: 3 })

      const { result } = renderHook(() => useMergeQueue('main'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.enqueue('stack-1', 3)
      })

      expect(diffStacksApi.enqueue).toHaveBeenCalledWith('stack-1', 3)
    })

    it('should dequeue a stack', async () => {
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.dequeue).mockResolvedValue(undefined as any)

      const { result } = renderHook(() => useMergeQueue('main'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.dequeue('stack-1')
      })

      expect(diffStacksApi.dequeue).toHaveBeenCalledWith('stack-1')
    })

    it('should merge a stack', async () => {
      const mergeResult: MergeResult = {
        mergedCheckpoints: ['cp-1', 'cp-2'],
        skippedCheckpoints: [],
        targetBranch: 'main',
        mergeCommit: 'merge123',
        dryRun: false,
      }
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.merge).mockResolvedValue(mergeResult)

      const { result } = renderHook(() => useMergeQueue('main'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      let mergeResultReturned: MergeResult | undefined
      await act(async () => {
        mergeResultReturned = await result.current.merge('stack-1', false)
      })

      expect(diffStacksApi.merge).toHaveBeenCalledWith('stack-1', false)
      expect(mergeResultReturned).toEqual(mergeResult)
    })

    it('should perform dry run merge', async () => {
      const mergeResult: MergeResult = {
        mergedCheckpoints: ['cp-1', 'cp-2'],
        skippedCheckpoints: [],
        targetBranch: 'main',
        mergeCommit: null,
        dryRun: true,
      }
      vi.mocked(diffStacksApi.list).mockResolvedValue(mockDiffStacks)
      vi.mocked(diffStacksApi.merge).mockResolvedValue(mergeResult)

      const { result } = renderHook(() => useMergeQueue('main'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.merge('stack-1', true)
      })

      expect(diffStacksApi.merge).toHaveBeenCalledWith('stack-1', true)
    })
  })
})
