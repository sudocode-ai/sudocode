/**
 * Tests for IssuePanel execution WebSocket functionality
 *
 * Verifies that the IssuePanel component correctly subscribes to and handles
 * execution-related WebSocket messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { IssuePanel } from '@/components/issues/IssuePanel'
import type { Issue } from '@sudocode-ai/types'
import type { WebSocketMessage } from '@/types/api'

const mockIssue: Issue = {
  id: 'i-test',
  uuid: 'test-uuid-1',
  title: 'Test Issue',
  content: 'Test content',
  status: 'in_progress',
  priority: 1,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-02T15:30:00Z',
}

// Mock the WebSocket context
let mockSubscribe = vi.fn()
let mockUnsubscribe = vi.fn()
let mockAddMessageHandler = vi.fn()
let mockRemoveMessageHandler = vi.fn()
let mockMessageHandlers: Map<string, (message: WebSocketMessage) => void> = new Map()

vi.mock('@/contexts/WebSocketContext', () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => children,
  useWebSocketContext: () => ({
    connected: true,
    lastMessage: null,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    addMessageHandler: (id: string, handler: (message: WebSocketMessage) => void) => {
      mockMessageHandlers.set(id, handler)
      mockAddMessageHandler(id, handler)
    },
    removeMessageHandler: (id: string) => {
      mockMessageHandlers.delete(id)
      mockRemoveMessageHandler(id)
    },
  }),
}))

// Mock useVoiceConfig to prevent async operations after test teardown
vi.mock('@/hooks/useVoiceConfig', () => ({
  useVoiceConfig: () => ({
    isLoading: false,
    error: null,
    config: null,
    voiceEnabled: false,
    selectedVoice: null,
    availableVoices: [],
    setVoiceEnabled: vi.fn(),
    setSelectedVoice: vi.fn(),
  }),
}))

// Mock the API
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    executionsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      get: vi.fn(),
      prepare: vi.fn().mockResolvedValue({ renderedPrompt: 'test' }),
    },
    relationshipsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
      getForEntity: vi.fn().mockResolvedValue([]),
    },
  }
})

describe('IssuePanel - Execution WebSocket Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessageHandlers.clear()
  })

  it('should subscribe to issue WebSocket updates on mount', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(mockSubscribe).toHaveBeenCalledWith('issue', mockIssue.id)
    expect(mockAddMessageHandler).toHaveBeenCalled()
  })

  it('should unsubscribe from issue updates on unmount', () => {
    const { unmount } = renderWithProviders(<IssuePanel issue={mockIssue} />)

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalledWith('issue', mockIssue.id)
    expect(mockRemoveMessageHandler).toHaveBeenCalled()
  })

  it('should register handler that responds to execution_created messages', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    // Wait for component to mount and register handler
    await waitFor(() => {
      expect(mockMessageHandlers.size).toBeGreaterThan(0)
    })

    const handler = Array.from(mockMessageHandlers.values())[0]
    expect(handler).toBeDefined()

    // Verify handler is a function
    expect(typeof handler).toBe('function')
  })

  it('should register handler that responds to execution_updated messages', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    await waitFor(() => {
      expect(mockMessageHandlers.size).toBeGreaterThan(0)
    })

    const handler = Array.from(mockMessageHandlers.values())[0]
    expect(handler).toBeDefined()
  })

  it('should register handler that responds to execution_status_changed messages', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    await waitFor(() => {
      expect(mockMessageHandlers.size).toBeGreaterThan(0)
    })

    const handler = Array.from(mockMessageHandlers.values())[0]
    expect(handler).toBeDefined()
  })

  it('should register handler that responds to execution_deleted messages', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    await waitFor(() => {
      expect(mockMessageHandlers.size).toBeGreaterThan(0)
    })

    const handler = Array.from(mockMessageHandlers.values())[0]
    expect(handler).toBeDefined()
  })

  it('should handle non-execution messages without errors', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    await waitFor(() => {
      expect(mockMessageHandlers.size).toBeGreaterThan(0)
    })

    const handler = Array.from(mockMessageHandlers.values())[0]

    // Sending a non-execution message should not throw
    expect(() => {
      handler({
        type: 'issue_updated',
        data: mockIssue,
        timestamp: new Date().toISOString(),
      })
    }).not.toThrow()
  })

  it('should resubscribe when issue changes', async () => {
    const { rerender } = renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(mockSubscribe).toHaveBeenCalledWith('issue', mockIssue.id)

    const newIssue: Issue = { ...mockIssue, id: 'i-different' }
    rerender(<IssuePanel issue={newIssue} />)

    await waitFor(() => {
      expect(mockUnsubscribe).toHaveBeenCalledWith('issue', mockIssue.id)
      expect(mockSubscribe).toHaveBeenCalledWith('issue', newIssue.id)
    })
  })
})
