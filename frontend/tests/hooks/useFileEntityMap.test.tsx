import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFileEntityMap, useFileEntityMapWithStats } from '@/hooks/useFileEntityMap'
import { relationshipsApi, executionsApi } from '@/lib/api'
import { createElement, type ReactNode } from 'react'
import type { ActiveExecution } from '@/hooks/useActiveExecutions'

// Mock project ID
let mockProjectId: string | null = 'test-project-id'

// Mock active executions
let mockExecutions: ActiveExecution[] = []
let mockExecutionsLoading = false
let mockExecutionsError: Error | null = null

// Mock useActiveExecutions
vi.mock('@/hooks/useActiveExecutions', () => ({
  useActiveExecutions: () => ({
    executions: mockExecutions,
    isLoading: mockExecutionsLoading,
    error: mockExecutionsError,
  }),
}))

// Mock useProject
vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({
    currentProjectId: mockProjectId,
  }),
}))

// Mock API
vi.mock('@/lib/api', () => ({
  relationshipsApi: {
    getForEntity: vi.fn(),
  },
  executionsApi: {
    getChanges: vi.fn(),
  },
}))

// Sample test data
const mockExecution1: ActiveExecution = {
  id: 'exec-001',
  issueId: 'i-abc1',
  agentType: 'claude-code',
  status: 'running',
  worktreePath: '/path/to/worktree1',
  changedFiles: ['src/index.ts', 'src/utils.ts'],
  startedAt: '2024-01-01T10:00:00Z',
  prompt: 'Implement feature X',
}

const mockExecution2: ActiveExecution = {
  id: 'exec-002',
  issueId: 'i-xyz2',
  agentType: 'codex',
  status: 'running',
  worktreePath: '/path/to/worktree2',
  changedFiles: ['src/utils.ts', 'src/api.ts'], // Overlaps with exec-001 on utils.ts
  startedAt: '2024-01-01T11:00:00Z',
  prompt: 'Fix bug Y',
}

const mockExecution3NoIssue: ActiveExecution = {
  id: 'exec-003',
  issueId: null,
  agentType: 'copilot',
  status: 'pending',
  worktreePath: null,
  changedFiles: ['README.md'],
  startedAt: '2024-01-01T12:00:00Z',
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

describe('useFileEntityMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
    mockExecutions = []
    mockExecutionsLoading = false
    mockExecutionsError = null
  })

  describe('Empty state', () => {
    it('should return empty map when no executions', async () => {
      mockExecutions = []

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.fileEntityMap).toEqual({})
      expect(result.current.fileCount).toBe(0)
      expect(result.current.executionCount).toBe(0)
      expect(result.current.error).toBeNull()
    })

    it('should handle loading state', () => {
      mockExecutionsLoading = true

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      expect(result.current.isLoading).toBe(true)
    })

    it('should propagate execution errors', async () => {
      mockExecutionsError = new Error('Failed to fetch executions')

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      expect(result.current.error).toEqual(new Error('Failed to fetch executions'))
    })
  })

  describe('Single execution mapping', () => {
    it('should map files to execution correctly', async () => {
      mockExecutions = [mockExecution1]
      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({
        outgoing: [
          {
            from_id: 'i-abc1',
            from_uuid: 'uuid1',
            from_type: 'issue' as const,
            to_id: 's-spec1',
            to_uuid: 'uuid2',
            to_type: 'spec' as const,
            relationship_type: 'implements' as const,
            created_at: '2024-01-01',
          },
        ],
        incoming: [],
      })

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Check file mapping
      expect(result.current.fileEntityMap['src/index.ts']).toBeDefined()
      expect(result.current.fileEntityMap['src/index.ts'].executions).toContain('exec-001')
      expect(result.current.fileEntityMap['src/index.ts'].issues).toContain('i-abc1')
      expect(result.current.fileEntityMap['src/index.ts'].specs).toContain('s-spec1')

      expect(result.current.fileEntityMap['src/utils.ts']).toBeDefined()
      expect(result.current.fileEntityMap['src/utils.ts'].executions).toContain('exec-001')

      expect(result.current.fileCount).toBe(2)
      expect(result.current.executionCount).toBe(1)
    })

    it('should handle execution without issue', async () => {
      mockExecutions = [mockExecution3NoIssue]

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.fileEntityMap['README.md']).toBeDefined()
      expect(result.current.fileEntityMap['README.md'].executions).toContain('exec-003')
      expect(result.current.fileEntityMap['README.md'].issues).toHaveLength(0)
      expect(result.current.fileEntityMap['README.md'].specs).toHaveLength(0)

      // Should not call relationships API when no issues
      expect(relationshipsApi.getForEntity).not.toHaveBeenCalled()
    })
  })

  describe('Multiple execution mapping', () => {
    it('should aggregate multiple executions on same file', async () => {
      mockExecutions = [mockExecution1, mockExecution2]
      vi.mocked(relationshipsApi.getForEntity).mockImplementation(async (issueId) => {
        if (issueId === 'i-abc1') {
          return {
            outgoing: [
              {
                from_id: 'i-abc1',
                from_uuid: 'uuid1',
                from_type: 'issue' as const,
                to_id: 's-spec1',
                to_uuid: 'uuid2',
                to_type: 'spec' as const,
                relationship_type: 'implements' as const,
                created_at: '2024-01-01',
              },
            ],
            incoming: [],
          }
        }
        return { outgoing: [], incoming: [] }
      })

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // src/utils.ts is modified by both executions
      const utilsInfo = result.current.fileEntityMap['src/utils.ts']
      expect(utilsInfo).toBeDefined()
      expect(utilsInfo.executions).toContain('exec-001')
      expect(utilsInfo.executions).toContain('exec-002')
      expect(utilsInfo.executions).toHaveLength(2)

      // src/index.ts only by exec-001
      expect(result.current.fileEntityMap['src/index.ts'].executions).toHaveLength(1)

      // src/api.ts only by exec-002
      expect(result.current.fileEntityMap['src/api.ts'].executions).toHaveLength(1)

      expect(result.current.fileCount).toBe(3)
      expect(result.current.executionCount).toBe(2)
    })

    it('should deduplicate issues and specs', async () => {
      // Two executions from same issue
      const exec1 = { ...mockExecution1, id: 'exec-001a' }
      const exec2 = { ...mockExecution1, id: 'exec-001b', changedFiles: ['src/index.ts'] }
      mockExecutions = [exec1, exec2]

      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({
        outgoing: [
          {
            from_id: 'i-abc1',
            from_uuid: 'uuid1',
            from_type: 'issue' as const,
            to_id: 's-spec1',
            to_uuid: 'uuid2',
            to_type: 'spec' as const,
            relationship_type: 'implements' as const,
            created_at: '2024-01-01',
          },
        ],
        incoming: [],
      })

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Both executions modify src/index.ts
      const indexInfo = result.current.fileEntityMap['src/index.ts']
      expect(indexInfo.executions).toHaveLength(2) // Both executions
      expect(indexInfo.issues).toHaveLength(1) // Same issue, deduplicated
      expect(indexInfo.specs).toHaveLength(1) // Same spec, deduplicated
    })
  })

  describe('Relationship resolution', () => {
    it('should handle relationship API returning array format', async () => {
      mockExecutions = [mockExecution1]
      // Some APIs return just an array instead of { outgoing, incoming }
      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue([
        {
          from_id: 'i-abc1',
          from_uuid: 'uuid1',
          from_type: 'issue' as const,
          to_id: 's-spec1',
          to_uuid: 'uuid2',
          to_type: 'spec' as const,
          relationship_type: 'implements' as const,
          created_at: '2024-01-01',
        },
      ] as any)

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.fileEntityMap['src/index.ts'].specs).toContain('s-spec1')
    })

    it('should filter only "implements" relationships to specs', async () => {
      mockExecutions = [mockExecution1]
      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({
        outgoing: [
          {
            from_id: 'i-abc1',
            from_uuid: 'uuid1',
            from_type: 'issue' as const,
            to_id: 's-spec1',
            to_uuid: 'uuid2',
            to_type: 'spec' as const,
            relationship_type: 'implements' as const,
            created_at: '2024-01-01',
          },
          {
            from_id: 'i-abc1',
            from_uuid: 'uuid1',
            from_type: 'issue' as const,
            to_id: 's-spec2',
            to_uuid: 'uuid3',
            to_type: 'spec' as const,
            relationship_type: 'references' as const, // Should be excluded
            created_at: '2024-01-01',
          },
          {
            from_id: 'i-abc1',
            from_uuid: 'uuid1',
            from_type: 'issue' as const,
            to_id: 'i-other',
            to_uuid: 'uuid4',
            to_type: 'issue' as const,
            relationship_type: 'implements' as const, // Should be excluded (not spec)
            created_at: '2024-01-01',
          },
        ],
        incoming: [],
      })

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Only s-spec1 should be included
      expect(result.current.fileEntityMap['src/index.ts'].specs).toEqual(['s-spec1'])
    })

    it('should handle relationship API errors gracefully', async () => {
      mockExecutions = [mockExecution1]
      vi.mocked(relationshipsApi.getForEntity).mockRejectedValue(new Error('API Error'))

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should still have file mapping, just no specs
      expect(result.current.fileEntityMap['src/index.ts']).toBeDefined()
      expect(result.current.fileEntityMap['src/index.ts'].executions).toContain('exec-001')
      expect(result.current.fileEntityMap['src/index.ts'].specs).toHaveLength(0)
    })
  })

  describe('Project context', () => {
    it('should not fetch relationships when project ID is null', async () => {
      mockProjectId = null
      mockExecutions = [mockExecution1]

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      // Should not call relationships API
      expect(relationshipsApi.getForEntity).not.toHaveBeenCalled()

      // Should still build basic map from executions
      expect(result.current.fileEntityMap['src/index.ts']).toBeDefined()
    })
  })

  describe('Change statistics', () => {
    it('should include default change info', async () => {
      mockExecutions = [mockExecution1]
      vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({ outgoing: [], incoming: [] })

      const { result } = renderHook(() => useFileEntityMap(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const changes = result.current.fileEntityMap['src/index.ts'].changes
      expect(changes['exec-001']).toEqual({
        additions: 0,
        deletions: 0,
        status: 'M',
      })
    })
  })
})

describe('useFileEntityMapWithStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
    mockExecutions = []
  })

  it('should fetch detailed change statistics', async () => {
    mockExecutions = [mockExecution1]
    vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({ outgoing: [], incoming: [] })
    vi.mocked(executionsApi.getChanges).mockResolvedValue({
      available: true,
      captured: {
        files: [
          { path: 'src/index.ts', additions: 50, deletions: 10, status: 'M' as const },
          { path: 'src/utils.ts', additions: 20, deletions: 5, status: 'A' as const },
        ],
        summary: { totalFiles: 2, totalAdditions: 70, totalDeletions: 15 },
        commitRange: { before: 'abc', after: 'def' },
        uncommitted: false,
      },
    })

    const { result } = renderHook(() => useFileEntityMapWithStats(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.statsLoading).toBe(false)
    })

    expect(result.current.fileEntityMap['src/index.ts'].changes['exec-001']).toEqual({
      additions: 50,
      deletions: 10,
      status: 'M',
    })

    expect(result.current.fileEntityMap['src/utils.ts'].changes['exec-001']).toEqual({
      additions: 20,
      deletions: 5,
      status: 'A',
    })
  })

  it('should prefer current snapshot over captured', async () => {
    mockExecutions = [mockExecution1]
    vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({ outgoing: [], incoming: [] })
    vi.mocked(executionsApi.getChanges).mockResolvedValue({
      available: true,
      captured: {
        files: [{ path: 'src/index.ts', additions: 10, deletions: 0, status: 'A' as const }],
        summary: { totalFiles: 1, totalAdditions: 10, totalDeletions: 0 },
        commitRange: { before: 'abc', after: 'def' },
        uncommitted: false,
      },
      current: {
        files: [{ path: 'src/index.ts', additions: 50, deletions: 10, status: 'M' as const }],
        summary: { totalFiles: 1, totalAdditions: 50, totalDeletions: 10 },
        commitRange: { before: 'abc', after: 'ghi' },
        uncommitted: false,
      },
    })

    const { result } = renderHook(() => useFileEntityMapWithStats(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.statsLoading).toBe(false)
    })

    // Should use current (50 additions) not captured (10 additions)
    expect(result.current.fileEntityMap['src/index.ts'].changes['exec-001'].additions).toBe(50)
  })

  it('should handle stats fetch errors gracefully', async () => {
    mockExecutions = [mockExecution1]
    vi.mocked(relationshipsApi.getForEntity).mockResolvedValue({ outgoing: [], incoming: [] })
    vi.mocked(executionsApi.getChanges).mockRejectedValue(new Error('Failed to fetch changes'))

    const { result } = renderHook(() => useFileEntityMapWithStats(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Should fall back to default change info
    expect(result.current.fileEntityMap['src/index.ts'].changes['exec-001']).toEqual({
      additions: 0,
      deletions: 0,
      status: 'M',
    })
  })
})
