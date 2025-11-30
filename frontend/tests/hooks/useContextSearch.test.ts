import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useContextSearch, saveRecentMention } from '@/hooks/useContextSearch'
import { filesApi, specsApi, issuesApi } from '@/lib/api'
import type { FileSearchResult, Spec, Issue } from '@/types/api'

// Mock the API modules
vi.mock('@/lib/api', () => ({
  filesApi: {
    search: vi.fn(),
  },
  specsApi: {
    getAll: vi.fn(),
  },
  issuesApi: {
    getAll: vi.fn(),
  },
}))

describe('useContextSearch', () => {
  const mockFileResults: FileSearchResult[] = [
    { path: 'src/components/Test.tsx', name: 'Test.tsx', isFile: true, matchType: 'prefix' },
    { path: 'src/utils/test.ts', name: 'test.ts', isFile: true, matchType: 'contains' },
  ]

  const mockSpecs: Spec[] = [
    {
      id: 's-test1',
      uuid: 'uuid-1',
      title: 'Test Spec',
      content: 'Test content',
      priority: 1,
      archived: false,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
      file_path: 'specs/test.md',
    } as Spec,
    {
      id: 's-abc123',
      uuid: 'uuid-2',
      title: 'Another Spec',
      content: 'Content',
      priority: 2,
      archived: false,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
      file_path: 'specs/another.md',
    } as Spec,
  ]

  const mockIssues: Issue[] = [
    {
      id: 'i-test1',
      uuid: 'uuid-3',
      title: 'Test Issue',
      content: 'Issue content',
      status: 'open',
      priority: 1,
      archived: false,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    } as Issue,
    {
      id: 'i-xyz789',
      uuid: 'uuid-4',
      title: 'Fix Bug',
      content: 'Bug content',
      status: 'open',
      priority: 2,
      archived: false,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    } as Issue,
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    // Default mock implementations
    vi.mocked(filesApi.search).mockResolvedValue(mockFileResults)
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
  })

  describe('Basic functionality', () => {
    it('should return empty results initially when query is empty', () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: '', projectId: 'test-project', enabled: true })
      )

      expect(result.current.results).toEqual([])
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should not search when enabled is false', async () => {
      renderHook(() => useContextSearch({ query: 'test', projectId: 'test-project', enabled: false }))

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(filesApi.search).not.toHaveBeenCalled()
      expect(specsApi.getAll).not.toHaveBeenCalled()
      expect(issuesApi.getAll).not.toHaveBeenCalled()
    })

    it('should provide refetch function', () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'test', projectId: 'test-project', enabled: true })
      )

      expect(typeof result.current.refetch).toBe('function')
    })
  })

  describe('Search execution', () => {
    it('should search all sources when query is provided', async () => {
      renderHook(() => useContextSearch({ query: 'test', projectId: 'test-project', enabled: true }))

      await waitFor(
        () => {
          expect(filesApi.search).toHaveBeenCalledWith('test', { limit: 20 })
        },
        { timeout: 2000 }
      )

      expect(specsApi.getAll).toHaveBeenCalled()
      expect(issuesApi.getAll).toHaveBeenCalled()
    })

    it('should merge results from all sources', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'test', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const types = result.current.results.map((r) => r.type)
      expect(types).toContain('file')
      expect(types).toContain('spec')
      expect(types).toContain('issue')
    })

    it('should filter specs by query', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'Another', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const specResults = result.current.results.filter((r) => r.type === 'spec')
      expect(specResults.some((r) => r.title === 'Another Spec')).toBe(true)
      expect(specResults.some((r) => r.title === 'Test Spec')).toBe(false)
    })

    it('should filter issues by query', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'Fix', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const issueResults = result.current.results.filter((r) => r.type === 'issue')
      expect(issueResults.some((r) => r.title === 'Fix Bug')).toBe(true)
      expect(issueResults.some((r) => r.title === 'Test Issue')).toBe(false)
    })

    it('should match by entity ID', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 's-abc123', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const specResults = result.current.results.filter((r) => r.type === 'spec')
      expect(specResults.some((r) => r.entityId === 's-abc123')).toBe(true)
    })
  })

  describe('Result ranking', () => {
    it('should assign high match scores to exact matches', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'Test Spec', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const exactMatch = result.current.results.find((r) => r.title === 'Test Spec')
      expect(exactMatch?.matchScore).toBeGreaterThanOrEqual(100)
    })

    it('should limit results to 15 total', async () => {
      // Create many results
      const manyFiles: FileSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
        path: `file${i}.ts`,
        name: `file${i}.ts`,
        isFile: true,
        matchType: 'contains' as const,
      }))

      vi.mocked(filesApi.search).mockResolvedValue(manyFiles)

      const { result } = renderHook(() =>
        useContextSearch({ query: 'test', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      expect(result.current.results.length).toBeLessThanOrEqual(15)
    })
  })

  describe('Result formatting', () => {
    it('should format file results correctly', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'Test.tsx', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const fileResult = result.current.results.find((r) => r.type === 'file')
      expect(fileResult).toBeDefined()
      expect(fileResult?.displayText).toBe('Test.tsx')
      expect(fileResult?.insertText).toBe('src/components/Test.tsx')
    })

    it('should format spec results with [[id]] syntax', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'Test Spec', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const specResult = result.current.results.find((r) => r.type === 'spec')
      expect(specResult).toBeDefined()
      expect(specResult?.displayText).toBe('Test Spec')
      expect(specResult?.insertText).toBe('[[s-test1]]')
      expect(specResult?.entityId).toBe('s-test1')
    })

    it('should format issue results with [[id]] syntax', async () => {
      const { result } = renderHook(() =>
        useContextSearch({ query: 'Test Issue', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const issueResult = result.current.results.find((r) => r.type === 'issue')
      expect(issueResult).toBeDefined()
      expect(issueResult?.displayText).toBe('Test Issue')
      expect(issueResult?.insertText).toBe('[[i-test1]]')
      expect(issueResult?.entityId).toBe('i-test1')
    })
  })

  describe('Recent mentions tracking', () => {
    it('should store recent mentions in localStorage', () => {
      saveRecentMention('s-test1')
      saveRecentMention('i-test1')

      const stored = localStorage.getItem('sudocode:recentMentions')
      expect(stored).toBeTruthy()

      const parsed = JSON.parse(stored!)
      expect(parsed['s-test1']).toBeTruthy()
      expect(parsed['i-test1']).toBeTruthy()
    })

    it('should limit recent mentions to 20', () => {
      // Add 25 mentions
      for (let i = 0; i < 25; i++) {
        saveRecentMention(`s-test${i}`)
      }

      const stored = localStorage.getItem('sudocode:recentMentions')
      const parsed = JSON.parse(stored!)
      expect(Object.keys(parsed).length).toBeLessThanOrEqual(20)
    })

    it('should boost recently used results', async () => {
      // Save a recent mention
      saveRecentMention('s-abc123')

      const { result } = renderHook(() =>
        useContextSearch({ query: 'Spec', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      const recentSpec = result.current.results.find((r) => r.entityId === 's-abc123')
      expect(recentSpec).toBeDefined()
      // Should have boost
      expect(recentSpec?.matchScore).toBeGreaterThan(50)
    })
  })

  describe('Error handling', () => {
    it('should continue with other results if one search fails', async () => {
      vi.mocked(filesApi.search).mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() =>
        useContextSearch({ query: 'test', projectId: 'test-project', enabled: true })
      )

      await waitFor(
        () => {
          expect(result.current.results.length).toBeGreaterThan(0)
        },
        { timeout: 2000 }
      )

      // Should still have specs and issues
      const types = result.current.results.map((r) => r.type)
      expect(types).toContain('spec')
      expect(types).toContain('issue')
      expect(types).not.toContain('file')
    })
  })
})
