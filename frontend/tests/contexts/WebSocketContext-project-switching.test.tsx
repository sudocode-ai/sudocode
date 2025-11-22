import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { WebSocketProvider, useWebSocketContext } from '@/contexts/WebSocketContext'
import { ProjectProvider } from '@/contexts/ProjectContext'
import type { WebSocketMessage } from '@/types/api'

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    // Simulate connection opening after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.(new Event('open'))
    }, 10)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  // Helper to simulate receiving a message
  simulateMessage(message: WebSocketMessage) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

global.WebSocket = MockWebSocket as any

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

describe('WebSocketContext - Project Switching', () => {
  let mockWs: MockWebSocket

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    // Capture the WebSocket instance
    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
      }
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const createWrapper = (projectId: string | null = 'project-1') => {
    return ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider defaultProjectId={projectId} skipValidation={true}>
        <WebSocketProvider>{children}</WebSocketProvider>
      </ProjectProvider>
    )
  }

  it('should include project_id in subscription messages', async () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-1'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.subscribe('issue')
    })

    // Check that subscription message includes project_id
    const sentMessages = mockWs.sentMessages.map((msg) => JSON.parse(msg))
    const subscribeMsg = sentMessages.find((msg) => msg.type === 'subscribe')

    expect(subscribeMsg).toBeDefined()
    expect(subscribeMsg.project_id).toBe('project-1')
    expect(subscribeMsg.entity_type).toBe('issue')
  })

  it('should filter out messages from different projects', async () => {
    const messageHandler = vi.fn()

    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-1'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    // Add message handler
    act(() => {
      result.current.addMessageHandler('test', messageHandler)
    })

    // Simulate message from current project
    act(() => {
      mockWs.simulateMessage({
        type: 'issue_created',
        projectId: 'project-1',
        data: { id: 'issue-1' } as any,
      })
    })

    expect(messageHandler).toHaveBeenCalledTimes(1)

    // Simulate message from different project
    act(() => {
      mockWs.simulateMessage({
        type: 'issue_created',
        projectId: 'project-2',
        data: { id: 'issue-2' } as any,
      })
    })

    // Should still be 1 (message filtered out)
    expect(messageHandler).toHaveBeenCalledTimes(1)
  })

  it('should process messages without projectId (global messages)', async () => {
    const messageHandler = vi.fn()

    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-1'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.addMessageHandler('test', messageHandler)
    })

    // Simulate message without projectId
    act(() => {
      mockWs.simulateMessage({
        type: 'project_opened',
        data: { projectId: 'new-project' } as any,
      })
    })

    expect(messageHandler).toHaveBeenCalledTimes(1)
  })

  it('should subscribe with correct project in subscription message', async () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-1'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    // Subscribe to issues in project-1
    act(() => {
      result.current.subscribe('issue')
    })

    const subscribeMsg = mockWs.sentMessages
      .map((msg) => JSON.parse(msg))
      .find((msg) => msg.type === 'subscribe' && msg.project_id === 'project-1')

    expect(subscribeMsg).toBeDefined()
    expect(subscribeMsg.entity_type).toBe('issue')
  })

  it('should warn when subscribing without a project', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper(null),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.subscribe('issue')
    })

    expect(consoleWarn).toHaveBeenCalledWith('[WebSocket] Cannot subscribe: no project selected')

    consoleWarn.mockRestore()
  })

  it('should warn when unsubscribing without a project', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper(null),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.unsubscribe('issue')
    })

    expect(consoleWarn).toHaveBeenCalledWith('[WebSocket] Cannot unsubscribe: no project selected')

    consoleWarn.mockRestore()
  })

  it('should create project-scoped subscription keys', async () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-abc'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.subscribe('issue', 'issue-123')
    })

    const subscribeMsg = mockWs.sentMessages
      .map((msg) => JSON.parse(msg))
      .find((msg) => msg.type === 'subscribe')

    expect(subscribeMsg.project_id).toBe('project-abc')
    expect(subscribeMsg.entity_type).toBe('issue')
    expect(subscribeMsg.entity_id).toBe('issue-123')
  })

  it('should handle wildcard subscriptions with projectId', async () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-xyz'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.subscribe('issue')
    })

    const subscribeMsg = mockWs.sentMessages
      .map((msg) => JSON.parse(msg))
      .find((msg) => msg.type === 'subscribe')

    expect(subscribeMsg.project_id).toBe('project-xyz')
    expect(subscribeMsg.entity_type).toBe('issue')
    expect(subscribeMsg.entity_id).toBeUndefined()
  })

  it('should include project_id in unsubscribe messages', async () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper('project-1'),
    })

    // Wait for connection
    await waitFor(() => expect(result.current.connected).toBe(true))

    act(() => {
      result.current.subscribe('spec', 'spec-123')
    })

    // Clear previous messages
    mockWs.sentMessages = []

    act(() => {
      result.current.unsubscribe('spec', 'spec-123')
    })

    const unsubscribeMsg = mockWs.sentMessages
      .map((msg) => JSON.parse(msg))
      .find((msg) => msg.type === 'unsubscribe')

    expect(unsubscribeMsg).toBeDefined()
    expect(unsubscribeMsg.project_id).toBe('project-1')
    expect(unsubscribeMsg.entity_type).toBe('spec')
    expect(unsubscribeMsg.entity_id).toBe('spec-123')
  })
})
