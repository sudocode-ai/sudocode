/**
 * useExecutionLogs Hook Tests
 *
 * Tests for the execution logs fetching and parsing React hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useExecutionLogs } from '@/hooks/useExecutionLogs'
import * as claudeToAgUi from '../../../server/src/execution/output/claude-to-ag-ui.js'

// Mock the parseExecutionLogs function
vi.mock('../../../server/src/execution/output/claude-to-ag-ui.js', () => ({
  parseExecutionLogs: vi.fn(),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe('useExecutionLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Functionality', () => {
    it('should fetch logs on mount', async () => {
      const mockResponse = {
        success: true,
        data: {
          executionId: 'exec-123',
          logs: ['{"type":"assistant","message":{}}'],
          metadata: {
            lineCount: 1,
            byteSize: 100,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        },
      }

      const mockEvents = [{ type: 'CUSTOM', timestamp: Date.now() }]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce(mockEvents as any)

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      // Initially loading
      expect(result.current.loading).toBe(true)
      expect(result.current.events).toEqual([])
      expect(result.current.error).toBeNull()

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith('/api/executions/exec-123/logs', {
        signal: expect.any(AbortSignal),
      })

      // Verify parseExecutionLogs was called
      expect(claudeToAgUi.parseExecutionLogs).toHaveBeenCalledWith([
        '{"type":"assistant","message":{}}',
      ])

      // Verify state is updated
      expect(result.current.events).toEqual(mockEvents)
      expect(result.current.metadata).toEqual(mockResponse.data.metadata)
      expect(result.current.error).toBeNull()
    })

    it('should transform logs to AG-UI events', async () => {
      const mockLogs = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
        '{"type":"result","usage":{"input_tokens":10,"output_tokens":5}}',
      ]

      const mockEvents = [
        { type: 'CUSTOM', name: 'TEXT_MESSAGE_CONTENT', value: { content: 'Hello' } },
        { type: 'CUSTOM', name: 'USAGE_UPDATE', value: { inputTokens: 10, outputTokens: 5 } },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            executionId: 'exec-123',
            logs: mockLogs,
            metadata: { lineCount: 2, byteSize: 200, createdAt: '', updatedAt: '' },
          },
        }),
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce(mockEvents as any)

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(claudeToAgUi.parseExecutionLogs).toHaveBeenCalledWith(mockLogs)
      expect(result.current.events).toEqual(mockEvents)
    })

    it('should handle empty logs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            executionId: 'exec-123',
            logs: [],
            metadata: { lineCount: 0, byteSize: 0, createdAt: '', updatedAt: '' },
          },
        }),
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce([])

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.events).toEqual([])
      expect(result.current.metadata?.lineCount).toBe(0)
      expect(result.current.error).toBeNull()
    })

    it('should handle large logs (1000+ lines)', async () => {
      const largeLogs = Array.from({ length: 1000 }, (_, i) =>
        JSON.stringify({ type: 'test', index: i })
      )

      const largeEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: 'CUSTOM',
        timestamp: Date.now() + i,
      }))

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            executionId: 'exec-123',
            logs: largeLogs,
            metadata: { lineCount: 1000, byteSize: 50000, createdAt: '', updatedAt: '' },
          },
        }),
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce(largeEvents as any)

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.events).toHaveLength(1000)
      expect(result.current.metadata?.lineCount).toBe(1000)
    })
  })

  describe('Error Handling', () => {
    it('should handle 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const { result } = renderHook(() => useExecutionLogs('exec-404'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toContain('Execution not found')
      expect(result.current.events).toEqual([])
      expect(result.current.metadata).toBeNull()
    })

    it('should handle 500 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const { result } = renderHook(() => useExecutionLogs('exec-500'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toContain('Failed to fetch execution logs')
      expect(result.current.error?.message).toContain('500')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useExecutionLogs('exec-net-err'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toBe('Network error')
    })

    it('should handle parse errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            executionId: 'exec-123',
            logs: ['invalid json'],
            metadata: { lineCount: 1, byteSize: 12, createdAt: '', updatedAt: '' },
          },
        }),
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockRejectedValueOnce(
        new Error('JSON parse error at line 1')
      )

      const { result } = renderHook(() => useExecutionLogs('exec-parse-err'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toContain('JSON parse error')
    })

    it('should handle API error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          message: 'Database connection failed',
        }),
      })

      const { result } = renderHook(() => useExecutionLogs('exec-api-err'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).not.toBeNull()
      expect(result.current.error?.message).toBe('Database connection failed')
    })
  })

  describe('Execution ID Changes', () => {
    it('should re-fetch when executionId changes', async () => {
      const mockResponse1 = {
        success: true,
        data: {
          executionId: 'exec-1',
          logs: ['log1'],
          metadata: { lineCount: 1, byteSize: 10, createdAt: '', updatedAt: '' },
        },
      }

      const mockResponse2 = {
        success: true,
        data: {
          executionId: 'exec-2',
          logs: ['log2'],
          metadata: { lineCount: 1, byteSize: 10, createdAt: '', updatedAt: '' },
        },
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse2,
        })

      vi.mocked(claudeToAgUi.parseExecutionLogs)
        .mockResolvedValueOnce([{ type: 'EVENT1' }] as any)
        .mockResolvedValueOnce([{ type: 'EVENT2' }] as any)

      const { result, rerender } = renderHook(({ id }) => useExecutionLogs(id), {
        initialProps: { id: 'exec-1' },
      })

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.events).toEqual([{ type: 'EVENT1' }])

      // Change execution ID
      rerender({ id: 'exec-2' })

      // Should be loading again
      expect(result.current.loading).toBe(true)

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.events).toEqual([{ type: 'EVENT2' }])
    })

    it('should abort previous request on ID change', async () => {
      let abortedSignal: AbortSignal | null = null

      mockFetch.mockImplementation((_url, options) => {
        abortedSignal = (options as any).signal
        return new Promise(() => {}) // Never resolves
      })

      const { rerender } = renderHook(({ id }) => useExecutionLogs(id), {
        initialProps: { id: 'exec-1' },
      })

      // Give it time to start the fetch
      await new Promise((resolve) => setTimeout(resolve, 10))

      const firstSignal = abortedSignal!
      expect(firstSignal).not.toBeNull()
      expect(firstSignal.aborted).toBe(false)

      // Change execution ID
      rerender({ id: 'exec-2' })

      // Previous request should be aborted
      expect(firstSignal.aborted).toBe(true)
    })

    it('should reset state when ID changes', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              executionId: 'exec-1',
              logs: ['log1'],
              metadata: { lineCount: 1, byteSize: 10, createdAt: '', updatedAt: '' },
            },
          }),
        })
        .mockImplementation(
          () => new Promise(() => {}) // Second request never resolves
        )

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce([{ type: 'EVENT1' }] as any)

      const { result, rerender } = renderHook(({ id }) => useExecutionLogs(id), {
        initialProps: { id: 'exec-1' },
      })

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.events).toEqual([{ type: 'EVENT1' }])

      // Change execution ID
      rerender({ id: 'exec-2' })

      // State should be reset immediately
      expect(result.current.loading).toBe(true)
      expect(result.current.events).toEqual([])
      expect(result.current.metadata).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('Loading States', () => {
    it('should set loading state correctly', async () => {
      const loadingStates: boolean[] = []

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            executionId: 'exec-123',
            logs: [],
            metadata: { lineCount: 0, byteSize: 0, createdAt: '', updatedAt: '' },
          },
        }),
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce([])

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      // Track loading states
      loadingStates.push(result.current.loading)

      await waitFor(() => expect(result.current.loading).toBe(false))

      loadingStates.push(result.current.loading)

      // Should start as true, then become false
      expect(loadingStates).toEqual([true, false])
    })

    it('should set loading to false even on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      expect(result.current.loading).toBe(true)

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.loading).toBe(false)
      expect(result.current.error).not.toBeNull()
    })
  })

  describe('Cleanup', () => {
    it('should abort fetch on unmount', async () => {
      let abortedSignal: AbortSignal | null = null

      mockFetch.mockImplementation((_url, options) => {
        abortedSignal = (options as any).signal
        return new Promise(() => {}) // Never resolves
      })

      const { unmount } = renderHook(() => useExecutionLogs('exec-123'))

      // Give it time to start the fetch
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(abortedSignal).not.toBeNull()
      expect(abortedSignal!.aborted).toBe(false)

      // Unmount
      unmount()

      // Should be aborted
      expect(abortedSignal!.aborted).toBe(true)
    })

    it('should not update state after abort', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({
                  success: true,
                  data: {
                    executionId: 'exec-123',
                    logs: [],
                    metadata: { lineCount: 0, byteSize: 0, createdAt: '', updatedAt: '' },
                  },
                }),
              })
            }, 100)
          })
      )

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce([])

      const { result, unmount } = renderHook(() => useExecutionLogs('exec-123'))

      // Unmount immediately
      unmount()

      // Wait for the fetch to "complete"
      await new Promise((resolve) => setTimeout(resolve, 150))

      // State should still be initial values (not updated after abort)
      expect(result.current.loading).toBe(true)
      expect(result.current.events).toEqual([])
    })
  })

  describe('Metadata', () => {
    it('should return metadata from response', async () => {
      const mockMetadata = {
        lineCount: 42,
        byteSize: 1024,
        createdAt: '2025-01-01T10:00:00Z',
        updatedAt: '2025-01-01T11:00:00Z',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            executionId: 'exec-123',
            logs: [],
            metadata: mockMetadata,
          },
        }),
      })

      vi.mocked(claudeToAgUi.parseExecutionLogs).mockResolvedValueOnce([])

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.metadata).toEqual(mockMetadata)
    })

    it('should set metadata to null on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useExecutionLogs('exec-123'))

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.metadata).toBeNull()
    })
  })
})
