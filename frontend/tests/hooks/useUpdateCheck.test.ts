import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useUpdateCheck, useUpdateMutations } from '@/hooks/useUpdateCheck'

// Mock the API module
const mockUpdateApi = {
  check: vi.fn(),
  install: vi.fn(),
  dismiss: vi.fn(),
  restart: vi.fn(),
}

vi.mock('@/lib/api', () => ({
  updateApi: {
    check: () => mockUpdateApi.check(),
    install: () => mockUpdateApi.install(),
    dismiss: (version: string) => mockUpdateApi.dismiss(version),
    restart: () => mockUpdateApi.restart(),
  },
}))

describe('useUpdateCheck', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  })

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  describe('Update Check Query', () => {
    it('should return null updateInfo while loading', () => {
      mockUpdateApi.check.mockReturnValue(new Promise(() => {})) // Never resolves

      const { result } = renderHook(() => useUpdateCheck(), { wrapper })

      expect(result.current.updateInfo).toBeNull()
      expect(result.current.loading).toBe(true)
    })

    it('should return update info when update is available', async () => {
      mockUpdateApi.check.mockResolvedValue({
        current: '0.1.15',
        latest: '0.1.16',
        updateAvailable: true,
      })

      const { result } = renderHook(() => useUpdateCheck(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.updateInfo).toEqual({
        current: '0.1.15',
        latest: '0.1.16',
        updateAvailable: true,
      })
      expect(result.current.error).toBeNull()
    })

    it('should return update info when no update is available', async () => {
      mockUpdateApi.check.mockResolvedValue({
        current: '0.1.15',
        latest: '0.1.15',
        updateAvailable: false,
      })

      const { result } = renderHook(() => useUpdateCheck(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.updateInfo).toEqual({
        current: '0.1.15',
        latest: '0.1.15',
        updateAvailable: false,
      })
    })

    it('should handle errors gracefully', async () => {
      mockUpdateApi.check.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useUpdateCheck(), { wrapper })

      await waitFor(() => {
        expect(result.current.error).toBeDefined()
      })

      expect(result.current.updateInfo).toBeNull()
    })

    it('should provide refetch function', async () => {
      mockUpdateApi.check.mockResolvedValue({
        current: '0.1.15',
        latest: '0.1.16',
        updateAvailable: true,
      })

      const { result } = renderHook(() => useUpdateCheck(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(typeof result.current.refetch).toBe('function')

      // Call refetch
      await act(async () => {
        await result.current.refetch()
      })

      expect(mockUpdateApi.check).toHaveBeenCalledTimes(2)
    })
  })
})

describe('useUpdateMutations', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    // Mock fetch for health polling
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  describe('installUpdate mutation', () => {
    it('should call install API', async () => {
      mockUpdateApi.install.mockResolvedValue({
        success: true,
        message: 'Update installed',
        requiresRestart: true,
      })

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      await act(async () => {
        await result.current.installUpdate.mutateAsync()
      })

      expect(mockUpdateApi.install).toHaveBeenCalledTimes(1)
    })

    it('should handle install errors', async () => {
      mockUpdateApi.install.mockRejectedValue(new Error('Installation failed'))

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      await expect(
        act(async () => {
          await result.current.installUpdate.mutateAsync()
        })
      ).rejects.toThrow('Installation failed')
    })

    it('should set isPending during install', async () => {
      let resolveInstall: (value: unknown) => void
      mockUpdateApi.install.mockReturnValue(
        new Promise((resolve) => {
          resolveInstall = resolve
        })
      )

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      expect(result.current.installUpdate.isPending).toBe(false)

      let mutatePromise: Promise<unknown>
      act(() => {
        mutatePromise = result.current.installUpdate.mutateAsync()
      })

      await waitFor(() => {
        expect(result.current.installUpdate.isPending).toBe(true)
      })

      await act(async () => {
        resolveInstall!({ success: true, message: 'Done' })
        await mutatePromise
      })

      await waitFor(() => {
        expect(result.current.installUpdate.isPending).toBe(false)
      })
    })
  })

  describe('dismissUpdate mutation', () => {
    it('should call dismiss API with version', async () => {
      mockUpdateApi.dismiss.mockResolvedValue({ message: 'Dismissed' })

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      await act(async () => {
        await result.current.dismissUpdate.mutateAsync('0.1.16')
      })

      expect(mockUpdateApi.dismiss).toHaveBeenCalledWith('0.1.16')
    })

    it('should handle dismiss errors', async () => {
      mockUpdateApi.dismiss.mockRejectedValue(new Error('Dismiss failed'))

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      await expect(
        act(async () => {
          await result.current.dismissUpdate.mutateAsync('0.1.16')
        })
      ).rejects.toThrow('Dismiss failed')
    })
  })

  describe('restartServer', () => {
    it('should start with idle state', () => {
      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      expect(result.current.restartServer.restartState).toBe('idle')
    })

    it('should set restartState to restarting when restart is called', async () => {
      mockUpdateApi.restart.mockResolvedValue({ message: 'Restarting...' })
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
      } as Response)

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      // Start restart but don't await
      act(() => {
        result.current.restartServer.handleRestart()
      })

      await waitFor(() => {
        expect(
          result.current.restartServer.restartState === 'restarting' ||
            result.current.restartServer.restartState === 'polling'
        ).toBe(true)
      })
    })

    it('should transition to polling state after restart call', async () => {
      mockUpdateApi.restart.mockResolvedValue({ message: 'Restarting...' })
      // Mock fetch to not respond immediately
      vi.mocked(global.fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: true } as Response), 100)
          })
      )

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      act(() => {
        result.current.restartServer.handleRestart()
      })

      // Should eventually be polling
      await waitFor(
        () => {
          expect(result.current.restartServer.restartState).toBe('polling')
        },
        { timeout: 1000 }
      )
    })

    it('should handle restart when API call fails', async () => {
      // Even if API call fails (server shuts down), should start polling
      mockUpdateApi.restart.mockRejectedValue(new Error('Connection reset'))
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response)

      const { result } = renderHook(() => useUpdateMutations(), { wrapper })

      act(() => {
        result.current.restartServer.handleRestart()
      })

      // Should still transition to polling even on error
      await waitFor(
        () => {
          expect(result.current.restartServer.restartState).toBe('polling')
        },
        { timeout: 1000 }
      )
    })
  })
})
