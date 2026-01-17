import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIssueHoverData } from '@/hooks/useIssueHoverData'
import { issuesApi, executionsApi } from '@/lib/api'
import type { Issue } from '@/types/api'
import type { Execution } from '@/types/execution'
import React from 'react'

// Mock Project context
let mockProjectId: string | null = 'test-project-id'

vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: () => mockProjectId,
  issuesApi: {
    getById: vi.fn(),
  },
  executionsApi: {
    list: vi.fn(),
  },
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

// Helper to create partial execution mocks
const createMockExecution = (overrides: Partial<Execution>): Execution =>
  ({
    id: 'exec-default',
    issue_id: 'i-test123',
    issue_uuid: null,
    mode: null,
    prompt: 'Test prompt',
    config: null,
    agent_type: 'claude-code',
    session_id: null,
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'test-branch',
    before_commit: null,
    after_commit: null,
    worktree_path: null,
    status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    exit_code: null,
    error_message: null,
    error: null,
    model: null,
    summary: null,
    files_changed: null,
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
    stream_id: null,
  deleted_at: null,
  deletion_reason: null,
    ...overrides,
  }) as Execution

describe('useIssueHoverData', () => {
  let queryClient: QueryClient

  const mockIssue: Issue = {
    id: 'i-test123',
    uuid: 'uuid-test123',
    title: 'Test Issue',
    status: 'open',
    content: 'Test content',
    priority: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const mockExecutions: Execution[] = [
    createMockExecution({ id: 'exec-003', status: 'running', created_at: '2024-01-03T00:00:00Z', updated_at: '2024-01-03T00:00:00Z' }),
    createMockExecution({ id: 'exec-001', status: 'completed', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }),
    createMockExecution({ id: 'exec-002', status: 'failed', created_at: '2024-01-02T00:00:00Z', updated_at: '2024-01-02T00:00:00Z' }),
  ]

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  describe('when enabled is false', () => {
    it('should not fetch data', () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue(mockExecutions)

      const { result } = renderHook(() => useIssueHoverData('i-test123', false), { wrapper })

      expect(result.current.isLoading).toBe(false)
      expect(result.current.issue).toBeUndefined()
      expect(result.current.executions).toEqual([])
      expect(issuesApi.getById).not.toHaveBeenCalled()
      expect(executionsApi.list).not.toHaveBeenCalled()
    })
  })

  describe('when enabled is true', () => {
    it('should fetch issue data', async () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.issue).toEqual(mockIssue)
      expect(issuesApi.getById).toHaveBeenCalledWith('i-test123')
    })

    it('should fetch executions data', async () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue(mockExecutions)

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(executionsApi.list).toHaveBeenCalledWith('i-test123')
      expect(result.current.executions).toHaveLength(3)
    })

    it('should sort executions by created_at descending', async () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue(mockExecutions)

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should be sorted newest first
      expect(result.current.executions[0].id).toBe('exec-003')
      expect(result.current.executions[1].id).toBe('exec-002')
      expect(result.current.executions[2].id).toBe('exec-001')
    })

    it('should limit executions to 3', async () => {
      const manyExecutions: Execution[] = [
        { ...mockExecutions[0], id: 'exec-001', created_at: '2024-01-01T00:00:00Z' },
        { ...mockExecutions[0], id: 'exec-002', created_at: '2024-01-02T00:00:00Z' },
        { ...mockExecutions[0], id: 'exec-003', created_at: '2024-01-03T00:00:00Z' },
        { ...mockExecutions[0], id: 'exec-004', created_at: '2024-01-04T00:00:00Z' },
        { ...mockExecutions[0], id: 'exec-005', created_at: '2024-01-05T00:00:00Z' },
      ]

      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue(manyExecutions)

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.executions).toHaveLength(3)
      // Should be the 3 most recent
      expect(result.current.executions[0].id).toBe('exec-005')
      expect(result.current.executions[1].id).toBe('exec-004')
      expect(result.current.executions[2].id).toBe('exec-003')
    })
  })

  describe('loading state', () => {
    it('should return isLoading true while fetching', async () => {
      vi.mocked(issuesApi.getById).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockIssue), 100))
      )
      vi.mocked(executionsApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe('error handling', () => {
    it('should return isError true when issue fetch fails', async () => {
      vi.mocked(issuesApi.getById).mockRejectedValue(new Error('Failed to fetch'))
      vi.mocked(executionsApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
    })

    it('should return isError true when executions fetch fails', async () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockRejectedValue(new Error('Failed to fetch'))

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
    })
  })

  describe('when projectId is null', () => {
    it('should not fetch data', () => {
      mockProjectId = null

      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useIssueHoverData('i-test123', true), { wrapper })

      expect(result.current.isLoading).toBe(false)
      expect(issuesApi.getById).not.toHaveBeenCalled()
    })
  })

  describe('when issueId is empty', () => {
    it('should not fetch data', () => {
      vi.mocked(issuesApi.getById).mockResolvedValue(mockIssue)
      vi.mocked(executionsApi.list).mockResolvedValue([])

      const { result } = renderHook(() => useIssueHoverData('', true), { wrapper })

      expect(result.current.isLoading).toBe(false)
      expect(issuesApi.getById).not.toHaveBeenCalled()
    })
  })
})
