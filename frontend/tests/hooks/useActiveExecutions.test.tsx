import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useActiveExecutions } from '@/hooks/useActiveExecutions'
import { executionsApi } from '@/lib/api'
import { createElement, type ReactNode } from 'react'
import type { WebSocketMessage } from '@/types/api'

// Mock Project context
let mockProjectId: string | null = 'test-project-id'

// Store message handler for simulating WebSocket events
let mockMessageHandler: ((message: WebSocketMessage) => void) | null = null

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    listAll: vi.fn(),
    getChanges: vi.fn(),
  },
  getCurrentProjectId: () => mockProjectId,
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: true,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn((_id: string, handler: (msg: WebSocketMessage) => void) => {
      mockMessageHandler = handler
    }),
    removeMessageHandler: vi.fn(() => {
      mockMessageHandler = null
    }),
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

// Mock executions data - partial Execution objects for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecutions: any = {
  executions: [
    {
      id: 'exec-001',
      issue_id: 'i-abc1',
      agent_type: 'claude-code',
      status: 'running',
      worktree_path: '/path/to/worktree',
      created_at: '2024-01-01T10:00:00Z',
      started_at: '2024-01-01T10:00:05Z',
      prompt: 'Implement feature X',
      parent_execution_id: null,
    },
    {
      id: 'exec-002',
      issue_id: 'i-xyz2',
      agent_type: 'codex',
      status: 'pending',
      worktree_path: null,
      created_at: '2024-01-01T11:00:00Z',
      started_at: null,
      prompt: 'Fix bug Y',
      parent_execution_id: null,
    },
    {
      id: 'exec-003',
      issue_id: 'i-abc1',
      agent_type: 'claude-code',
      status: 'running',
      worktree_path: '/path/to/worktree',
      created_at: '2024-01-01T10:30:00Z',
      started_at: '2024-01-01T10:30:05Z',
      prompt: 'Continue feature X',
      parent_execution_id: 'exec-001', // This is a follow-up, should be filtered out
    },
  ],
  total: 3,
  hasMore: false,
}

// Mock changes response
const mockChanges = {
  available: true,
  captured: {
    files: [
      { path: 'src/index.ts', additions: 10, deletions: 5, status: 'M' as const },
      { path: 'src/utils.ts', additions: 20, deletions: 0, status: 'A' as const },
    ],
    summary: { totalFiles: 2, totalAdditions: 30, totalDeletions: 5 },
    commitRange: { before: 'abc123', after: 'def456' },
    uncommitted: false,
  },
  current: {
    files: [
      { path: 'src/index.ts', additions: 15, deletions: 5, status: 'M' as const },
      { path: 'src/utils.ts', additions: 20, deletions: 0, status: 'A' as const },
      { path: 'src/new.ts', additions: 50, deletions: 0, status: 'A' as const },
    ],
    summary: { totalFiles: 3, totalAdditions: 85, totalDeletions: 5 },
    commitRange: { before: 'abc123', after: 'ghi789' },
    uncommitted: false,
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

describe('useActiveExecutions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessageHandler = null
    mockProjectId = 'test-project-id'
  })

  describe('Basic functionality', () => {
    it('should return empty array when no active executions', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({ executions: [], total: 0, hasMore: false })

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.executions).toEqual([])
      expect(result.current.error).toBeNull()
    })

    it('should return active executions with changed files', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue(mockExecutions)
      vi.mocked(executionsApi.getChanges).mockResolvedValue(mockChanges)

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should only return root executions (2), not follow-ups
      expect(result.current.executions).toHaveLength(2)

      // First execution
      expect(result.current.executions[0]).toMatchObject({
        id: 'exec-001',
        issueId: 'i-abc1',
        agentType: 'claude-code',
        status: 'running',
        worktreePath: '/path/to/worktree',
        startedAt: '2024-01-01T10:00:05Z',
        prompt: 'Implement feature X',
      })

      // Should use current snapshot for changed files
      expect(result.current.executions[0].changedFiles).toEqual([
        'src/index.ts',
        'src/utils.ts',
        'src/new.ts',
      ])
    })

    it('should filter out follow-up executions', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue(mockExecutions)
      vi.mocked(executionsApi.getChanges).mockResolvedValue(mockChanges)

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should not include exec-003 (follow-up)
      const ids = result.current.executions.map((e) => e.id)
      expect(ids).not.toContain('exec-003')
      expect(ids).toContain('exec-001')
      expect(ids).toContain('exec-002')
    })

    it('should use created_at as fallback when started_at is null', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue(mockExecutions)
      vi.mocked(executionsApi.getChanges).mockResolvedValue(mockChanges)

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Second execution (exec-002) has null started_at
      const pendingExec = result.current.executions.find((e) => e.id === 'exec-002')
      expect(pendingExec?.startedAt).toBe('2024-01-01T11:00:00Z') // created_at
    })
  })

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      const error = new Error('API Error')
      vi.mocked(executionsApi.listAll).mockRejectedValue(error)

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBeTruthy()
      expect(result.current.executions).toEqual([])
    })

    it('should handle changes fetch errors gracefully', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: [mockExecutions.executions[0]],
        total: 1,
        hasMore: false,
      })
      vi.mocked(executionsApi.getChanges).mockRejectedValue(new Error('Changes fetch failed'))

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should still return execution, but with empty changedFiles
      expect(result.current.executions).toHaveLength(1)
      expect(result.current.executions[0].changedFiles).toEqual([])
    })
  })

  describe('Project context', () => {
    it('should not fetch when project ID is null', async () => {
      mockProjectId = null

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      // Should not be loading and should have no results
      expect(result.current.isLoading).toBe(false)
      expect(result.current.executions).toEqual([])
      expect(executionsApi.listAll).not.toHaveBeenCalled()
    })
  })

  describe('WebSocket updates', () => {
    it('should register message handler', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({ executions: [], total: 0, hasMore: false })

      renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      // Message handler should be registered
      expect(mockMessageHandler).not.toBeNull()
    })

    it('should invalidate query on execution_created message', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({ executions: [], total: 0, hasMore: false })

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Clear call count
      vi.mocked(executionsApi.listAll).mockClear()

      // Simulate WebSocket message
      mockMessageHandler?.({
        type: 'execution_created',
        data: { executionId: 'exec-new' },
        timestamp: new Date().toISOString(),
      })

      // Query should be refetched (eventually)
      await waitFor(() => {
        expect(executionsApi.listAll).toHaveBeenCalled()
      })
    })

    it('should invalidate query on execution_status_changed message', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({ executions: [], total: 0, hasMore: false })

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      vi.mocked(executionsApi.listAll).mockClear()

      mockMessageHandler?.({
        type: 'execution_status_changed',
        data: { executionId: 'exec-001', status: 'completed' },
        timestamp: new Date().toISOString(),
      })

      await waitFor(() => {
        expect(executionsApi.listAll).toHaveBeenCalled()
      })
    })
  })

  describe('Data transformation', () => {
    it('should prefer current snapshot over captured for changed files', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: [mockExecutions.executions[0]],
        total: 1,
        hasMore: false,
      })
      vi.mocked(executionsApi.getChanges).mockResolvedValue(mockChanges)

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // current has 3 files, captured has 2
      expect(result.current.executions[0].changedFiles).toHaveLength(3)
    })

    it('should fall back to captured snapshot when current is unavailable', async () => {
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: [mockExecutions.executions[0]],
        total: 1,
        hasMore: false,
      })
      vi.mocked(executionsApi.getChanges).mockResolvedValue({
        available: true,
        captured: mockChanges.captured,
        // No current snapshot
      })

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should fall back to captured (2 files)
      expect(result.current.executions[0].changedFiles).toHaveLength(2)
    })

    it('should handle null issue_id correctly', async () => {
      const executionWithNullIssue = {
        ...mockExecutions.executions[0],
        issue_id: null,
      }
      vi.mocked(executionsApi.listAll).mockResolvedValue({
        executions: [executionWithNullIssue],
        total: 1,
        hasMore: false,
      })
      vi.mocked(executionsApi.getChanges).mockResolvedValue(mockChanges)

      const { result } = renderHook(() => useActiveExecutions(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.executions[0].issueId).toBeNull()
    })
  })
})
