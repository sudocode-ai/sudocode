import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ChatWidgetProvider, useChatWidget, PROJECT_ASSISTANT_TAG } from '@/contexts/ChatWidgetContext'
import type { Execution } from '@/types/execution'

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

// Mock useExecutions hook with parameter tracking
const mockExecutions: Execution[] = []
const mockUseExecutions = vi.fn((_params?: { tags?: string[] }) => ({
  data: { executions: mockExecutions },
  isLoading: false,
  error: null,
}))

vi.mock('@/hooks/useExecutions', () => ({
  useExecutions: (params?: { tags?: string[] }) => mockUseExecutions(params),
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

describe('ChatWidgetContext', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    mockExecutions.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should throw error when useChatWidget is used outside ChatWidgetProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useChatWidget())
    }).toThrow('useChatWidget must be used within ChatWidgetProvider')

    consoleError.mockRestore()
  })

  it('should provide default state values', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ChatWidgetProvider>{children}</ChatWidgetProvider>
    )

    const { result } = renderHook(() => useChatWidget(), { wrapper })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.mode).toBe('floating')
    expect(result.current.selectedExecutionId).toBeNull()
    expect(result.current.selectedExecution).toBeNull()
    expect(result.current.agentType).toBe('claude-code')
    expect(result.current.executionConfig).toEqual({ mode: 'local' })
  })

  it('should load persisted mode from localStorage', () => {
    localStorageMock.setItem(
      'sudocode:chatWidget',
      JSON.stringify({ mode: 'panel', agentType: 'codex', executionConfig: { mode: 'worktree' } })
    )

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ChatWidgetProvider>{children}</ChatWidgetProvider>
    )

    const { result } = renderHook(() => useChatWidget(), { wrapper })

    expect(result.current.mode).toBe('panel')
    expect(result.current.agentType).toBe('codex')
    expect(result.current.executionConfig).toEqual({ mode: 'worktree' })
  })

  describe('toggle', () => {
    it('should toggle isOpen state', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      expect(result.current.isOpen).toBe(false)

      act(() => {
        result.current.toggle()
      })

      expect(result.current.isOpen).toBe(true)

      act(() => {
        result.current.toggle()
      })

      expect(result.current.isOpen).toBe(false)
    })
  })

  describe('open and close', () => {
    it('should open the widget', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.open()
      })

      expect(result.current.isOpen).toBe(true)
    })

    it('should close the widget', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.open()
      })

      act(() => {
        result.current.close()
      })

      expect(result.current.isOpen).toBe(false)
    })
  })

  describe('setMode', () => {
    it('should change mode and persist to localStorage', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.setMode('panel')
      })

      expect(result.current.mode).toBe('panel')

      await waitFor(() => {
        const stored = JSON.parse(localStorageMock.getItem('sudocode:chatWidget') || '{}')
        expect(stored.mode).toBe('panel')
      })
    })
  })

  describe('selectExecution', () => {
    it('should select an execution', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.selectExecution('exec-123')
      })

      expect(result.current.selectedExecutionId).toBe('exec-123')
    })

    it('should clear selection when null is passed (for new execution)', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.selectExecution('exec-123')
      })

      act(() => {
        result.current.selectExecution(null)
      })

      // Selection is cleared - shows config panel for new execution
      expect(result.current.selectedExecutionId).toBeNull()
    })
  })

  describe('setCreatedExecution', () => {
    it('should set created execution and select it', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      const mockExecution = {
        id: 'exec-new',
        status: 'running',
      } as Execution

      act(() => {
        result.current.setCreatedExecution(mockExecution)
      })

      expect(result.current.selectedExecutionId).toBe('exec-new')
    })
  })

  describe('agent settings', () => {
    it('should update agent type', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.setAgentType('codex')
      })

      expect(result.current.agentType).toBe('codex')
    })

    it('should update execution config', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.updateExecutionConfig({ mode: 'worktree', baseBranch: 'main' })
      })

      expect(result.current.executionConfig).toEqual({ mode: 'worktree', baseBranch: 'main' })
    })

    it('should merge execution config updates', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.updateExecutionConfig({ mode: 'worktree' })
      })

      act(() => {
        result.current.updateExecutionConfig({ baseBranch: 'develop' })
      })

      expect(result.current.executionConfig).toEqual({ mode: 'worktree', baseBranch: 'develop' })
    })
  })

  describe('keyboard shortcuts', () => {
    it('should toggle widget on Cmd+J', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      expect(result.current.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'j',
          metaKey: true,
          bubbles: true,
        })
        window.dispatchEvent(event)
      })

      expect(result.current.isOpen).toBe(true)
    })

    it('should toggle widget on Ctrl+J', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      expect(result.current.isOpen).toBe(false)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'j',
          ctrlKey: true,
          bubbles: true,
        })
        window.dispatchEvent(event)
      })

      expect(result.current.isOpen).toBe(true)
    })

    it('should close widget on Escape when open', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      // Open the widget first
      act(() => {
        result.current.open()
      })

      expect(result.current.isOpen).toBe(true)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        })
        window.dispatchEvent(event)
      })

      expect(result.current.isOpen).toBe(false)
    })
  })

  describe('derived state', () => {
    it('should report hasActiveExecution as false when no executions', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      expect(result.current.hasActiveExecution).toBe(false)
      expect(result.current.latestActiveExecution).toBeNull()
    })

    it('should report isExecutionRunning as false when no execution selected', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      expect(result.current.isExecutionRunning).toBe(false)
    })
  })

  describe('project-assistant tag filtering', () => {
    it('should fetch executions with project-assistant tag', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      renderHook(() => useChatWidget(), { wrapper })

      // Verify useExecutions was called with the project-assistant tag filter
      expect(mockUseExecutions).toHaveBeenCalledWith({ tags: [PROJECT_ASSISTANT_TAG] })
    })

    it('should export PROJECT_ASSISTANT_TAG constant', () => {
      expect(PROJECT_ASSISTANT_TAG).toBe('project-assistant')
    })
  })

  describe('lastExecutionId persistence', () => {
    it('should load lastExecutionId from localStorage', () => {
      localStorageMock.setItem(
        'sudocode:chatWidget',
        JSON.stringify({ mode: 'floating', lastExecutionId: 'exec-saved' })
      )

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      // The lastExecutionId should be restored from localStorage
      expect(result.current.selectedExecutionId).toBe('exec-saved')
    })

    it('should persist lastExecutionId when manually selecting an execution', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.selectExecution('exec-manual')
      })

      await waitFor(() => {
        const stored = JSON.parse(localStorageMock.getItem('sudocode:chatWidget') || '{}')
        expect(stored.lastExecutionId).toBe('exec-manual')
      })
    })

    it('should persist null lastExecutionId when selecting new execution', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      // First select an execution
      act(() => {
        result.current.selectExecution('exec-123')
      })

      // Then select "New" (null)
      act(() => {
        result.current.selectExecution(null)
      })

      await waitFor(() => {
        const stored = JSON.parse(localStorageMock.getItem('sudocode:chatWidget') || '{}')
        expect(stored.lastExecutionId).toBeNull()
      })
    })

    it('should persist agent settings', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ChatWidgetProvider>{children}</ChatWidgetProvider>
      )

      const { result } = renderHook(() => useChatWidget(), { wrapper })

      act(() => {
        result.current.setAgentType('codex')
        result.current.updateExecutionConfig({ mode: 'worktree', baseBranch: 'main' })
      })

      await waitFor(() => {
        const stored = JSON.parse(localStorageMock.getItem('sudocode:chatWidget') || '{}')
        expect(stored.agentType).toBe('codex')
        expect(stored.executionConfig).toEqual({ mode: 'worktree', baseBranch: 'main' })
      })
    })
  })
})
