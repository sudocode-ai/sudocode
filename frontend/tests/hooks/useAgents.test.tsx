import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAgents } from '@/hooks/useAgents'
import { agentsApi } from '@/lib/api'
import type { AgentInfo } from '@/types/api'
import React from 'react'

// Mock the API module
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  agentsApi: {
    getAll: vi.fn(),
  },
}))

describe('useAgents', () => {
  let queryClient: QueryClient

  const mockAgents: AgentInfo[] = [
    {
      type: 'claude-code',
      displayName: 'Claude Code',
      supportedModes: ['structured', 'interactive', 'hybrid'],
      supportsStreaming: true,
      supportsStructuredOutput: true,
      implemented: true,
    },
    {
      type: 'codex',
      displayName: 'OpenAI Codex',
      supportedModes: ['structured'],
      supportsStreaming: false,
      supportsStructuredOutput: true,
      implemented: false,
    },
    {
      type: 'copilot',
      displayName: 'GitHub Copilot',
      supportedModes: ['interactive'],
      supportsStreaming: true,
      supportsStructuredOutput: false,
      implemented: false,
    },
    {
      type: 'cursor',
      displayName: 'Cursor',
      supportedModes: ['interactive'],
      supportsStreaming: true,
      supportsStructuredOutput: false,
      implemented: false,
    },
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
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('should fetch agents on mount', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result } = renderHook(() => useAgents(), { wrapper })

    // Initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.agents).toBeNull()

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.agents).toEqual(mockAgents)
    expect(result.current.error).toBeNull()
    expect(agentsApi.getAll).toHaveBeenCalledTimes(1)
  })

  it('should return loading state while fetching', () => {
    vi.mocked(agentsApi.getAll).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    const { result } = renderHook(() => useAgents(), { wrapper })

    expect(result.current.loading).toBe(true)
    expect(result.current.agents).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('should handle errors gracefully', async () => {
    const error = new Error('Failed to fetch agents')
    vi.mocked(agentsApi.getAll).mockRejectedValue(error)

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeDefined()
    expect(result.current.agents).toBeNull()
  })

  it('should cache results and not refetch on every render', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result, rerender } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(agentsApi.getAll).toHaveBeenCalledTimes(1)

    // Rerender should use cached data
    rerender()

    expect(result.current.agents).toEqual(mockAgents)
    expect(agentsApi.getAll).toHaveBeenCalledTimes(1) // Still only called once
  })

  it('should refetch when refetch function is called', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(agentsApi.getAll).toHaveBeenCalledTimes(1)

    // Call refetch
    result.current.refetch()

    await waitFor(() => {
      expect(agentsApi.getAll).toHaveBeenCalledTimes(2)
    })

    expect(result.current.agents).toEqual(mockAgents)
  })

  it('should return all 4 agents', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.agents).toHaveLength(4)
    expect(result.current.agents?.map((a) => a.type)).toEqual([
      'claude-code',
      'codex',
      'copilot',
      'cursor',
    ])
  })

  it('should correctly identify implemented vs stub agents', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const claudeCode = result.current.agents?.find((a) => a.type === 'claude-code')
    const codex = result.current.agents?.find((a) => a.type === 'codex')

    expect(claudeCode?.implemented).toBe(true)
    expect(codex?.implemented).toBe(false)
  })

  it('should return agent capabilities correctly', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const claudeCode = result.current.agents?.find((a) => a.type === 'claude-code')

    expect(claudeCode?.supportedModes).toEqual(['structured', 'interactive', 'hybrid'])
    expect(claudeCode?.supportsStreaming).toBe(true)
    expect(claudeCode?.supportsStructuredOutput).toBe(true)
  })

  it('should handle empty agent list', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue([])

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.agents).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('should return all required agent fields', async () => {
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    const { result } = renderHook(() => useAgents(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const agent = result.current.agents?.[0]

    expect(agent).toHaveProperty('type')
    expect(agent).toHaveProperty('displayName')
    expect(agent).toHaveProperty('supportedModes')
    expect(agent).toHaveProperty('supportsStreaming')
    expect(agent).toHaveProperty('supportsStructuredOutput')
    expect(agent).toHaveProperty('implemented')

    expect(typeof agent?.type).toBe('string')
    expect(typeof agent?.displayName).toBe('string')
    expect(Array.isArray(agent?.supportedModes)).toBe(true)
    expect(typeof agent?.supportsStreaming).toBe('boolean')
    expect(typeof agent?.supportsStructuredOutput).toBe('boolean')
    expect(typeof agent?.implemented).toBe('boolean')
  })
})
