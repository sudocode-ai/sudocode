import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIssues, useIssue, useUpdateIssueStatus } from '@/hooks/useIssues'
import { issuesApi } from '@/lib/api'
import type { Issue } from '@/types/api'
import { createElement, type ReactNode } from 'react'

// Mock Project context - use a mutable ref so tests can change the projectId
let mockProjectId: string | null = 'test-project-id'

// Mock the API - needs to be before imports that use it
vi.mock('@/lib/api', () => ({
  issuesApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  getCurrentProjectId: () => mockProjectId,
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

const mockIssues: Issue[] = [
  {
    id: 'ISSUE-001',
    uuid: 'test-uuid-1',
    title: 'Test Issue 1',
    content: 'Test content',
    status: 'open',
    priority: 1,
    assignee: undefined,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    closed_at: undefined,
    parent_id: undefined,
  },
  {
    id: 'ISSUE-002',
    uuid: 'test-uuid-2',
    title: 'Test Issue 2',
    content: 'Another test',
    status: 'in_progress',
    priority: 2,
    assignee: undefined,
    created_at: '2024-01-02',
    updated_at: '2024-01-02',
    closed_at: undefined,
    parent_id: undefined,
  },
]

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

describe('useIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id' // Reset to default
  })

  it('should fetch and return issues', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.issues).toEqual(mockIssues)
    expect(result.current.isError).toBe(false)
  })

  it('should handle error state', async () => {
    const error = new Error('Failed to fetch issues')
    vi.mocked(issuesApi.getAll).mockRejectedValue(error)

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
    expect(result.current.issues).toEqual([])
  })

  it('should update issue optimistically', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
    vi.mocked(issuesApi.update).mockResolvedValue({
      ...mockIssues[0],
      status: 'in_progress',
    })

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Update issue
    result.current.updateIssue({
      id: 'ISSUE-001',
      data: { status: 'in_progress' },
    })

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(false)
    })

    expect(issuesApi.update).toHaveBeenCalledWith('ISSUE-001', {
      status: 'in_progress',
    })
  })

  it('should rollback on update error', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
    vi.mocked(issuesApi.update).mockRejectedValue(new Error('Update failed'))

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const originalIssues = [...result.current.issues]

    // Attempt update
    result.current.updateIssue({
      id: 'ISSUE-001',
      data: { status: 'in_progress' },
    })

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(false)
    })

    // Should rollback to original state
    expect(result.current.issues).toEqual(originalIssues)
  })

  it('should create issue', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
    const newIssue: Issue = {
      id: 'ISSUE-003',
      uuid: 'test-uuid-3',
      title: 'New Issue',
      content: 'New content',
      status: 'open',
      priority: 1,
      assignee: undefined,
      created_at: '2024-01-03',
      updated_at: '2024-01-03',
      closed_at: undefined,
      parent_id: undefined,
    }
    vi.mocked(issuesApi.create).mockResolvedValue(newIssue)

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.createIssue({
      title: 'New Issue',
      content: 'New content',
    })

    await waitFor(() => {
      expect(issuesApi.create).toHaveBeenCalled()
    })
  })

  it('should delete issue', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
    vi.mocked(issuesApi.delete).mockResolvedValue(undefined as any)

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    result.current.deleteIssue('ISSUE-001')

    await waitFor(() => {
      expect(issuesApi.delete).toHaveBeenCalled()
      const deleteCallArgs = vi.mocked(issuesApi.delete).mock.calls[0]
      expect(deleteCallArgs[0]).toBe('ISSUE-001')
    })
  })
})

describe('useIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch single issue by id', async () => {
    const mockIssue = mockIssues[0]
    vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)

    const { result } = renderHook(() => useIssue('ISSUE-001'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockIssue)
    expect(issuesApi.getById).toHaveBeenCalledWith('ISSUE-001')
  })

  it('should not fetch if id is empty', async () => {
    const { result } = renderHook(() => useIssue(''), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeUndefined()
    expect(issuesApi.getById).not.toHaveBeenCalled()
  })

  it('should handle error when fetching single issue', async () => {
    const error = new Error('Issue not found')
    vi.mocked(issuesApi.getById).mockRejectedValue(error)

    const { result } = renderHook(() => useIssue('ISSUE-999'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
  })
})

describe('useUpdateIssueStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update issue status', async () => {
    vi.mocked(issuesApi.update).mockResolvedValue({
      ...mockIssues[0],
      status: 'in_progress',
    })

    const { result } = renderHook(() => useUpdateIssueStatus(), {
      wrapper: createWrapper(),
    })

    result.current.mutate({
      id: 'ISSUE-001',
      status: 'in_progress',
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(issuesApi.update).toHaveBeenCalledWith('ISSUE-001', {
      status: 'in_progress',
    })
  })

  it('should handle update status error with rollback', async () => {
    vi.mocked(issuesApi.update).mockRejectedValue(new Error('Update failed'))

    const { result } = renderHook(() => useUpdateIssueStatus(), {
      wrapper: createWrapper(),
    })

    result.current.mutate({
      id: 'ISSUE-001',
      status: 'in_progress',
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
  })
})

describe('useIssues - Project Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should not fetch issues when projectId is null', async () => {
    mockProjectId = null
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    const { result } = renderHook(() => useIssues(), {
      wrapper: createWrapper(),
    })

    // Should not be loading because query is disabled
    expect(result.current.isLoading).toBe(false)
    expect(result.current.issues).toEqual([])
    expect(issuesApi.getAll).not.toHaveBeenCalled()
  })

  it('should include projectId in query key for cache separation', async () => {
    const projectAIssues: Issue[] = [
      { ...mockIssues[0], id: 'PROJECT-A-ISSUE', title: 'Project A Issue' },
    ]
    const projectBIssues: Issue[] = [
      { ...mockIssues[0], id: 'PROJECT-B-ISSUE', title: 'Project B Issue' },
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

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    // Fetch issues for Project A
    mockProjectId = 'project-a'
    vi.mocked(issuesApi.getAll).mockResolvedValue(projectAIssues)

    const { result: resultA, unmount: unmountA } = renderHook(() => useIssues(), { wrapper })

    await waitFor(() => {
      expect(resultA.current.isLoading).toBe(false)
    })

    expect(resultA.current.issues).toEqual(projectAIssues)
    unmountA()

    // Switch to Project B
    mockProjectId = 'project-b'
    vi.mocked(issuesApi.getAll).mockResolvedValue(projectBIssues)

    const { result: resultB } = renderHook(() => useIssues(), { wrapper })

    await waitFor(() => {
      expect(resultB.current.isLoading).toBe(false)
    })

    // Should have fetched new data for Project B, not used Project A's cache
    expect(resultB.current.issues).toEqual(projectBIssues)
    expect(issuesApi.getAll).toHaveBeenCalledTimes(2)
  })

  it('should refetch when projectId changes', async () => {
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    mockProjectId = 'project-1'
    const { result, rerender } = renderHook(() => useIssues(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(issuesApi.getAll).toHaveBeenCalledTimes(1)

    // Change project
    mockProjectId = 'project-2'
    rerender()

    await waitFor(() => {
      expect(issuesApi.getAll).toHaveBeenCalledTimes(2)
    })
  })
})

describe('useIssue - Project Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should not fetch issue when projectId is null', async () => {
    mockProjectId = null
    vi.mocked(issuesApi.getById).mockResolvedValue(mockIssues[0])

    const { result } = renderHook(() => useIssue('ISSUE-001'), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeUndefined()
    expect(issuesApi.getById).not.toHaveBeenCalled()
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

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    // Fetch issue for Project A
    mockProjectId = 'project-a'
    const issueA = { ...mockIssues[0], title: 'Issue from Project A' }
    vi.mocked(issuesApi.getById).mockResolvedValue(issueA)

    const { result: resultA, unmount: unmountA } = renderHook(
      () => useIssue('ISSUE-001'),
      { wrapper }
    )

    await waitFor(() => {
      expect(resultA.current.isLoading).toBe(false)
    })

    expect(resultA.current.data).toEqual(issueA)
    unmountA()

    // Switch to Project B - same issue ID but different project
    mockProjectId = 'project-b'
    const issueB = { ...mockIssues[0], title: 'Issue from Project B' }
    vi.mocked(issuesApi.getById).mockResolvedValue(issueB)

    const { result: resultB } = renderHook(() => useIssue('ISSUE-001'), { wrapper })

    await waitFor(() => {
      expect(resultB.current.isLoading).toBe(false)
    })

    // Should have fetched new data, not used cached data from Project A
    expect(resultB.current.data).toEqual(issueB)
    expect(issuesApi.getById).toHaveBeenCalledTimes(2)
  })
})

describe('useUpdateIssueStatus - Project Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  it('should use project-scoped query key for optimistic updates', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          staleTime: Infinity,
        },
      },
    })

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    // First, populate the issues cache
    mockProjectId = 'project-a'
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
    vi.mocked(issuesApi.update).mockResolvedValue({
      ...mockIssues[0],
      status: 'in_progress',
    })

    const { result: issuesResult } = renderHook(() => useIssues(), { wrapper })

    await waitFor(() => {
      expect(issuesResult.current.isLoading).toBe(false)
    })

    // Now use the status update hook
    const { result: updateResult } = renderHook(() => useUpdateIssueStatus(), { wrapper })

    updateResult.current.mutate({
      id: 'ISSUE-001',
      status: 'in_progress',
    })

    await waitFor(() => {
      expect(updateResult.current.isSuccess).toBe(true)
    })

    expect(issuesApi.update).toHaveBeenCalledWith('ISSUE-001', {
      status: 'in_progress',
    })
  })
})
