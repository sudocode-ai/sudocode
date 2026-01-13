import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStacks, useStack, useIssueStack, useStackMutations } from '@/hooks/useStacks'
import { stacksApi } from '@/lib/api'
import type { StackInfo, StacksListResponse, Stack } from '@/types/stack'
import { createElement, type ReactNode } from 'react'

// Mock Project context
let mockProjectId: string | null = 'test-project-id'

// Mock the API
vi.mock('@/lib/api', () => ({
  stacksApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getForIssue: vi.fn(),
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

const mockStackInfo: StackInfo = {
  stack: {
    id: 'stk-001',
    name: 'Test Stack',
    root_issue_id: 'i-002',
    issue_order: ['i-001', 'i-002'],
    is_auto: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  entries: [
    {
      issue_id: 'i-001',
      depth: 0,
      has_checkpoint: true,
      checkpoint_status: 'approved',
      is_promoted: false,
    },
    {
      issue_id: 'i-002',
      depth: 1,
      has_checkpoint: false,
      is_promoted: false,
    },
  ],
  health: 'pending',
}

const mockAutoStackInfo: StackInfo = {
  stack: {
    id: 'auto-i-003',
    name: undefined,
    root_issue_id: 'i-004',
    issue_order: ['i-003', 'i-004'],
    is_auto: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  entries: [
    {
      issue_id: 'i-003',
      depth: 0,
      has_checkpoint: false,
      is_promoted: false,
    },
    {
      issue_id: 'i-004',
      depth: 1,
      has_checkpoint: false,
      is_promoted: false,
    },
  ],
  health: 'pending',
}

const mockStacksListResponse: StacksListResponse = {
  stacks: [mockStackInfo, mockAutoStackInfo],
  auto_count: 1,
  manual_count: 1,
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

describe('useStacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should fetch and return stacks', async () => {
    vi.mocked(stacksApi.getAll).mockResolvedValue(mockStacksListResponse)

    const { result } = renderHook(() => useStacks(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockStacksListResponse)
    expect(result.current.data?.stacks).toHaveLength(2)
    expect(result.current.data?.auto_count).toBe(1)
    expect(result.current.data?.manual_count).toBe(1)
  })

  it('should handle error state', async () => {
    const error = new Error('Failed to fetch stacks')
    vi.mocked(stacksApi.getAll).mockRejectedValue(error)

    const { result } = renderHook(() => useStacks(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
  })

  it('should not fetch when projectId is null', async () => {
    mockProjectId = null
    vi.mocked(stacksApi.getAll).mockResolvedValue(mockStacksListResponse)

    const { result } = renderHook(() => useStacks(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(stacksApi.getAll).not.toHaveBeenCalled()
  })

  it('should pass filter options to API', async () => {
    vi.mocked(stacksApi.getAll).mockResolvedValue(mockStacksListResponse)

    const { result } = renderHook(
      () => useStacks({ includeAuto: false, includeManual: true }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(stacksApi.getAll).toHaveBeenCalledWith({
      include_auto: false,
      include_manual: true,
    })
  })
})

describe('useStack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should fetch single stack by id', async () => {
    vi.mocked(stacksApi.getById).mockResolvedValue(mockStackInfo)

    const { result } = renderHook(() => useStack('stk-001'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockStackInfo)
    expect(stacksApi.getById).toHaveBeenCalledWith('stk-001')
  })

  it('should not fetch if stackId is null', async () => {
    const { result } = renderHook(() => useStack(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeUndefined()
    expect(stacksApi.getById).not.toHaveBeenCalled()
  })

  it('should not fetch if stackId is undefined', async () => {
    const { result } = renderHook(() => useStack(undefined), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeUndefined()
    expect(stacksApi.getById).not.toHaveBeenCalled()
  })

  it('should handle error when fetching single stack', async () => {
    const error = new Error('Stack not found')
    vi.mocked(stacksApi.getById).mockRejectedValue(error)

    const { result } = renderHook(() => useStack('stk-nonexistent'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
  })
})

describe('useIssueStack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should fetch stack for an issue', async () => {
    vi.mocked(stacksApi.getForIssue).mockResolvedValue(mockStackInfo)

    const { result } = renderHook(() => useIssueStack('i-001'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockStackInfo)
    expect(stacksApi.getForIssue).toHaveBeenCalledWith('i-001')
  })

  it('should not fetch if issueId is null', async () => {
    const { result } = renderHook(() => useIssueStack(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeUndefined()
    expect(stacksApi.getForIssue).not.toHaveBeenCalled()
  })

  it('should return null when issue is not in any stack', async () => {
    vi.mocked(stacksApi.getForIssue).mockResolvedValue(null)

    const { result } = renderHook(() => useIssueStack('i-999'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBeNull()
  })
})

describe('useStackMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should create a stack', async () => {
    const newStack: Stack = {
      id: 'stk-new',
      name: 'New Stack',
      issue_order: ['i-001', 'i-002'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    vi.mocked(stacksApi.create).mockResolvedValue(newStack)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    result.current.createStack.mutate({
      name: 'New Stack',
      issue_ids: ['i-001', 'i-002'],
    })

    await waitFor(() => {
      expect(result.current.createStack.isSuccess).toBe(true)
    })

    expect(stacksApi.create).toHaveBeenCalledWith({
      name: 'New Stack',
      issue_ids: ['i-001', 'i-002'],
    })
  })

  it('should update a stack', async () => {
    const updatedStack: Stack = {
      id: 'stk-001',
      name: 'Updated Stack',
      issue_order: ['i-001', 'i-002'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    vi.mocked(stacksApi.update).mockResolvedValue(updatedStack)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    result.current.updateStack.mutate({
      id: 'stk-001',
      data: { name: 'Updated Stack' },
    })

    await waitFor(() => {
      expect(result.current.updateStack.isSuccess).toBe(true)
    })

    expect(stacksApi.update).toHaveBeenCalledWith('stk-001', {
      name: 'Updated Stack',
    })
  })

  it('should delete a stack', async () => {
    vi.mocked(stacksApi.delete).mockResolvedValue(undefined as any)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    result.current.deleteStack.mutate('stk-001')

    await waitFor(() => {
      expect(result.current.deleteStack.isSuccess).toBe(true)
    })

    expect(stacksApi.delete).toHaveBeenCalledWith('stk-001')
  })

  it('should add issues to stack', async () => {
    const updatedStack: Stack = {
      id: 'stk-001',
      issue_order: ['i-001', 'i-002', 'i-003'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    vi.mocked(stacksApi.update).mockResolvedValue(updatedStack)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    result.current.addToStack.mutate({
      stackId: 'stk-001',
      issueIds: ['i-003'],
    })

    await waitFor(() => {
      expect(result.current.addToStack.isSuccess).toBe(true)
    })

    expect(stacksApi.update).toHaveBeenCalledWith('stk-001', {
      add_issues: ['i-003'],
    })
  })

  it('should remove issues from stack', async () => {
    const updatedStack: Stack = {
      id: 'stk-001',
      issue_order: ['i-001'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    vi.mocked(stacksApi.update).mockResolvedValue(updatedStack)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    result.current.removeFromStack.mutate({
      stackId: 'stk-001',
      issueIds: ['i-002'],
    })

    await waitFor(() => {
      expect(result.current.removeFromStack.isSuccess).toBe(true)
    })

    expect(stacksApi.update).toHaveBeenCalledWith('stk-001', {
      remove_issues: ['i-002'],
    })
  })

  it('should reorder stack', async () => {
    const updatedStack: Stack = {
      id: 'stk-001',
      issue_order: ['i-002', 'i-001'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    vi.mocked(stacksApi.update).mockResolvedValue(updatedStack)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    result.current.reorderStack.mutate({
      stackId: 'stk-001',
      issueOrder: ['i-002', 'i-001'],
    })

    await waitFor(() => {
      expect(result.current.reorderStack.isSuccess).toBe(true)
    })

    expect(stacksApi.update).toHaveBeenCalledWith('stk-001', {
      issue_order: ['i-002', 'i-001'],
    })
  })

  it('should track creating state', async () => {
    let resolveCreate: (value: Stack) => void
    const createPromise = new Promise<Stack>((resolve) => {
      resolveCreate = resolve
    })
    vi.mocked(stacksApi.create).mockReturnValue(createPromise)

    const { result } = renderHook(() => useStackMutations(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isCreating).toBe(false)

    result.current.createStack.mutate({
      name: 'Test',
      issue_ids: ['i-001'],
    })

    await waitFor(() => {
      expect(result.current.isCreating).toBe(true)
    })

    // Resolve the promise
    resolveCreate!({
      id: 'stk-new',
      name: 'Test',
      issue_order: ['i-001'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    })

    await waitFor(() => {
      expect(result.current.isCreating).toBe(false)
    })
  })
})
