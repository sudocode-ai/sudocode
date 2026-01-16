import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useMacroAgentStatus,
  useMacroAgentAgents,
  useMacroAgentSessions,
  useExecutionMacroAgents,
  useExecutionMacroSession,
} from '@/hooks/useMacroAgent'
import { macroAgentApi } from '@/lib/api'
import type { AgentRecord, MacroAgentStatus } from '@/types/macro-agent'
import React from 'react'

// Mock the API module
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  macroAgentApi: {
    getStatus: vi.fn(),
    getAgents: vi.fn(),
    getSessions: vi.fn(),
    getExecutionAgents: vi.fn(),
    getExecutionSession: vi.fn(),
  },
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: vi.fn(() => ({
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
    connected: false,
  })),
}))

describe('useMacroAgent hooks', () => {
  let queryClient: QueryClient

  const mockStatus: MacroAgentStatus = {
    serverReady: true,
    observabilityConnected: true,
    agents: { total: 5, running: 3, stopped: 2 },
    sessions: { total: 2 },
    executions: { connected: 1 },
  }

  const mockAgents: AgentRecord[] = [
    {
      id: 'agent-1',
      session_id: 'session-1',
      task: 'Test task 1',
      state: 'running',
      parent: null,
      lineage: [],
      children_count: 2,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    {
      id: 'agent-2',
      session_id: 'session-1',
      task: 'Test task 2',
      state: 'stopped',
      parent: 'agent-1',
      lineage: ['agent-1'],
      children_count: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ]

  const mockSessions = [
    {
      id: 'session-1',
      agentCount: 3,
      runningCount: 2,
      connectedExecutions: ['exec-1'],
    },
    {
      id: 'session-2',
      agentCount: 2,
      runningCount: 1,
      connectedExecutions: [],
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

  describe('useMacroAgentStatus', () => {
    it('should fetch status on mount', async () => {
      vi.mocked(macroAgentApi.getStatus).mockResolvedValue(mockStatus)

      const { result } = renderHook(() => useMacroAgentStatus(), { wrapper })

      expect(result.current.loading).toBe(true)
      expect(result.current.status).toBeNull()

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.status).toEqual(mockStatus)
      expect(result.current.error).toBeNull()
      expect(macroAgentApi.getStatus).toHaveBeenCalledTimes(1)
    })

    it('should handle errors gracefully', async () => {
      const error = new Error('Failed to fetch status')
      vi.mocked(macroAgentApi.getStatus).mockRejectedValue(error)

      const { result } = renderHook(() => useMacroAgentStatus(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBeDefined()
      expect(result.current.status).toBeNull()
    })

    it('should return server and connection status', async () => {
      vi.mocked(macroAgentApi.getStatus).mockResolvedValue(mockStatus)

      const { result } = renderHook(() => useMacroAgentStatus(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.status?.serverReady).toBe(true)
      expect(result.current.status?.observabilityConnected).toBe(true)
      expect(result.current.status?.agents.total).toBe(5)
      expect(result.current.status?.agents.running).toBe(3)
      expect(result.current.status?.agents.stopped).toBe(2)
    })
  })

  describe('useMacroAgentAgents', () => {
    it('should fetch agents on mount', async () => {
      vi.mocked(macroAgentApi.getAgents).mockResolvedValue({
        agents: mockAgents,
        total: mockAgents.length,
      })

      const { result } = renderHook(() => useMacroAgentAgents(), { wrapper })

      expect(result.current.loading).toBe(true)

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.agents).toEqual(mockAgents)
      expect(result.current.total).toBe(2)
      expect(macroAgentApi.getAgents).toHaveBeenCalledTimes(1)
    })

    it('should support filtering by session', async () => {
      vi.mocked(macroAgentApi.getAgents).mockResolvedValue({
        agents: mockAgents,
        total: mockAgents.length,
      })

      const { result } = renderHook(
        () => useMacroAgentAgents({ session: 'session-1' }),
        { wrapper }
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(macroAgentApi.getAgents).toHaveBeenCalledWith({ session: 'session-1' })
    })

    it('should support filtering by state', async () => {
      vi.mocked(macroAgentApi.getAgents).mockResolvedValue({
        agents: [mockAgents[0]],
        total: 1,
      })

      const { result } = renderHook(() => useMacroAgentAgents({ state: 'running' }), {
        wrapper,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(macroAgentApi.getAgents).toHaveBeenCalledWith({ state: 'running' })
    })

    it('should return empty array when disabled', async () => {
      const { result } = renderHook(() => useMacroAgentAgents(undefined, false), {
        wrapper,
      })

      expect(result.current.agents).toEqual([])
      expect(result.current.loading).toBe(false)
      expect(macroAgentApi.getAgents).not.toHaveBeenCalled()
    })
  })

  describe('useMacroAgentSessions', () => {
    it('should fetch sessions on mount', async () => {
      vi.mocked(macroAgentApi.getSessions).mockResolvedValue({
        sessions: mockSessions,
        total: mockSessions.length,
      })

      const { result } = renderHook(() => useMacroAgentSessions(), { wrapper })

      expect(result.current.loading).toBe(true)

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.sessions).toEqual(mockSessions)
      expect(result.current.total).toBe(2)
    })

    it('should handle errors gracefully', async () => {
      const error = new Error('Service unavailable')
      vi.mocked(macroAgentApi.getSessions).mockRejectedValue(error)

      const { result } = renderHook(() => useMacroAgentSessions(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBeDefined()
      expect(result.current.sessions).toEqual([])
    })
  })

  describe('useExecutionMacroAgents', () => {
    it('should fetch agents for execution', async () => {
      vi.mocked(macroAgentApi.getExecutionAgents).mockResolvedValue({
        agents: mockAgents,
        sessionId: 'session-1',
        total: mockAgents.length,
      })

      const { result } = renderHook(() => useExecutionMacroAgents('exec-1'), {
        wrapper,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.agents).toEqual(mockAgents)
      expect(result.current.sessionId).toBe('session-1')
      expect(result.current.total).toBe(2)
      expect(macroAgentApi.getExecutionAgents).toHaveBeenCalledWith('exec-1')
    })

    it('should return empty when execution has no session', async () => {
      vi.mocked(macroAgentApi.getExecutionAgents).mockResolvedValue({
        agents: [],
        sessionId: null,
        total: 0,
      })

      const { result } = renderHook(() => useExecutionMacroAgents('exec-2'), {
        wrapper,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.agents).toEqual([])
      expect(result.current.sessionId).toBeNull()
      expect(result.current.total).toBe(0)
    })

    it('should not fetch when disabled', async () => {
      const { result } = renderHook(() => useExecutionMacroAgents('exec-1', false), {
        wrapper,
      })

      expect(result.current.loading).toBe(false)
      expect(macroAgentApi.getExecutionAgents).not.toHaveBeenCalled()
    })
  })

  describe('useExecutionMacroSession', () => {
    it('should fetch session for execution', async () => {
      vi.mocked(macroAgentApi.getExecutionSession).mockResolvedValue({
        sessionId: 'session-1',
        connectedAt: Date.now(),
        agentCount: 5,
        runningCount: 3,
      })

      const { result } = renderHook(() => useExecutionMacroSession('exec-1'), {
        wrapper,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.sessionId).toBe('session-1')
      expect(result.current.agentCount).toBe(5)
      expect(result.current.runningCount).toBe(3)
      expect(macroAgentApi.getExecutionSession).toHaveBeenCalledWith('exec-1')
    })

    it('should return null session when not connected', async () => {
      vi.mocked(macroAgentApi.getExecutionSession).mockResolvedValue({
        sessionId: null,
        connectedAt: null,
        agentCount: 0,
        runningCount: 0,
      })

      const { result } = renderHook(() => useExecutionMacroSession('exec-2'), {
        wrapper,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.sessionId).toBeNull()
      expect(result.current.connectedAt).toBeNull()
      expect(result.current.agentCount).toBe(0)
    })
  })
})
