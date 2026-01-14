import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCodeGraph } from '@/hooks/useCodeGraph'
import { codevizApi } from '@/lib/api'
import { createElement, type ReactNode } from 'react'
import type { WebSocketMessage } from '@/types/api'

// Mock Project context
let mockProjectId: string | null = 'test-project-id'

// Store message handler for simulating WebSocket events
let mockMessageHandler: ((message: WebSocketMessage) => void) | null = null

// Mock the API
vi.mock('@/lib/api', () => ({
  codevizApi: {
    getFileTree: vi.fn(),
    getCodeGraph: vi.fn(),
    triggerAnalysis: vi.fn(),
    triggerIncrementalAnalysis: vi.fn(),
    getAnalysisStatus: vi.fn(),
    startWatcher: vi.fn(),
    stopWatcher: vi.fn(),
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

// Mock file tree response
const mockFileTree = {
  files: [
    { path: 'src/index.ts', name: 'index.ts', extension: 'ts', directoryPath: 'src' },
    { path: 'src/utils.ts', name: 'utils.ts', extension: 'ts', directoryPath: 'src' },
    { path: 'README.md', name: 'README.md', extension: 'md', directoryPath: '' },
  ],
  directories: [{ path: 'src', name: 'src', parentPath: null }],
  metadata: {
    totalFiles: 3,
    totalDirectories: 1,
    generatedAt: '2024-01-01T00:00:00Z',
  },
}

// Mock code graph response with complete FileNode structure
const mockCodeGraph = {
  files: [
    {
      id: 'f1',
      path: 'src/index.ts',
      name: 'index.ts',
      extension: 'ts',
      directoryId: 'd1',
      metrics: { loc: 100, totalLines: 120, exportCount: 5, importCount: 3 },
      symbols: ['s1'],
      language: 'typescript',
    },
    {
      id: 'f2',
      path: 'src/utils.ts',
      name: 'utils.ts',
      extension: 'ts',
      directoryId: 'd1',
      metrics: { loc: 50, totalLines: 60, exportCount: 2, importCount: 1 },
      symbols: [],
      language: 'typescript',
    },
  ],
  directories: [
    {
      id: 'd1',
      path: 'src',
      name: 'src',
      parentId: null,
      children: [],
      files: ['f1', 'f2'],
      metrics: { fileCount: 2, totalLoc: 150 },
      depth: 0,
    },
  ],
  symbols: [
    {
      id: 's1',
      name: 'main',
      kind: 'function' as const,
      fileId: 'f1',
      location: { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 },
      exported: true,
      metrics: { loc: 10 },
    },
  ],
  imports: [],
  calls: [],
  metadata: {
    rootPath: '/test/project',
    totalFiles: 2,
    totalDirectories: 1,
    totalSymbols: 1,
    languages: ['typescript'],
    analyzedAt: '2024-01-01T00:00:00Z',
    analysisDurationMs: 500,
  },
}

const mockCodeGraphResponse = {
  codeGraph: mockCodeGraph,
  gitSha: 'abc123def456',
  analyzedAt: '2024-01-01T00:00:00Z',
  stats: {
    fileCount: 2,
    symbolCount: 1,
    analysisDurationMs: 500,
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

describe('useCodeGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
    mockMessageHandler = null
    // Default: analysis status returns idle
    vi.mocked(codevizApi.getAnalysisStatus).mockResolvedValue({
      status: 'idle',
      gitSha: 'abc123',
    })
  })

  describe('initial loading', () => {
    it('should fetch file tree on mount', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.fileTree).toEqual(mockFileTree)
      expect(codevizApi.getFileTree).toHaveBeenCalledTimes(1)
    })

    it('should return null codeGraph when not cached (404)', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.codeGraph).toBeNull()
      expect(result.current.fileTree).toEqual(mockFileTree)
      expect(result.current.error).toBeNull()
    })

    it('should return codeGraph when cached', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockResolvedValue(mockCodeGraphResponse)

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.codeGraph).toEqual(mockCodeGraph)
      expect(result.current.gitSha).toBe('abc123def456')
      expect(result.current.analyzedAt).toBe('2024-01-01T00:00:00Z')
      expect(result.current.stats).toEqual({
        fileCount: 2,
        symbolCount: 1,
        analysisDurationMs: 500,
      })
    })
  })

  describe('triggerAnalysis', () => {
    it('should start analysis and set isAnalyzing to true', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })
      vi.mocked(codevizApi.triggerIncrementalAnalysis).mockResolvedValue({
        analysisId: 'analysis-123',
        gitSha: 'abc123',
        status: 'started',
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.triggerAnalysis()
      })

      expect(result.current.isAnalyzing).toBe(true)
      expect(codevizApi.triggerIncrementalAnalysis).toHaveBeenCalled()
    })

    it('should handle already_cached status', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })
      vi.mocked(codevizApi.triggerIncrementalAnalysis).mockResolvedValue({
        analysisId: null,
        gitSha: 'abc123',
        status: 'already_cached',
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.triggerAnalysis()
      })

      // Should not be analyzing since already cached
      expect(result.current.isAnalyzing).toBe(false)
    })
  })

  describe('WebSocket events', () => {
    it('should update progress on code_graph_progress event', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Simulate WebSocket progress event
      act(() => {
        mockMessageHandler?.({
          type: 'code_graph_progress',
          data: {
            phase: 'parsing',
            current: 50,
            total: 100,
            currentFile: 'src/index.ts',
          },
        })
      })

      expect(result.current.isAnalyzing).toBe(true)
      expect(result.current.analysisProgress).toEqual({
        phase: 'parsing',
        current: 50,
        total: 100,
        currentFile: 'src/index.ts',
      })
    })

    it('should clear analyzing state on code_graph_ready event', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })
      vi.mocked(codevizApi.triggerIncrementalAnalysis).mockResolvedValue({
        analysisId: 'analysis-123',
        gitSha: 'abc123',
        status: 'started',
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Start analysis
      await act(async () => {
        await result.current.triggerAnalysis()
      })

      expect(result.current.isAnalyzing).toBe(true)

      // Simulate completion event
      act(() => {
        mockMessageHandler?.({
          type: 'code_graph_ready',
          data: {
            gitSha: 'abc123',
            fileCount: 10,
            symbolCount: 50,
            analysisDurationMs: 1000,
          },
        })
      })

      expect(result.current.isAnalyzing).toBe(false)
      expect(result.current.analysisProgress).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const error = new Error('Network error')
      vi.mocked(codevizApi.getFileTree).mockRejectedValue(error)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue(error)

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBeTruthy()
      expect(result.current.fileTree).toBeNull()
      expect(result.current.codeGraph).toBeNull()
    })

    it('should not treat 404 as error for code graph', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // 404 should not be an error - just means no cache
      expect(result.current.error).toBeNull()
      expect(result.current.codeGraph).toBeNull()
      expect(result.current.fileTree).toEqual(mockFileTree)
    })
  })

  describe('analysis status polling', () => {
    it('should check analysis status on mount', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockRejectedValue({
        response: { status: 404 },
      })
      vi.mocked(codevizApi.getAnalysisStatus).mockResolvedValue({
        status: 'running',
        gitSha: 'abc123',
        phase: 'parsing',
        progress: { current: 25, total: 100 },
        currentFile: 'src/utils.ts',
      })

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isAnalyzing).toBe(true)
      })

      expect(result.current.analysisProgress).toEqual({
        phase: 'parsing',
        current: 25,
        total: 100,
        currentFile: 'src/utils.ts',
      })
    })
  })

  describe('refetch', () => {
    it('should refetch both file tree and code graph', async () => {
      vi.mocked(codevizApi.getFileTree).mockResolvedValue(mockFileTree)
      vi.mocked(codevizApi.getCodeGraph).mockResolvedValue(mockCodeGraphResponse)

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(codevizApi.getFileTree).toHaveBeenCalledTimes(1)
      expect(codevizApi.getCodeGraph).toHaveBeenCalledTimes(1)

      // Call refetch
      act(() => {
        result.current.refetch()
      })

      await waitFor(() => {
        expect(codevizApi.getFileTree).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('disabled when no project', () => {
    it('should not fetch when projectId is null', async () => {
      mockProjectId = null

      const { result } = renderHook(() => useCodeGraph(), {
        wrapper: createWrapper(),
      })

      // Should not be loading or fetching
      expect(result.current.isLoading).toBe(false)
      expect(codevizApi.getFileTree).not.toHaveBeenCalled()
      expect(codevizApi.getCodeGraph).not.toHaveBeenCalled()
    })
  })
})
