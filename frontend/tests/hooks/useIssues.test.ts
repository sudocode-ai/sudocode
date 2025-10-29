import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIssues, useIssue, useUpdateIssueStatus } from '@/hooks/useIssues'
import { issuesApi } from '@/lib/api'
import type { Issue } from '@/types/api'
import { createElement, type ReactNode } from 'react'

// Mock the API
vi.mock('@/lib/api', () => ({
  issuesApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
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
