/**
 * Tests for TerminalView Component
 *
 * Verifies terminal initialization, WebSocket communication,
 * input handling, error handling, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TerminalView } from '@/components/executions/TerminalView'

// Mock callbacks and instances - shared state for tests
let mockOnDataCallback: ((data: string) => void) | null = null
let mockTerminalInstance: any = null
let mockFitAddonInstance: any = null

// Mock xterm modules
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(() => {
    mockTerminalInstance = {
      open: vi.fn(),
      write: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn((callback) => {
        mockOnDataCallback = callback
      }),
      loadAddon: vi.fn(),
      cols: 80,
      rows: 24,
    }
    return mockTerminalInstance
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => {
    mockFitAddonInstance = {
      fit: vi.fn(),
    }
    return mockFitAddonInstance
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(() => ({})),
}))

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private _openTimeout: NodeJS.Timeout | null = null

  constructor(
    public url: string,
    private shouldFail: { code: number; reason: string } | null = null
  ) {
    lastWebSocketInstance = this
    // Simulate async connection
    this._openTimeout = setTimeout(() => {
      if (this.shouldFail) {
        // Connection failed
        this.readyState = MockWebSocket.CLOSED
        if (this.onclose) {
          this.onclose(new CloseEvent('close', { code: this.shouldFail.code, reason: this.shouldFail.reason }))
        }
      } else {
        // Connection succeeded
        this.readyState = MockWebSocket.OPEN
        if (this.onopen) {
          this.onopen(new Event('open'))
        }
      }
    }, 0)
  }

  send = vi.fn()
  close = vi.fn(() => {
    if (this._openTimeout) {
      clearTimeout(this._openTimeout)
      this._openTimeout = null
    }
    this.readyState = MockWebSocket.CLOSED
  })

  // Helper method to simulate receiving a message
  _simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }

  // Helper method to simulate connection error
  _simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
  }

  // Helper method to simulate close
  _simulateClose(code: number, reason: string) {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }))
    }
  }
}

// Store WebSocket instance for access in tests
let lastWebSocketInstance: MockWebSocket | null = null

global.WebSocket = MockWebSocket as any

describe('TerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastWebSocketInstance = null
    mockOnDataCallback = null
    mockTerminalInstance = null
    mockFitAddonInstance = null
    // Reset WebSocket mock to default behavior
    global.WebSocket = MockWebSocket as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Component Rendering', () => {
    it('should render without crashing', () => {
      render(<TerminalView executionId="test-123" />)
      expect(screen.getByText(/connecting to terminal/i)).toBeInTheDocument()
    })

    it('should display execution ID in badge', () => {
      render(<TerminalView executionId="test-execution-123" />)
      expect(screen.getByText('test-exe')).toBeInTheDocument()
    })

    it('should show connecting state initially', () => {
      render(<TerminalView executionId="test-123" />)
      expect(screen.getByText(/connecting to terminal/i)).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(
        <TerminalView executionId="test-123" className="custom-class" />
      )
      const card = container.querySelector('.custom-class')
      expect(card).toBeInTheDocument()
    })
  })

  describe('Terminal Initialization', () => {
    it('should create Terminal instance', () => {
      render(<TerminalView executionId="test-123" />)
      expect(mockTerminalInstance).toBeTruthy()
    })

    it('should load FitAddon', () => {
      render(<TerminalView executionId="test-123" />)
      expect(mockFitAddonInstance).toBeTruthy()
      expect(mockTerminalInstance.loadAddon).toHaveBeenCalledWith(mockFitAddonInstance)
    })

    it('should load WebLinksAddon', () => {
      render(<TerminalView executionId="test-123" />)
      // WebLinksAddon should be loaded (verify loadAddon was called twice)
      expect(mockTerminalInstance.loadAddon).toHaveBeenCalledTimes(2)
    })

    it('should open terminal in DOM', () => {
      render(<TerminalView executionId="test-123" />)
      expect(mockTerminalInstance.open).toHaveBeenCalled()
    })

    it('should fit terminal to container', () => {
      render(<TerminalView executionId="test-123" />)
      expect(mockFitAddonInstance.fit).toHaveBeenCalled()
    })

    it('should register onData handler for user input', () => {
      render(<TerminalView executionId="test-123" />)
      expect(mockTerminalInstance.onData).toHaveBeenCalled()
    })
  })

  describe('WebSocket Connection', () => {
    it('should create WebSocket connection with correct URL', () => {
      render(<TerminalView executionId="test-123" />)

      expect(lastWebSocketInstance).toBeTruthy()
      expect(lastWebSocketInstance!.url).toContain('/ws/terminal/test-123')
    })

    it('should show connected state when WebSocket opens', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })
    })

    it('should call onConnect callback when connection opens', async () => {
      const onConnect = vi.fn()
      render(<TerminalView executionId="test-123" onConnect={onConnect} />)

      await waitFor(() => {
        expect(onConnect).toHaveBeenCalled()
      })
    })

    it('should write terminal data to xterm', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance).toBeTruthy()
      })

      lastWebSocketInstance!._simulateMessage({
        type: 'terminal:data',
        data: 'Hello, terminal!',
      })

      await waitFor(() => {
        expect(mockTerminalInstance.write).toHaveBeenCalledWith('Hello, terminal!')
      })
    })

    it('should handle process exit message', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance).toBeTruthy()
      })

      lastWebSocketInstance!._simulateMessage({
        type: 'terminal:exit',
        exitCode: 0,
      })

      await waitFor(() => {
        expect(mockTerminalInstance.write).toHaveBeenCalledWith(
          expect.stringContaining('[Process exited with code 0]')
        )
      })
    })

    it('should display exit code badge', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance).toBeTruthy()
      })

      lastWebSocketInstance!._simulateMessage({
        type: 'terminal:exit',
        exitCode: 0,
      })

      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument()
        expect(screen.getByText('(success)')).toBeInTheDocument()
      })
    })
  })

  describe('User Input Handling', () => {
    it('should send user input via WebSocket', async () => {
      render(<TerminalView executionId="test-123" />)

      // Wait for WebSocket to connect
      await waitFor(() => {
        expect(lastWebSocketInstance).toBeTruthy()
        expect(lastWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN)
      })

      // Simulate user typing
      expect(mockOnDataCallback).toBeTruthy()
      mockOnDataCallback!('test input')

      expect(lastWebSocketInstance!.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'terminal:input',
          data: 'test input',
        })
      )
    })

    it('should send special characters (e.g., Ctrl+C)', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN)
      })

      mockOnDataCallback!('\x03') // Ctrl+C

      expect(lastWebSocketInstance!.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'terminal:input',
          data: '\x03',
        })
      )
    })

    it('should not send input when WebSocket is not open', async () => {
      render(<TerminalView executionId="test-123" />)

      // Don't wait for connection - send immediately
      mockOnDataCallback!('test')

      // Should not send because WebSocket is still connecting
      expect(lastWebSocketInstance!.send).not.toHaveBeenCalled()
    })
  })

  describe('Resize Handling', () => {
    it('should send resize events on window resize', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN)
      })

      // Clear previous calls
      vi.clearAllMocks()

      // Trigger window resize
      global.dispatchEvent(new Event('resize'))

      // Wait for debounce (100ms)
      await new Promise((resolve) => setTimeout(resolve, 150))

      await waitFor(() => {
        expect(lastWebSocketInstance!.send).toHaveBeenCalledWith(
          expect.stringContaining('terminal:resize')
        )
      })
    })

    it('should include cols and rows in resize message', async () => {
      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN)
      })

      vi.clearAllMocks()
      global.dispatchEvent(new Event('resize'))

      await new Promise((resolve) => setTimeout(resolve, 150))

      await waitFor(() => {
        const calls = lastWebSocketInstance!.send.mock.calls
        expect(calls.length).toBeGreaterThan(0)
        const lastCall = calls[calls.length - 1][0]
        const message = JSON.parse(lastCall as string)
        expect(message.cols).toBeDefined()
        expect(message.rows).toBeDefined()
      })
    })
  })

  describe('Error Handling', () => {
    it('should show error state on connection failure', async () => {
      // Override WebSocket to fail on connection
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1008, reason: 'Execution not found' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(
          screen.getByText('Execution not found or has been deleted')
        ).toBeInTheDocument()
      })
    })

    it('should call onError callback on connection failure', async () => {
      // Override WebSocket to fail on connection
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1008, reason: 'Execution not found' })
      }) as any

      const onError = vi.fn()
      render(<TerminalView executionId="test-123" onError={onError} />)

      await waitFor(() => {
        expect(onError).toHaveBeenCalled()
      })
    })

    it('should show retry button for recoverable errors', async () => {
      // Override WebSocket to fail with recoverable error
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1011, reason: 'Internal server error' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })
    })

    it('should not show retry button for non-recoverable errors', async () => {
      // Override WebSocket to fail with non-recoverable error
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1008, reason: 'Execution not found' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(screen.getByText('Execution not found or has been deleted')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    })

    it('should categorize error code 1008 (not found)', async () => {
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1008, reason: 'Execution not found' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(
          screen.getByText('Execution not found or has been deleted')
        ).toBeInTheDocument()
      })
    })

    it('should categorize error code 1008 (already active)', async () => {
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1008, reason: 'Terminal already active' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(
          screen.getByText('A terminal is already connected to this execution')
        ).toBeInTheDocument()
      })
    })

    it('should categorize error code 1011 (server error)', async () => {
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1011, reason: 'Server error' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(
          screen.getByText('Server encountered an internal error')
        ).toBeInTheDocument()
      })
    })

    it('should increment retry counter on retry', async () => {
      // Override WebSocket to fail with recoverable error
      global.WebSocket = vi.fn((url: string) => {
        return new MockWebSocket(url, { code: 1011, reason: 'Internal error' })
      }) as any

      render(<TerminalView executionId="test-123" />)

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })

      // Click retry
      const retryButton = screen.getByRole('button', { name: /retry/i })
      retryButton.click()

      // Should show attempt counter
      await waitFor(() => {
        expect(screen.getByText(/attempt 2/i)).toBeInTheDocument()
      })
    })
  })

  describe('Cleanup', () => {
    it('should dispose terminal on unmount', () => {
      const { unmount } = render(<TerminalView executionId="test-123" />)

      unmount()

      expect(mockTerminalInstance.dispose).toHaveBeenCalled()
    })

    it('should close WebSocket on unmount', async () => {
      const { unmount } = render(<TerminalView executionId="test-123" />)

      await waitFor(() => {
        expect(lastWebSocketInstance).toBeTruthy()
      })

      const closeMethod = lastWebSocketInstance!.close

      unmount()

      expect(closeMethod).toHaveBeenCalled()
    })

    it('should remove window resize listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = render(<TerminalView executionId="test-123" />)

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('Disconnection Handling', () => {
    it('should show disconnected state when connection closes', async () => {
      render(<TerminalView executionId="test-123" />)

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })

      // Close connection normally
      lastWebSocketInstance!._simulateClose(1000, 'Normal closure')

      await waitFor(() => {
        expect(screen.getByText('Disconnected')).toBeInTheDocument()
      })
    })

    it('should call onDisconnect callback when connection closes', async () => {
      const onDisconnect = vi.fn()
      render(<TerminalView executionId="test-123" onDisconnect={onDisconnect} />)

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })

      // Close connection
      lastWebSocketInstance!._simulateClose(1000, 'Normal closure')

      await waitFor(() => {
        expect(onDisconnect).toHaveBeenCalled()
      })
    })
  })

  describe('Integration', () => {
    it('should handle full message flow from server', async () => {
      render(<TerminalView executionId="test-123" />)

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })

      // Server sends data
      lastWebSocketInstance!._simulateMessage({
        type: 'terminal:data',
        data: 'Welcome to the terminal!\r\n',
      })

      // Verify data written to terminal
      await waitFor(() => {
        expect(mockTerminalInstance.write).toHaveBeenCalledWith('Welcome to the terminal!\r\n')
      })

      // User types input
      mockOnDataCallback!('ls -la\r')

      // Verify input sent to server
      expect(lastWebSocketInstance!.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'terminal:input',
          data: 'ls -la\r',
        })
      )

      // Server responds with output
      lastWebSocketInstance!._simulateMessage({
        type: 'terminal:data',
        data: 'total 48\r\ndrwxr-xr-x  12 user  staff   384 Jan  1 12:00 .\r\n',
      })

      // Verify output written
      await waitFor(() => {
        expect(mockTerminalInstance.write).toHaveBeenCalledWith(
          'total 48\r\ndrwxr-xr-x  12 user  staff   384 Jan  1 12:00 .\r\n'
        )
      })

      // Process exits
      lastWebSocketInstance!._simulateMessage({
        type: 'terminal:exit',
        exitCode: 0,
      })

      // Verify exit message
      await waitFor(() => {
        expect(mockTerminalInstance.write).toHaveBeenCalledWith(
          expect.stringContaining('[Process exited with code 0]')
        )
      })

      // Verify exit code badge displayed
      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument()
        expect(screen.getByText('(success)')).toBeInTheDocument()
      })
    })
  })
})
