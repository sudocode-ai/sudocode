/**
 * ExecutionMonitor Component Tests
 *
 * Tests for the ACP-based execution monitoring component
 * Updated for ACP migration with useSessionUpdateStream hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ExecutionMonitor } from '@/components/executions/ExecutionMonitor'
import * as useSessionUpdateStreamModule from '@/hooks/useSessionUpdateStream'
import * as useExecutionLogsModule from '@/hooks/useExecutionLogs'
import { ThemeProvider } from '@/contexts/ThemeContext'
import type {
  AgentMessage,
  ToolCall,
  ConnectionStatus,
  ExecutionState,
} from '@/hooks/useSessionUpdateStream'

// Helper to wrap component with ThemeProvider
const renderWithTheme = (ui: React.ReactElement) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

// Mock the hooks
const mockUseSessionUpdateStream = vi.spyOn(
  useSessionUpdateStreamModule,
  'useSessionUpdateStream'
)
const mockUseExecutionLogs = vi.spyOn(useExecutionLogsModule, 'useExecutionLogs')

// Helper to create default mock result for useSessionUpdateStream
function createMockStreamResult(overrides: {
  connectionStatus?: ConnectionStatus
  execution?: Partial<ExecutionState>
  messages?: AgentMessage[]
  toolCalls?: ToolCall[]
  thoughts?: useSessionUpdateStreamModule.AgentThought[]
  planUpdates?: useSessionUpdateStreamModule.PlanUpdateEvent[]
  latestPlan?: useSessionUpdateStreamModule.PlanEntry[] | null
  permissionRequests?: useSessionUpdateStreamModule.UseSessionUpdateStreamResult['permissionRequests']
  markPermissionResponded?: useSessionUpdateStreamModule.UseSessionUpdateStreamResult['markPermissionResponded']
  availableCommands?: useSessionUpdateStreamModule.AvailableCommand[]
  error?: Error | null
  isConnected?: boolean
  isStreaming?: boolean
}): useSessionUpdateStreamModule.UseSessionUpdateStreamResult {
  return {
    connectionStatus: overrides.connectionStatus ?? 'idle',
    execution: {
      runId: null,
      status: 'idle' as const,
      error: null,
      startTime: null,
      endTime: null,
      ...overrides.execution,
    },
    messages: overrides.messages ?? [],
    toolCalls: overrides.toolCalls ?? [],
    thoughts: overrides.thoughts ?? [],
    planUpdates: overrides.planUpdates ?? [],
    latestPlan: overrides.latestPlan ?? null,
    permissionRequests: overrides.permissionRequests ?? [],
    markPermissionResponded: overrides.markPermissionResponded ?? vi.fn(),
    availableCommands: overrides.availableCommands ?? [],
    error: overrides.error ?? null,
    isConnected: overrides.isConnected ?? false,
    isStreaming: overrides.isStreaming ?? false,
  }
}

// Helper to create mock result for useExecutionLogs
function createMockLogsResult(overrides: {
  events?: useExecutionLogsModule.CoalescedSessionUpdate[]
  processed?: Partial<useExecutionLogsModule.ProcessedLogs>
  loading?: boolean
  error?: Error | null
  metadata?: useExecutionLogsModule.ExecutionLogMetadata | null
  format?: 'acp' | 'normalized_entry' | 'empty' | null
}): useExecutionLogsModule.UseExecutionLogsResult {
  const events = overrides.events ?? []
  const defaultProcessed: useExecutionLogsModule.ProcessedLogs = {
    messages: [],
    toolCalls: [],
    thoughts: [],
    planUpdates: [],
    latestPlan: null,
  }
  const processed = { ...defaultProcessed, ...overrides.processed }
  return {
    events,
    processed,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    metadata: overrides.metadata ?? null,
    format: overrides.format ?? (events.length > 0 ? 'acp' : 'empty'),
  }
}

describe('ExecutionMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for useSessionUpdateStream
    mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

    // Default mock for useExecutionLogs (prevent actual fetch calls)
    mockUseExecutionLogs.mockReturnValue(createMockLogsResult({}))
  })

  describe('Loading State', () => {
    it('should display connecting state initially', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connecting',
          execution: { status: 'idle' },
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText(/connecting to execution stream/i)).toBeInTheDocument()
    })
  })

  describe('Status Display', () => {
    it('should display running status', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('Live')).toBeInTheDocument()
    })

    it('should display completed status', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: 1000,
            endTime: 3000,
          },
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Completed')).toBeInTheDocument()
      // Check duration display (3000 - 1000 = 2000ms = 2.00s)
      expect(screen.getByText(/2\.00s/)).toBeInTheDocument()
    })

    it('should display error status', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'error',
            error: 'Test error message',
            startTime: 1000,
            endTime: 2000,
          },
          error: new Error('Test error message'),
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // Check for error badge in header
      const errorBadges = screen.getAllByText('Error')
      expect(errorBadges.length).toBeGreaterThan(0)

      // Check for error message
      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })
  })

  describe('Messages Display', () => {
    it('should display messages from stream', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Hello, this is a test message!',
          timestamp: new Date(),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          messages,
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // In the unified trajectory view, messages are displayed with colored dots
      // Verify the message content is displayed
      expect(screen.getByText('Hello, this is a test message!')).toBeInTheDocument()
      // New terminal-style UI uses colored dots, not text badges
      expect(screen.getByText('⏺')).toBeInTheDocument()
    })

    it('should show spinner for incomplete messages', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Streaming message...',
          timestamp: new Date(),
          isStreaming: true,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          messages,
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // Check for spinner by looking for animate-spin class
      const spinners = container.querySelectorAll('.animate-spin')
      expect(spinners.length).toBeGreaterThan(0)
    })
  })

  describe('Tool Calls Display', () => {
    it('should display tool calls from stream', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'Read',
          rawInput: { file: 'test.ts' },
          status: 'success',
          result: 'File contents here',
          timestamp: new Date(1000),
          completedAt: new Date(2000),
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          toolCalls,
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // In the unified trajectory view, tool calls are displayed with colored dots
      // Just verify the tool call is displayed
      expect(screen.getByText('Read')).toBeInTheDocument()
      // New UI uses colored dots instead of text badges
      expect(screen.getByText('⏺')).toBeInTheDocument()
      expect(screen.getByText('1.00s')).toBeInTheDocument()
    })

    it('should display tool call error', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'Write',
          rawInput: { file: 'test.ts' },
          status: 'failed',
          result: 'File not found',  // Error text as string
          timestamp: new Date(1000),
          completedAt: new Date(2000),
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          toolCalls,
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Write')).toBeInTheDocument()
      // Error text is displayed in red
      const errorText = container.querySelectorAll('.text-red-600')
      expect(errorText.length).toBeGreaterThan(0)
      expect(screen.getByText('File not found')).toBeInTheDocument()
    })
  })

  describe('Metrics Display', () => {
    it('should display basic metrics', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'Read',
          status: 'success',
          timestamp: new Date(1000),
          completedAt: new Date(2000),
          index: 0,
        },
        {
          id: 'tool-2',
          title: 'Write',
          status: 'running',
          timestamp: new Date(2000),
          index: 1,
        },
      ]

      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Test',
          timestamp: new Date(),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          messages,
          toolCalls,
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // Check metrics footer textContent since text is split across elements
      const footer = container.querySelector('.border-t.px-6.py-3')
      expect(footer).toBeInTheDocument()
      expect(footer?.textContent).toContain('2')
      expect(footer?.textContent).toContain('tool calls')
      expect(footer?.textContent).toContain('1')
      expect(footer?.textContent).toContain('completed')
      expect(footer?.textContent).toContain('messages')
    })
  })

  describe('Callbacks', () => {
    it('should call onComplete when execution completes', async () => {
      const onComplete = vi.fn()

      const { rerender } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" onComplete={onComplete} />
      )

      // Initial state - running
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: 1000,
          },
          isConnected: true,
        })
      )

      rerender(
        <ThemeProvider>
          <ExecutionMonitor executionId="test-exec-1" onComplete={onComplete} />
        </ThemeProvider>
      )

      // Change to completed
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: 1000,
            endTime: 3000,
          },
          isConnected: true,
        })
      )

      rerender(
        <ThemeProvider>
          <ExecutionMonitor executionId="test-exec-1" onComplete={onComplete} />
        </ThemeProvider>
      )

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled()
      })
    })

    it('should call onError when execution errors', async () => {
      const onError = vi.fn()
      const testError = new Error('Test error')

      const { rerender } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" onError={onError} />
      )

      // Initial state - running
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: 1000,
          },
          isConnected: true,
        })
      )

      rerender(
        <ThemeProvider>
          <ExecutionMonitor executionId="test-exec-1" onError={onError} />
        </ThemeProvider>
      )

      // Change to error
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'error',
            error: 'Test error',
            startTime: 1000,
            endTime: 2000,
          },
          error: testError,
          isConnected: true,
        })
      )

      rerender(
        <ThemeProvider>
          <ExecutionMonitor executionId="test-exec-1" onError={onError} />
        </ThemeProvider>
      )

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(testError)
      })
    })
  })

  describe('Empty State', () => {
    it('should display empty state when no activity', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // Should show loading spinner instead of "No execution activity yet" when connected
      expect(screen.getByText('Waiting for events...')).toBeInTheDocument()
      expect(screen.queryByText('No execution activity yet')).not.toBeInTheDocument()
    })
  })

  describe('Historical Execution Mode', () => {
    beforeEach(() => {
      // Mock useExecutionLogs to return empty initially
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({}))
    })

    it('should use WebSocket stream for active execution (running)', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          isConnected: true,
        })
      )

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Verify WebSocket hook was called with executionId
      expect(mockUseSessionUpdateStream).toHaveBeenCalledWith({
        executionId: 'test-exec-1',
      })

      // Verify logs hook was called
      expect(mockUseExecutionLogs).toHaveBeenCalledWith('test-exec-1')

      // Should show "Live" badge for WebSocket
      expect(screen.getByText('Live')).toBeInTheDocument()
    })

    it('should use logs API for completed execution', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        metadata: {
          lineCount: 10,
          byteSize: 5000,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:10:00Z',
        },
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Verify WebSocket hook was called with null executionId (disconnected)
      expect(mockUseSessionUpdateStream).toHaveBeenCalledWith({
        executionId: null,
      })

      // Verify logs hook was called
      expect(mockUseExecutionLogs).toHaveBeenCalledWith('test-exec-1')

      // Should NOT show "Live" badge for historical
      expect(screen.queryByText('Live')).not.toBeInTheDocument()

      // Should show completed status
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    it('should display loading state for historical execution', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        loading: true,
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should show connecting badge when loading (getAllByText since it appears multiple times)
      const connectingElements = screen.getAllByText(/connecting/i)
      expect(connectingElements.length).toBeGreaterThan(0)
    })

    it('should display error state for historical execution', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        error: new Error('Failed to load execution logs'),
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should show error badge
      const errorBadges = screen.getAllByText('Error')
      expect(errorBadges.length).toBeGreaterThan(0)

      // Should show error message
      expect(screen.getByText('Failed to load execution logs')).toBeInTheDocument()
    })

    it('should handle transition from active to completed', () => {
      const { rerender } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Initially should use WebSocket (active)
      expect(mockUseSessionUpdateStream).toHaveBeenCalledWith({
        executionId: 'test-exec-1',
      })

      // Update to completed
      rerender(
        <ThemeProvider>
          <ExecutionMonitor
            executionId="test-exec-1"
            execution={{ status: 'completed' } as any}
          />
        </ThemeProvider>
      )

      // Should now use logs API (executionId=null for WebSocket)
      expect(mockUseSessionUpdateStream).toHaveBeenCalledWith({
        executionId: null,
      })
    })

    it('should display historical messages correctly', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      // Mock pre-processed logs returned by useExecutionLogs hook
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          {
            sessionUpdate: 'agent_message_complete',
            content: { type: 'text', text: 'Hello world!' },
            timestamp: new Date('2025-01-01T00:00:00Z'),
          },
        ],
        processed: {
          messages: [
            {
              id: 'msg-0',
              content: 'Hello world!',
              timestamp: new Date('2025-01-01T00:00:00Z'),
              isStreaming: false,
              index: 0,
            },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: {
          lineCount: 1,
          byteSize: 50,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:01Z',
        },
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should display the complete message
      expect(screen.getByText('Hello world!')).toBeInTheDocument()
    })

    it('should display historical tool calls correctly', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          {
            sessionUpdate: 'tool_call_complete',
            toolCallId: 'tool-1',
            title: 'Read',
            status: 'completed',
            result: 'File contents here',
            rawInput: { file: 'test.ts' },
            timestamp: new Date('2025-01-01T00:00:02Z'),
            completedAt: new Date('2025-01-01T00:00:02Z'),
          },
        ],
        processed: {
          messages: [],
          toolCalls: [
            {
              id: 'tool-1',
              title: 'Read',
              status: 'success',
              result: 'File contents here',
              rawInput: { file: 'test.ts' },
              timestamp: new Date('2025-01-01T00:00:02Z'),
              completedAt: new Date('2025-01-01T00:00:02Z'),
              index: 0,
            },
          ],
          thoughts: [],
        },
        metadata: {
          lineCount: 1,
          byteSize: 100,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:02Z',
        },
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should display the tool call
      expect(screen.getByText('Read')).toBeInTheDocument()
      // New UI uses colored dots instead of text badges
      expect(screen.getByText('⏺')).toBeInTheDocument()
    })

    it('should handle multiple messages and tool calls from historical events', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'First message' }, timestamp: new Date(1000) },
          { sessionUpdate: 'tool_call_complete', toolCallId: 'tool-1', title: 'Write', status: 'completed', timestamp: new Date(2000) },
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Second message' }, timestamp: new Date(3000) },
        ],
        processed: {
          messages: [
            { id: 'msg-0', content: 'First message', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'msg-1', content: 'Second message', timestamp: new Date(3000), isStreaming: false, index: 1 },
          ],
          toolCalls: [
            { id: 'tool-1', title: 'Write', status: 'success', timestamp: new Date(2000), index: 0 },
          ],
          thoughts: [],
        },
        metadata: {
          lineCount: 3,
          byteSize: 200,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:03Z',
        },
      }))

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should display both messages
      expect(screen.getByText('First message')).toBeInTheDocument()
      expect(screen.getByText('Second message')).toBeInTheDocument()

      // Should display the tool call
      expect(screen.getByText('Write')).toBeInTheDocument()

      // Should show metrics with correct counts
      const footer = container.querySelector('.border-t.px-6.py-3')
      expect(footer?.textContent).toContain('1')
      expect(footer?.textContent).toContain('tool call')
      expect(footer?.textContent).toContain('2')
      expect(footer?.textContent).toContain('messages')
    })

    it('should preserve ordering with timestamps from historical events', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      // Events with proper timestamps for ordering via processed data
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'First' }, timestamp: new Date(1000) },
          { sessionUpdate: 'tool_call_complete', toolCallId: 'tool-1', title: 'Read', status: 'completed', timestamp: new Date(2000) },
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Second' }, timestamp: new Date(3000) },
        ],
        processed: {
          messages: [
            { id: 'msg-0', content: 'First', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'msg-1', content: 'Second', timestamp: new Date(3000), isStreaming: false, index: 1 },
          ],
          toolCalls: [
            { id: 'tool-1', title: 'Read', status: 'success', timestamp: new Date(2000), index: 0 },
          ],
          thoughts: [],
        },
      }))

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Verify items are rendered in correct order (each wrapped in .group)
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(3)

      // First: message "First" (timestamp 1000)
      expect(items[0].textContent).toContain('First')
      // Second: tool call "Read" (timestamp 2000)
      expect(items[1].textContent).toContain('Read')
      // Third: message "Second" (timestamp 3000)
      expect(items[2].textContent).toContain('Second')
    })

    it('should assign sequential indices for stable ordering when timestamps are equal', () => {
      mockUseSessionUpdateStream.mockReturnValue(createMockStreamResult({}))

      // All events have same timestamp (simulating rapid processing) - order preserved via index
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Alpha' }, timestamp: new Date(1000) },
          { sessionUpdate: 'tool_call_complete', toolCallId: 'tool-1', title: 'Bash', status: 'completed', timestamp: new Date(1000) },
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Beta' }, timestamp: new Date(1000) },
        ],
        processed: {
          messages: [
            { id: 'msg-0', content: 'Alpha', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'msg-1', content: 'Beta', timestamp: new Date(1000), isStreaming: false, index: 1 },
          ],
          toolCalls: [
            { id: 'tool-1', title: 'Bash', status: 'success', timestamp: new Date(1000), index: 0 },
          ],
          thoughts: [],
        },
      }))

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Verify all items rendered (each wrapped in .group)
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(3)

      // With index-based sorting, order should be:
      // msg-1 (index 0), tool-1 (index 0), msg-2 (index 1)
      // Messages get their own counter, tool calls get their own counter
      // So the order depends on timestamp first, then index within same type
      expect(items[0].textContent).toContain('Alpha')
      expect(items[1].textContent).toContain('Bash')
      expect(items[2].textContent).toContain('Beta')
    })

    it('should show WebSocket data while logs are loading during transition (no flicker)', () => {
      // WebSocket stream has data from running execution
      const wsMessages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'WebSocket streamed message',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      const wsToolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'Read',
          rawInput: {},
          status: 'success',
          timestamp: new Date(2000),
          completedAt: new Date(2500),
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'disconnected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: 1000,
            endTime: 3000,
          },
          messages: wsMessages,
          toolCalls: wsToolCalls,
          isConnected: false,
        })
      )

      // Logs are still loading
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        loading: true,
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should still show WebSocket data while logs are loading (no flicker)
      expect(screen.getByText('WebSocket streamed message')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()

      // Should NOT show empty state
      expect(screen.queryByText('No execution activity yet')).not.toBeInTheDocument()
    })

    it('should switch to logs data once loaded', () => {
      // WebSocket stream has data from running execution
      const wsMessages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'WebSocket message',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'disconnected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: 1000,
            endTime: 3000,
          },
          messages: wsMessages,
          isConnected: false,
        })
      )

      // Logs have finished loading with different content
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Logs message' }, timestamp: new Date(1000) },
        ],
        processed: {
          messages: [
            { id: 'log-msg-1', content: 'Logs message', timestamp: new Date(1000), isStreaming: false, index: 0 },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: { lineCount: 1, byteSize: 50, createdAt: '', updatedAt: '' },
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should show logs data (not WebSocket data) once logs are loaded
      expect(screen.getByText('Logs message')).toBeInTheDocument()
      expect(screen.queryByText('WebSocket message')).not.toBeInTheDocument()
    })

    it('should fall back to saved logs when WebSocket disconnects unexpectedly during active execution', () => {
      // Simulate WebSocket disconnect scenario:
      // WebSocket connection is disconnected, no WebSocket data (cleared), but logs are available
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'disconnected',
          isConnected: false,
        })
      )

      // Saved logs have the execution history
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Saved message from logs' }, timestamp: new Date(1000) },
          { sessionUpdate: 'tool_call_complete', toolCallId: 'tool-1', title: 'Read', status: 'completed', result: 'File contents', timestamp: new Date(2000) },
        ],
        processed: {
          messages: [
            { id: 'msg-1', content: 'Saved message from logs', timestamp: new Date(1000), isStreaming: false, index: 0 },
          ],
          toolCalls: [
            { id: 'tool-1', title: 'Read', status: 'success', result: 'File contents', timestamp: new Date(2000), index: 0 },
          ],
          thoughts: [],
        },
        metadata: { lineCount: 2, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Should show saved logs instead of empty screen
      expect(screen.getByText('Saved message from logs')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()

      // Should NOT show empty state
      expect(screen.queryByText('No execution activity')).not.toBeInTheDocument()
      expect(screen.queryByText('Waiting for events...')).not.toBeInTheDocument()
    })
  })

  describe('Agent-Specific Rendering', () => {
    it('should use ClaudeCodeTrajectory for claude-code agent type', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Let me think about this problem...',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          messages,
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'running', agent_type: 'claude-code' } as any}
        />
      )

      // ClaudeCodeTrajectory should render with terminal-style dots
      expect(container.textContent).toContain('⏺')
      expect(screen.getByText(/Let me think/)).toBeInTheDocument()
    })

    it('should use unified AgentTrajectory for non-claude-code agent types', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Let me think about this problem...',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          messages,
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'running', agent_type: 'codex' } as any}
        />
      )

      // Unified AgentTrajectory uses terminal-style dots
      expect(container.textContent).toContain('⏺')
      expect(screen.getByText(/Let me think/)).toBeInTheDocument()
    })

    it('should use unified AgentTrajectory when agent_type is not specified', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Test message',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          messages,
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Should use unified AgentTrajectory with terminal-style rendering
      expect(container.textContent).toContain('⏺')
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })
  })

  describe('TodoTracker Integration', () => {
    it('should display TodoTracker when there are plan updates', () => {
      // Note: Claude Code's TodoWrite is an internal tool that does NOT emit tool_call events.
      // Instead, todo state is exposed via ACP "plan" session updates.
      const planUpdates: useSessionUpdateStreamModule.PlanUpdateEvent[] = [
        {
          id: 'plan-1',
          entries: [
            { content: 'Task 1', status: 'pending', priority: 'high' },
            { content: 'Task 2', status: 'in_progress', priority: 'medium' },
            { content: 'Task 3', status: 'completed', priority: 'low' },
          ],
          timestamp: new Date(1000),
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          planUpdates,
          isConnected: true,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'running', agent_type: 'claude-code' } as any}
        />
      )

      // Should display TodoTracker
      expect(screen.getByText(/1\/3 completed/)).toBeInTheDocument()
      expect(screen.getByText('Task 1')).toBeInTheDocument()
      expect(screen.getByText('Task 2')).toBeInTheDocument()
      expect(screen.getByText('Task 3')).toBeInTheDocument()
    })

    it('should not display TodoTracker when there are no plan updates', () => {
      // When there are no plan updates, TodoTracker should not display
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'Bash',
          rawInput: JSON.stringify({ command: 'npm test' }),
          status: 'success',
          result: 'Tests passed',
          timestamp: new Date(1000),
          completedAt: new Date(2000),
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          toolCalls,
          planUpdates: [], // No plan updates means no todos
          isConnected: true,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'running', agent_type: 'claude-code' } as any}
        />
      )

      // Should not display TodoTracker (look for the N/M completed pattern)
      expect(screen.queryByText(/\/.*completed/)).not.toBeInTheDocument()
    })
  })

  describe('Compact Mode', () => {
    it('should render without card wrapper in compact mode', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Test message',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: Date.now(),
            endTime: Date.now() + 1000,
          },
          messages,
          isConnected: false,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'completed' } as any}
          compact
        />
      )

      // Should not have card wrapper (no "Execution Monitor" header)
      expect(screen.queryByText('Execution Monitor')).not.toBeInTheDocument()
      // Should still display content
      expect(screen.getByText('Test message')).toBeInTheDocument()
      // Should not have footer metrics in compact mode
      expect(screen.queryByText('tool calls')).not.toBeInTheDocument()
    })

    it('should render with card wrapper when not in compact mode', () => {
      const messages: AgentMessage[] = [
        {
          id: 'msg-1',
          content: 'Test message',
          timestamp: new Date(1000),
          isStreaming: false,
          index: 0,
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: Date.now(),
            endTime: Date.now() + 1000,
          },
          messages,
          isConnected: false,
        })
      )

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should have card wrapper with "Execution Monitor" header
      expect(screen.getByText('Execution Monitor')).toBeInTheDocument()
      // Should still display content
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    it('should display user prompt in compact mode when prompt is provided', () => {
      // Use completed status since active non-persistent sessions rely on WebSocket for user messages
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: Date.now(),
          },
          isConnected: false,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{
            status: 'completed',
            prompt: 'Please implement the login feature',
          } as any}
          compact
        />
      )

      // Should display the user prompt
      expect(screen.getByText('Please implement the login feature')).toBeInTheDocument()
    })

    it('should display follow-up prompt in compact mode', () => {
      // Use completed status since active non-persistent sessions rely on WebSocket for user messages
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: Date.now(),
          },
          isConnected: false,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-2"
          execution={{
            status: 'completed',
            prompt: 'Can you also add error handling?',
            parent_execution_id: 'test-exec-1',
          } as any}
          compact
        />
      )

      // Should display the follow-up prompt
      expect(screen.getByText('Can you also add error handling?')).toBeInTheDocument()
    })

    it('should not display user prompt in compact mode when prompt is null', () => {
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          isConnected: true,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{
            status: 'running',
            prompt: null,
          } as any}
          compact
        />
      )

      // Should not display user prompt section
      const promptElement = screen.queryByText(/Please|implement|login/)
      expect(promptElement).not.toBeInTheDocument()
    })

    it('should preserve whitespace in user prompt', () => {
      // Use completed status since active non-persistent sessions rely on WebSocket for user messages
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'completed',
            startTime: Date.now(),
          },
          isConnected: false,
        })
      )

      const multilinePrompt = 'Please:\n1. Add tests\n2. Update docs\n3. Fix bugs'

      const { container } = renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{
            status: 'completed',
            prompt: multilinePrompt,
          } as any}
          compact
        />
      )

      // Should display the prompt with whitespace preserved
      // Use textContent to check the full text with preserved newlines
      const promptElement = container.querySelector('.whitespace-pre-wrap')
      expect(promptElement?.textContent).toBe(multilinePrompt)
    })
  })

  describe('Persistent Session Data Merging', () => {
    // These tests verify that when continuing an execution (e.g., in a persistent session),
    // historical data from logs is properly merged with new streaming data from WebSocket,
    // maintaining correct chronological order.

    it('should show logs data while WebSocket data is empty', () => {
      // Logs have historical data
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [
          { sessionUpdate: 'agent_message_complete', content: { type: 'text', text: 'Historical message' }, timestamp: new Date(1000) },
        ],
        processed: {
          messages: [
            { id: 'msg-0', content: 'Historical message', timestamp: new Date(1000), isStreaming: false, index: 0 },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: { lineCount: 1, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has no data yet (transition from waiting to running)
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [],
          toolCalls: [],
          isConnected: true,
        })
      )

      renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Should show logs data (only for persistent sessions)
      expect(screen.getByText('Historical message')).toBeInTheDocument()
    })

    it('should merge logs and WebSocket messages with correct ordering', () => {
      // Logs have historical messages with indices 0, 1
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [
            { id: 'msg-0', content: 'First historical message', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'msg-1', content: 'Second historical message', timestamp: new Date(2000), isStreaming: false, index: 1 },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: { lineCount: 2, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has new messages with indices 0, 1 (reset on mount)
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [
            { id: 'ws-msg-0', content: 'New WebSocket message 1', timestamp: new Date(3000), isStreaming: false, index: 0 },
            { id: 'ws-msg-1', content: 'New WebSocket message 2', timestamp: new Date(4000), isStreaming: false, index: 1 },
          ],
          toolCalls: [],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Should show all 4 messages
      expect(screen.getByText('First historical message')).toBeInTheDocument()
      expect(screen.getByText('Second historical message')).toBeInTheDocument()
      expect(screen.getByText('New WebSocket message 1')).toBeInTheDocument()
      expect(screen.getByText('New WebSocket message 2')).toBeInTheDocument()

      // Verify order: historical messages first (indices 0, 1), then WebSocket messages (indices 2, 3 after offset)
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(4)
      expect(items[0].textContent).toContain('First historical message')
      expect(items[1].textContent).toContain('Second historical message')
      expect(items[2].textContent).toContain('New WebSocket message 1')
      expect(items[3].textContent).toContain('New WebSocket message 2')
    })

    it('should merge logs and WebSocket tool calls with correct ordering', () => {
      // Logs have historical tool calls
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [],
          toolCalls: [
            { id: 'tool-0', title: 'Read', status: 'success', timestamp: new Date(1000), completedAt: new Date(1500), index: 0 },
            { id: 'tool-1', title: 'Write', status: 'success', timestamp: new Date(2000), completedAt: new Date(2500), index: 1 },
          ],
          thoughts: [],
        },
        metadata: { lineCount: 2, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has new tool calls
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [],
          toolCalls: [
            { id: 'ws-tool-0', title: 'Bash', status: 'success', timestamp: new Date(3000), completedAt: new Date(3500), index: 0 },
            { id: 'ws-tool-1', title: 'Glob', status: 'running', timestamp: new Date(4000), index: 1 },
          ],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Should show all 4 tool calls
      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.getByText('Glob')).toBeInTheDocument()

      // Verify order: historical tool calls first, then WebSocket tool calls
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(4)
      expect(items[0].textContent).toContain('Read')
      expect(items[1].textContent).toContain('Write')
      expect(items[2].textContent).toContain('Bash')
      expect(items[3].textContent).toContain('Glob')
    })

    it('should maintain correct interleaved order of messages and tool calls', () => {
      // Logs have interleaved messages and tool calls
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [
            { id: 'msg-0', content: 'Let me read the file', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'msg-1', content: 'I found the issue', timestamp: new Date(3000), isStreaming: false, index: 2 },
          ],
          toolCalls: [
            { id: 'tool-0', title: 'Read', status: 'success', timestamp: new Date(2000), completedAt: new Date(2500), index: 1 },
          ],
          thoughts: [],
        },
        metadata: { lineCount: 3, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has new interleaved messages and tool calls
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [
            { id: 'ws-msg-0', content: 'Let me fix it', timestamp: new Date(4000), isStreaming: false, index: 0 },
            { id: 'ws-msg-1', content: 'Done!', timestamp: new Date(6000), isStreaming: false, index: 2 },
          ],
          toolCalls: [
            { id: 'ws-tool-0', title: 'Edit', status: 'success', timestamp: new Date(5000), completedAt: new Date(5500), index: 1 },
          ],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Verify all items present
      expect(screen.getByText('Let me read the file')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('I found the issue')).toBeInTheDocument()
      expect(screen.getByText('Let me fix it')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Done!')).toBeInTheDocument()

      // Verify order: logs items (indices 0,1,2), then WebSocket items (indices 3,4,5 after offset)
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(6)
      expect(items[0].textContent).toContain('Let me read the file')
      expect(items[1].textContent).toContain('Read')
      expect(items[2].textContent).toContain('I found the issue')
      expect(items[3].textContent).toContain('Let me fix it')
      expect(items[4].textContent).toContain('Edit')
      expect(items[5].textContent).toContain('Done!')
    })

    it('should handle user messages correctly in merged data', () => {
      // Logs have agent message + user message (persistent session follow-up)
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [
            { id: 'msg-0', content: 'Hello, how can I help?', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'user-msg-0', content: 'Can you read file.ts?', timestamp: new Date(2000), isStreaming: false, index: 1, role: 'user' },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: { lineCount: 2, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has new agent response
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [
            { id: 'ws-msg-0', content: 'Sure, let me read that file.', timestamp: new Date(3000), isStreaming: false, index: 0 },
          ],
          toolCalls: [],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Verify order: agent message, user message (with blue bg), new agent message
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(3)
      expect(items[0].textContent).toContain('Hello, how can I help?')
      expect(items[1].textContent).toContain('Can you read file.ts?')
      expect(items[2].textContent).toContain('Sure, let me read that file.')

      // Verify user message has blue background styling
      const userMessageContainer = container.querySelector('.rounded-md')
      expect(userMessageContainer).toBeInTheDocument()
    })

    it('should handle duplicate IDs by preserving logs index', () => {
      // Logs have a message
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [
            { id: 'shared-msg-id', content: 'Original content from logs', timestamp: new Date(1000), isStreaming: false, index: 0 },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: { lineCount: 1, byteSize: 100, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has same message ID with updated content (e.g., streaming finalized)
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [
            { id: 'shared-msg-id', content: 'Updated content from WebSocket', timestamp: new Date(1000), isStreaming: false, index: 5 },
          ],
          toolCalls: [],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Should show only one message (deduplicated)
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(1)

      // Should show WebSocket content (takes precedence) but maintain logs index for ordering
      expect(screen.getByText('Updated content from WebSocket')).toBeInTheDocument()
      expect(screen.queryByText('Original content from logs')).not.toBeInTheDocument()
    })

    it('should handle empty logs with WebSocket data', () => {
      // Logs are empty (fresh execution)
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [],
          toolCalls: [],
          thoughts: [],
        },
      }))

      // WebSocket has data
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [
            { id: 'ws-msg-0', content: 'First message from stream', timestamp: new Date(1000), isStreaming: false, index: 0 },
          ],
          toolCalls: [
            { id: 'ws-tool-0', title: 'Bash', status: 'running', timestamp: new Date(2000), index: 1 },
          ],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Should show WebSocket data normally
      expect(screen.getByText('First message from stream')).toBeInTheDocument()
      expect(screen.getByText('Bash')).toBeInTheDocument()

      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(2)
    })

    it('should correctly order multiple user prompts in persistent sessions', () => {
      // Simulate a conversation with multiple user prompts
      mockUseExecutionLogs.mockReturnValue(createMockLogsResult({
        events: [],
        processed: {
          messages: [
            { id: 'msg-0', content: 'Hello!', timestamp: new Date(1000), isStreaming: false, index: 0 },
            { id: 'user-msg-0', content: 'First question', timestamp: new Date(2000), isStreaming: false, index: 1, role: 'user' },
            { id: 'msg-1', content: 'Answer to first', timestamp: new Date(3000), isStreaming: false, index: 2 },
            { id: 'user-msg-1', content: 'Second question', timestamp: new Date(4000), isStreaming: false, index: 3, role: 'user' },
          ],
          toolCalls: [],
          thoughts: [],
        },
        metadata: { lineCount: 4, byteSize: 200, createdAt: '', updatedAt: '' },
      }))

      // WebSocket has the response to the second question
      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: { runId: 'run-123', status: 'running', startTime: Date.now() },
          messages: [
            { id: 'ws-msg-0', content: 'Answer to second', timestamp: new Date(5000), isStreaming: false, index: 0 },
          ],
          toolCalls: [],
          isConnected: true,
        })
      )

      const { container } = renderWithTheme(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running', config: JSON.stringify({ sessionMode: 'persistent' }) } as any} />
      )

      // Verify all 5 messages in correct order
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(5)
      expect(items[0].textContent).toContain('Hello!')
      expect(items[1].textContent).toContain('First question')
      expect(items[2].textContent).toContain('Answer to first')
      expect(items[3].textContent).toContain('Second question')
      expect(items[4].textContent).toContain('Answer to second')
    })
  })

  describe('Skip All Permissions', () => {
    it('should pass onSkipAllPermissions prop to AgentTrajectory when permission requests exist', () => {
      const permissionRequests = [
        {
          requestId: 'perm-1',
          sessionId: 'session-123',
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Bash',
            status: 'pending',
            rawInput: { command: 'npm test' },
          },
          options: [
            { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' as const },
            { optionId: 'deny_once', name: 'Deny', kind: 'deny_once' as const },
          ],
          responded: false,
          timestamp: new Date(),
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          permissionRequests,
          isConnected: true,
        })
      )

      renderWithTheme(
        <ExecutionMonitor
          executionId="test-exec-1"
          onSkipAllPermissionsComplete={vi.fn()}
        />
      )

      // Should render the permission request with Skip All button
      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.getByText('awaiting permission')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip All' })).toBeInTheDocument()
    })

    it('should not render Skip All button when onSkipAllPermissionsComplete is not provided', () => {
      const permissionRequests = [
        {
          requestId: 'perm-1',
          sessionId: 'session-123',
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Bash',
            status: 'pending',
            rawInput: { command: 'npm test' },
          },
          options: [
            { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' as const },
          ],
          responded: false,
          timestamp: new Date(),
        },
      ]

      mockUseSessionUpdateStream.mockReturnValue(
        createMockStreamResult({
          connectionStatus: 'connected',
          execution: {
            runId: 'run-123',
            status: 'running',
            startTime: Date.now(),
          },
          permissionRequests,
          isConnected: true,
        })
      )

      renderWithTheme(<ExecutionMonitor executionId="test-exec-1" />)

      // Should render permission request but NOT the Skip All button
      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Skip All' })).not.toBeInTheDocument()
    })
  })
})
