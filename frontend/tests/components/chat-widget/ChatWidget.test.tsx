import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ChatWidget } from '@/components/chat-widget/ChatWidget'
import { ChatWidgetProvider } from '@/contexts/ChatWidgetContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import type { Execution } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  executionsApi: {
    getChain: vi.fn().mockResolvedValue({ rootId: 'exec-1', executions: [] }),
    createFollowUp: vi.fn(),
    createAdhoc: vi.fn(),
  },
}))

// Mock useExecutions hook
const mockExecutions: Execution[] = []
vi.mock('@/hooks/useExecutions', () => ({
  useExecutions: () => ({
    data: { executions: mockExecutions },
    isLoading: false,
    error: null,
  }),
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: false,
    subscribe: vi.fn(),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
  }),
}))

// Mock child components to simplify testing
vi.mock('@/components/chat-widget/ChatWidgetFAB', () => ({
  ChatWidgetFAB: ({
    onClick,
    isOpen,
    isRunning,
    hasNotification,
  }: {
    onClick: () => void
    isOpen: boolean
    isRunning: boolean
    hasNotification: boolean
  }) => (
    <button
      data-testid="chat-fab"
      onClick={onClick}
      data-is-open={isOpen}
      data-is-running={isRunning}
      data-has-notification={hasNotification}
    >
      FAB
    </button>
  ),
}))

vi.mock('@/components/chat-widget/ChatWidgetOverlay', () => ({
  ChatWidgetOverlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chat-overlay">{children}</div>
  ),
}))

vi.mock('@/components/chat-widget/ChatWidgetPanel', () => ({
  ChatWidgetPanel: ({
    children,
    onClose,
  }: {
    children: React.ReactNode
    onClose: () => void
  }) => (
    <div data-testid="chat-panel">
      <button data-testid="panel-close" onClick={onClose}>
        Close
      </button>
      {children}
    </div>
  ),
}))

vi.mock('@/components/chat-widget/ChatWidgetContent', () => ({
  ChatWidgetContent: ({
    mode,
    onClose,
    onModeToggle,
  }: {
    mode: string
    onClose: () => void
    onModeToggle: () => void
  }) => (
    <div data-testid="chat-content" data-mode={mode}>
      <button data-testid="content-close" onClick={onClose}>
        Close
      </button>
      <button data-testid="content-mode-toggle" onClick={onModeToggle}>
        Toggle Mode
      </button>
    </div>
  ),
}))

// Mock localStorage to prevent state leaking between tests
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

// Helper to render with providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <ThemeProvider>
      <ChatWidgetProvider>{ui}</ChatWidgetProvider>
    </ThemeProvider>
  )
}

describe('ChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecutions.length = 0
    localStorageMock.clear() // Clear localStorage to prevent state leaking
  })

  describe('Initial State', () => {
    it('should render FAB when closed', () => {
      renderWithProviders(<ChatWidget />)

      expect(screen.getByTestId('chat-fab')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-overlay')).not.toBeInTheDocument()
      expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument()
    })

    it('should have FAB with isOpen=false initially', () => {
      renderWithProviders(<ChatWidget />)

      const fab = screen.getByTestId('chat-fab')
      expect(fab.getAttribute('data-is-open')).toBe('false')
    })
  })

  describe('Opening Widget', () => {
    it('should show floating overlay when FAB is clicked (default mode)', () => {
      renderWithProviders(<ChatWidget />)

      fireEvent.click(screen.getByTestId('chat-fab'))

      expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()
      expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument()
    })

    it('should hide FAB when floating overlay is open', () => {
      renderWithProviders(<ChatWidget />)

      fireEvent.click(screen.getByTestId('chat-fab'))

      // FAB should be hidden in floating mode
      expect(screen.queryByTestId('chat-fab')).not.toBeInTheDocument()
    })

    it('should show content inside overlay', () => {
      renderWithProviders(<ChatWidget />)

      fireEvent.click(screen.getByTestId('chat-fab'))

      expect(screen.getByTestId('chat-content')).toBeInTheDocument()
    })
  })

  describe('Mode Switching', () => {
    it('should switch to panel mode when mode toggle is clicked', async () => {
      renderWithProviders(<ChatWidget />)

      // Open widget
      fireEvent.click(screen.getByTestId('chat-fab'))
      expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()

      // Toggle mode to panel
      fireEvent.click(screen.getByTestId('content-mode-toggle'))

      // Wait for state update
      await waitFor(() => {
        expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('chat-overlay')).not.toBeInTheDocument()
    })

    it('should show FAB when in panel mode', async () => {
      renderWithProviders(<ChatWidget />)

      // Open widget
      fireEvent.click(screen.getByTestId('chat-fab'))
      expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()

      // Toggle mode to panel and wait for panel to appear
      fireEvent.click(screen.getByTestId('content-mode-toggle'))
      await waitFor(() => {
        expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
      })

      // FAB should be visible in panel mode
      expect(screen.getByTestId('chat-fab')).toBeInTheDocument()
    })

    it('should switch back to floating mode', async () => {
      renderWithProviders(<ChatWidget />)

      // Open widget
      fireEvent.click(screen.getByTestId('chat-fab'))

      // Toggle to panel
      fireEvent.click(screen.getByTestId('content-mode-toggle'))
      await waitFor(() => {
        expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
      })

      // Toggle back to floating
      fireEvent.click(screen.getByTestId('content-mode-toggle'))
      await waitFor(() => {
        expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()
      })
    })
  })

  describe('Closing Widget', () => {
    it('should close widget when close button is clicked', () => {
      renderWithProviders(<ChatWidget />)

      // Open widget
      fireEvent.click(screen.getByTestId('chat-fab'))
      expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()

      // Close widget
      fireEvent.click(screen.getByTestId('content-close'))

      expect(screen.queryByTestId('chat-overlay')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-fab')).toBeInTheDocument()
    })
  })

  describe('Keyboard Navigation', () => {
    it('should open widget with Cmd+J', async () => {
      renderWithProviders(<ChatWidget />)

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'j',
          metaKey: true,
          bubbles: true,
        })
        window.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()
      })
    })

    it('should close widget with Escape', async () => {
      renderWithProviders(<ChatWidget />)

      // Open widget
      fireEvent.click(screen.getByTestId('chat-fab'))
      expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()

      // Close with Escape
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        })
        window.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(screen.queryByTestId('chat-overlay')).not.toBeInTheDocument()
      })
    })

    it('should toggle widget with Cmd+J when open', async () => {
      renderWithProviders(<ChatWidget />)

      // Open widget via click (more reliable than keyboard for this test)
      fireEvent.click(screen.getByTestId('chat-fab'))
      expect(screen.getByTestId('chat-overlay')).toBeInTheDocument()

      // Toggle closed with keyboard
      await act(async () => {
        const closeEvent = new KeyboardEvent('keydown', {
          key: 'j',
          metaKey: true,
          bubbles: true,
        })
        window.dispatchEvent(closeEvent)
      })

      await waitFor(() => {
        expect(screen.queryByTestId('chat-overlay')).not.toBeInTheDocument()
      })
    })
  })

  describe('Content Props', () => {
    it('should pass correct mode to content', () => {
      renderWithProviders(<ChatWidget />)

      // Open widget (default floating mode)
      fireEvent.click(screen.getByTestId('chat-fab'))

      const content = screen.getByTestId('chat-content')
      expect(content.getAttribute('data-mode')).toBe('floating')
    })

    it('should pass panel mode to content after toggle', () => {
      renderWithProviders(<ChatWidget />)

      // Open widget
      fireEvent.click(screen.getByTestId('chat-fab'))

      // Toggle to panel
      fireEvent.click(screen.getByTestId('content-mode-toggle'))

      const content = screen.getByTestId('chat-content')
      expect(content.getAttribute('data-mode')).toBe('panel')
    })
  })
})
