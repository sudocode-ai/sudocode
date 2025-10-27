import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWebSocket } from '@/lib/websocket'
import type { WebSocketMessage } from '@/types/api'

// Mock WebSocket
let lastWebSocketInstance: MockWebSocket | null = null

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  public readyState = MockWebSocket.CONNECTING
  public onopen: ((event: Event) => void) | null = null
  public onmessage: ((event: MessageEvent) => void) | null = null
  public onerror: ((event: Event) => void) | null = null
  public onclose: ((event: CloseEvent) => void) | null = null

  constructor(public url: string) {
    lastWebSocketInstance = this
    // Simulate immediate connection
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.(new Event('open'))
    })
  }

  send(_data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    queueMicrotask(() => {
      this.onclose?.(new CloseEvent('close'))
    })
  }

  // Helper to simulate receiving a message
  simulateMessage(data: any) {
    const event = new MessageEvent('message', {
      data: JSON.stringify(data),
    })
    this.onmessage?.(event)
  }

  // Helper to simulate an error
  simulateError() {
    this.onerror?.(new Event('error'))
  }
}

// Store original WebSocket
const OriginalWebSocket = global.WebSocket

describe('useWebSocket', () => {
  beforeEach(() => {
    // Replace global WebSocket with mock
    global.WebSocket = MockWebSocket as any
    lastWebSocketInstance = null
  })

  afterEach(() => {
    // Restore original WebSocket
    global.WebSocket = OriginalWebSocket
    lastWebSocketInstance = null
    vi.clearAllMocks()
  })

  it('should connect to WebSocket on mount', async () => {
    const onOpen = vi.fn()
    const { result } = renderHook(() => useWebSocket('/test', { onOpen }))

    expect(result.current.connected).toBe(false)

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    expect(onOpen).toHaveBeenCalled()
  })

  it('should disconnect on unmount', async () => {
    const onClose = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket('/test', { onClose }))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    unmount()

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should receive messages', async () => {
    const onMessage = vi.fn()
    const mockMessage: WebSocketMessage = {
      type: 'spec_updated',
      data: {
        id: 'SPEC-001',
        uuid: 'test-uuid',
        title: 'Test Spec',
        content: 'Test content',
        file_path: '/path/to/spec.md',
        priority: 1,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        parent_id: null,
      },
      timestamp: '2024-01-01T00:00:00Z',
    }

    const { result } = renderHook(() => useWebSocket('/test', { onMessage }))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    // Get the mock WebSocket instance
    const ws = lastWebSocketInstance!

    // Simulate receiving a message
    act(() => {
      ws.simulateMessage(mockMessage)
    })

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith(mockMessage)
      expect(result.current.lastMessage).toEqual(mockMessage)
    })
  })

  it('should send messages when connected', async () => {
    const { result } = renderHook(() => useWebSocket('/test'))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    const message = { type: 'subscribe', channel: 'specs' }

    // Should not throw
    expect(() => {
      act(() => {
        result.current.send(message)
      })
    }).not.toThrow()
  })

  it('should not send messages when disconnected', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useWebSocket('/test'))

    // Don't wait for connection
    const message = { type: 'test' }

    act(() => {
      result.current.send(message)
    })

    expect(consoleWarn).toHaveBeenCalledWith(
      '[WebSocket] Cannot send message: not connected or still connecting'
    )

    consoleWarn.mockRestore()
  })

  it('should subscribe to entity types', async () => {
    const { result } = renderHook(() => useWebSocket('/test'))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    // Should not throw when subscribing to spec with ID
    expect(() => {
      act(() => {
        result.current.subscribe('spec', 'SPEC-001')
      })
    }).not.toThrow()

    // Should not throw when subscribing to all
    expect(() => {
      act(() => {
        result.current.subscribe('all')
      })
    }).not.toThrow()
  })

  it('should handle errors', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useWebSocket('/test', { onError }))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    const ws = lastWebSocketInstance!

    act(() => {
      ws.simulateError()
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalled()
    })
  })

  it('should manually disconnect', async () => {
    const { result } = renderHook(() => useWebSocket('/test', { reconnect: false }))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    // Disconnect
    act(() => {
      result.current.disconnect()
    })

    await waitFor(() => {
      expect(result.current.connected).toBe(false)
    })
  })

  it('should handle malformed JSON messages', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onMessage = vi.fn()

    const { result } = renderHook(() => useWebSocket('/test', { onMessage }))

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    const ws = lastWebSocketInstance!

    // Simulate receiving malformed JSON
    act(() => {
      const event = new MessageEvent('message', {
        data: 'invalid json',
      })
      ws.onmessage?.(event)
    })

    expect(consoleError).toHaveBeenCalledWith(
      '[WebSocket] Failed to parse message:',
      expect.any(Error)
    )
    expect(onMessage).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('should prevent sending messages while still connecting', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Create a mock that stays in CONNECTING state
    class StuckConnectingWebSocket extends MockWebSocket {
      constructor(url: string) {
        super(url)
        this.readyState = MockWebSocket.CONNECTING
      }
    }

    global.WebSocket = StuckConnectingWebSocket as any

    const { result } = renderHook(() => useWebSocket('/test'))

    // Try to send while connecting
    act(() => {
      result.current.send({ type: 'test' })
    })

    expect(consoleWarn).toHaveBeenCalledWith(
      '[WebSocket] Cannot send message: not connected or still connecting'
    )

    consoleWarn.mockRestore()
    global.WebSocket = MockWebSocket as any
  })

  it('should not cause infinite reconnection loops when handlers change', async () => {
    let connectCount = 0

    class CountingWebSocket extends MockWebSocket {
      constructor(url: string) {
        super(url)
        connectCount++
      }
    }

    global.WebSocket = CountingWebSocket as any

    const { result, rerender } = renderHook<
      ReturnType<typeof useWebSocket>,
      { onMessage: (msg: WebSocketMessage) => void }
    >(
      ({ onMessage }) => useWebSocket('/test', { onMessage }),
      { initialProps: { onMessage: vi.fn() } }
    )

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    const initialConnectCount = connectCount

    // Change the onMessage handler (simulate component re-render with new handler)
    rerender({ onMessage: vi.fn() })
    rerender({ onMessage: vi.fn() })
    rerender({ onMessage: vi.fn() })

    // Wait a bit to ensure no reconnections occur
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should still have only connected once
    expect(connectCount).toBe(initialConnectCount)

    global.WebSocket = MockWebSocket as any
  })

  it('should use updated callbacks without reconnecting', async () => {
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()

    const { result, rerender } = renderHook<
      ReturnType<typeof useWebSocket>,
      { onMessage: (msg: WebSocketMessage) => void }
    >(
      ({ onMessage }) => useWebSocket('/test', { onMessage }),
      { initialProps: { onMessage: firstCallback } }
    )

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })

    const ws = lastWebSocketInstance!
    const mockMessage: WebSocketMessage = {
      type: 'spec_updated',
      data: {
        id: 'SPEC-001',
        uuid: 'test-uuid',
        title: 'Test Spec',
        content: 'Test content',
        file_path: '/path/to/spec.md',
        priority: 1,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        parent_id: null,
      },
      timestamp: '2024-01-01T00:00:00Z',
    }

    // Send a message with first callback
    act(() => {
      ws.simulateMessage(mockMessage)
    })

    expect(firstCallback).toHaveBeenCalledWith(mockMessage)
    expect(secondCallback).not.toHaveBeenCalled()

    // Update to second callback
    rerender({ onMessage: secondCallback })

    // Send another message with second callback
    act(() => {
      ws.simulateMessage(mockMessage)
    })

    expect(secondCallback).toHaveBeenCalledWith(mockMessage)
  })

  it('should construct correct WebSocket URL', async () => {
    renderHook(() => useWebSocket(''))

    await waitFor(() => {
      expect(lastWebSocketInstance).not.toBeNull()
    })

    // Should use the base URL /ws
    expect(lastWebSocketInstance!.url).toMatch(/\/ws$/)
  })
})
