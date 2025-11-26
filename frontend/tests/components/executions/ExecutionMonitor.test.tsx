/**
 * ExecutionMonitor Component Tests
 *
 * Tests for the AG-UI execution monitoring component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ExecutionMonitor } from '@/components/executions/ExecutionMonitor'
import * as useAgUiStreamModule from '@/hooks/useAgUiStream'
import * as useExecutionLogsModule from '@/hooks/useExecutionLogs'

// Mock the hooks
const mockUseAgUiStream = vi.spyOn(useAgUiStreamModule, 'useAgUiStream')
const mockUseExecutionLogs = vi.spyOn(useExecutionLogsModule, 'useExecutionLogs')

describe('ExecutionMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for useExecutionLogs (prevent actual fetch calls)
    mockUseExecutionLogs.mockReturnValue({
      events: [],
      loading: false,
      error: null,
      metadata: null,
    })
  })

  describe('Loading State', () => {
    it('should display connecting state initially', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connecting',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText(/connecting to execution stream/i)).toBeInTheDocument()
    })
  })

  describe('Status Display', () => {
    it('should display running status', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: 'process-data',
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('process-data')).toBeInTheDocument()
      expect(screen.getByText('Live')).toBeInTheDocument()
    })

    it('should display completed status', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'completed',
          currentStep: null,
          error: null,
          startTime: 1000,
          endTime: 3000,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Completed')).toBeInTheDocument()
      // Check duration display (3000 - 1000 = 2000ms = 2.00s)
      expect(screen.getByText(/2\.00s/)).toBeInTheDocument()
    })

    it('should display error status', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'error',
          currentStep: null,
          error: 'Test error message',
          startTime: 1000,
          endTime: 2000,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: new Error('Test error message'),
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      // Check for error badge in header
      const errorBadges = screen.getAllByText('Error')
      expect(errorBadges.length).toBeGreaterThan(0)

      // Check for error message
      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })
  })

  describe('Progress Display', () => {
    it('should display progress bar when state has progress', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {
          progress: 50,
          totalSteps: 100,
        },
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Progress')).toBeInTheDocument()
      expect(screen.getByText('50 / 100')).toBeInTheDocument()
    })
  })

  describe('Messages Display', () => {
    it('should display messages from stream', () => {
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        timestamp: Date.now(),
        role: 'assistant',
        content: 'Hello, this is a test message!',
        complete: true,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      // In the unified trajectory view, there's no "Messages" header
      // Just verify the message content is displayed
      expect(screen.getByText('assistant')).toBeInTheDocument()
      expect(screen.getByText('Hello, this is a test message!')).toBeInTheDocument()
    })

    it('should show spinner for incomplete messages', () => {
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        timestamp: Date.now(),
        role: 'assistant',
        content: 'Streaming message...',
        complete: false,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      const { container } = render(<ExecutionMonitor executionId="test-exec-1" />)

      // Check for spinner by looking for animate-spin class
      const spinners = container.querySelectorAll('.animate-spin')
      expect(spinners.length).toBeGreaterThan(0)
    })
  })

  describe('Tool Calls Display', () => {
    it('should display tool calls from stream', () => {
      const toolCalls = new Map()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '{"file": "test.ts"}',
        status: 'completed',
        result: 'File contents here',
        startTime: 1000,
        endTime: 2000,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls,
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      // In the unified trajectory view, there's no "Tool Calls" header
      // Just verify the tool call is displayed
      expect(screen.getByText('Read')).toBeInTheDocument()
      // Check for completed status badge
      const completedBadges = screen.getAllByText('completed')
      expect(completedBadges.length).toBeGreaterThan(0)
      expect(screen.getByText('1.00s')).toBeInTheDocument()
    })

    it('should display tool call error', () => {
      const toolCalls = new Map()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Write',
        args: '{"file": "test.ts"}',
        status: 'error',
        error: 'File not found',
        startTime: 1000,
        endTime: 2000,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls,
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      const { container } = render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Write')).toBeInTheDocument()
      // Use a more specific selector for the error badge
      const errorBadges = container.querySelectorAll('.bg-destructive')
      expect(errorBadges.length).toBeGreaterThan(0)
      expect(screen.getByText('File not found')).toBeInTheDocument()
    })
  })

  describe('Metrics Display', () => {
    it('should display basic metrics', () => {
      const toolCalls = new Map()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        startTime: 1000,
        endTime: 2000,
      })
      toolCalls.set('tool-2', {
        toolCallId: 'tool-2',
        toolCallName: 'Write',
        args: '',
        status: 'started',
        startTime: 2000,
      })

      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        timestamp: Date.now(),
        role: 'assistant',
        content: 'Test',
        complete: true,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages,
        toolCalls,
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      const { container } = render(<ExecutionMonitor executionId="test-exec-1" />)

      // Check metrics footer textContent since text is split across elements
      const footer = container.querySelector('.border-t.px-6.py-3')
      expect(footer).toBeInTheDocument()
      expect(footer?.textContent).toContain('2')
      expect(footer?.textContent).toContain('tool calls')
      expect(footer?.textContent).toContain('1')
      expect(footer?.textContent).toContain('completed')
      expect(footer?.textContent).toContain('messages')
    })

    it('should display token usage and cost when available', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {
          tokenUsage: 1500,
          cost: 0.0234,
        },
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      const { container } = render(<ExecutionMonitor executionId="test-exec-1" />)

      // Check metrics footer textContent since text is split across elements
      const footer = container.querySelector('.border-t.px-6.py-3')
      expect(footer).toBeInTheDocument()
      expect(footer?.textContent).toContain('1500')
      expect(footer?.textContent).toContain('tokens')
      expect(footer?.textContent).toContain('$0.0234')
    })
  })

  describe('Callbacks', () => {
    it('should call onComplete when execution completes', async () => {
      const onComplete = vi.fn()

      const { rerender } = render(
        <ExecutionMonitor executionId="test-exec-1" onComplete={onComplete} />
      )

      // Initial state - running
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: 1000,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      rerender(<ExecutionMonitor executionId="test-exec-1" onComplete={onComplete} />)

      // Change to completed
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'completed',
          currentStep: null,
          error: null,
          startTime: 1000,
          endTime: 3000,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      rerender(<ExecutionMonitor executionId="test-exec-1" onComplete={onComplete} />)

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled()
      })
    })

    it('should call onError when execution errors', async () => {
      const onError = vi.fn()
      const testError = new Error('Test error')

      const { rerender } = render(<ExecutionMonitor executionId="test-exec-1" onError={onError} />)

      // Initial state - running
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: 1000,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      rerender(<ExecutionMonitor executionId="test-exec-1" onError={onError} />)

      // Change to error
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'error',
          currentStep: null,
          error: 'Test error',
          startTime: 1000,
          endTime: 2000,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: testError,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      rerender(<ExecutionMonitor executionId="test-exec-1" onError={onError} />)

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(testError)
      })
    })
  })

  describe('Empty State', () => {
    it('should display empty state when no activity', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      // Should show loading spinner instead of "No execution activity yet" when connected
      expect(screen.getByText('Waiting for events...')).toBeInTheDocument()
      expect(screen.queryByText('No execution activity yet')).not.toBeInTheDocument()
    })
  })

  describe('Historical Execution Mode', () => {
    beforeEach(() => {
      // Mock useExecutionLogs to return empty initially
      mockUseExecutionLogs.mockReturnValue({
        events: [],
        loading: false,
        error: null,
        metadata: null,
      })
    })

    it('should use SSE stream for active execution (running)', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Verify SSE hook was called with autoConnect=true
      expect(mockUseAgUiStream).toHaveBeenCalledWith({
        executionId: 'test-exec-1',
        autoConnect: true,
      })

      // Verify logs hook was called
      expect(mockUseExecutionLogs).toHaveBeenCalledWith('test-exec-1')

      // Should show "Live" badge for SSE
      expect(screen.getByText('Live')).toBeInTheDocument()
    })

    it('should use logs API for completed execution', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      mockUseExecutionLogs.mockReturnValue({
        events: [],
        loading: false,
        error: null,
        metadata: {
          lineCount: 10,
          byteSize: 5000,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:10:00Z',
        },
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Verify SSE hook was called with autoConnect=false
      expect(mockUseAgUiStream).toHaveBeenCalledWith({
        executionId: 'test-exec-1',
        autoConnect: false,
      })

      // Verify logs hook was called
      expect(mockUseExecutionLogs).toHaveBeenCalledWith('test-exec-1')

      // Should NOT show "Live" badge for historical
      expect(screen.queryByText('Live')).not.toBeInTheDocument()

      // Should show completed status
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    it('should display loading state for historical execution', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      mockUseExecutionLogs.mockReturnValue({
        events: [],
        loading: true,
        error: null,
        metadata: null,
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should show connecting badge when loading (getAllByText since it appears multiple times)
      const connectingElements = screen.getAllByText(/connecting/i)
      expect(connectingElements.length).toBeGreaterThan(0)
    })

    it('should display error state for historical execution', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      mockUseExecutionLogs.mockReturnValue({
        events: [],
        loading: false,
        error: new Error('Failed to load execution logs'),
        metadata: null,
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should show error badge
      const errorBadges = screen.getAllByText('Error')
      expect(errorBadges.length).toBeGreaterThan(0)

      // Should show error message
      expect(screen.getByText('Failed to load execution logs')).toBeInTheDocument()
    })

    it('should handle transition from active to completed', () => {
      const { rerender } = render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Initially should use SSE (active)
      expect(mockUseAgUiStream).toHaveBeenCalledWith({
        executionId: 'test-exec-1',
        autoConnect: true,
      })

      // Update to completed
      rerender(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should now use logs API (autoConnect=false for SSE)
      expect(mockUseAgUiStream).toHaveBeenCalledWith({
        executionId: 'test-exec-1',
        autoConnect: false,
      })
    })

    it('should process historical TEXT_MESSAGE events correctly', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      // Mock AG-UI events in the format returned by /logs API
      mockUseExecutionLogs.mockReturnValue({
        events: [
          {
            type: 'TEXT_MESSAGE_START',
            timestamp: 1000,
            messageId: 'msg-1',
            role: 'assistant',
          },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            timestamp: 1001,
            messageId: 'msg-1',
            delta: 'Hello ',
          },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            timestamp: 1002,
            messageId: 'msg-1',
            delta: 'world!',
          },
          {
            type: 'TEXT_MESSAGE_END',
            timestamp: 1003,
            messageId: 'msg-1',
          },
        ],
        loading: false,
        error: null,
        metadata: {
          lineCount: 4,
          byteSize: 200,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:01Z',
        },
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should display the complete message
      expect(screen.getByText('Hello world!')).toBeInTheDocument()
    })

    it('should process historical TOOL_CALL events correctly', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      mockUseExecutionLogs.mockReturnValue({
        events: [
          {
            type: 'TOOL_CALL_START',
            timestamp: 2000,
            toolCallId: 'tool-1',
            toolCallName: 'Read',
          },
          {
            type: 'TOOL_CALL_ARGS',
            timestamp: 2001,
            toolCallId: 'tool-1',
            delta: '{"file":',
          },
          {
            type: 'TOOL_CALL_ARGS',
            timestamp: 2002,
            toolCallId: 'tool-1',
            delta: '"test.ts"}',
          },
          {
            type: 'TOOL_CALL_END',
            timestamp: 2003,
            toolCallId: 'tool-1',
          },
          {
            type: 'TOOL_CALL_RESULT',
            timestamp: 2004,
            toolCallId: 'tool-1',
            result: 'File contents here',
          },
        ],
        loading: false,
        error: null,
        metadata: {
          lineCount: 5,
          byteSize: 300,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:02Z',
        },
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should display the tool call
      expect(screen.getByText('Read')).toBeInTheDocument()

      // Should show completed status (use getAllByText since "completed" appears multiple times)
      const completedBadges = screen.getAllByText('completed')
      expect(completedBadges.length).toBeGreaterThan(0)
    })

    it('should handle multiple messages and tool calls from historical events', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      mockUseExecutionLogs.mockReturnValue({
        events: [
          // First message
          { type: 'TEXT_MESSAGE_START', timestamp: 1000, messageId: 'msg-1', role: 'assistant' },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            timestamp: 1001,
            messageId: 'msg-1',
            delta: 'First message',
          },
          { type: 'TEXT_MESSAGE_END', timestamp: 1002, messageId: 'msg-1' },
          // Tool call
          { type: 'TOOL_CALL_START', timestamp: 2000, toolCallId: 'tool-1', toolCallName: 'Write' },
          {
            type: 'TOOL_CALL_ARGS',
            timestamp: 2001,
            toolCallId: 'tool-1',
            delta: '{"file":"test.txt"}',
          },
          { type: 'TOOL_CALL_END', timestamp: 2002, toolCallId: 'tool-1' },
          { type: 'TOOL_CALL_RESULT', timestamp: 2003, toolCallId: 'tool-1', result: 'Success' },
          // Second message
          { type: 'TEXT_MESSAGE_START', timestamp: 3000, messageId: 'msg-2', role: 'assistant' },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            timestamp: 3001,
            messageId: 'msg-2',
            delta: 'Second message',
          },
          { type: 'TEXT_MESSAGE_END', timestamp: 3002, messageId: 'msg-2' },
        ],
        loading: false,
        error: null,
        metadata: {
          lineCount: 10,
          byteSize: 500,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:03Z',
        },
      })

      const { container } = render(
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
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      // Events with proper timestamps for ordering
      mockUseExecutionLogs.mockReturnValue({
        events: [
          // First message at time 1000
          { type: 'TEXT_MESSAGE_START', timestamp: 1000, messageId: 'msg-1', role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', timestamp: 1000, messageId: 'msg-1', delta: 'First' },
          { type: 'TEXT_MESSAGE_END', timestamp: 1000, messageId: 'msg-1' },
          // Tool call at time 2000
          { type: 'TOOL_CALL_START', timestamp: 2000, toolCallId: 'tool-1', toolCallName: 'Read' },
          { type: 'TOOL_CALL_END', timestamp: 2500, toolCallId: 'tool-1' },
          { type: 'TOOL_CALL_RESULT', timestamp: 2500, toolCallId: 'tool-1', result: 'data' },
          // Second message at time 3000
          { type: 'TEXT_MESSAGE_START', timestamp: 3000, messageId: 'msg-2', role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', timestamp: 3000, messageId: 'msg-2', delta: 'Second' },
          { type: 'TEXT_MESSAGE_END', timestamp: 3000, messageId: 'msg-2' },
        ],
        loading: false,
        error: null,
        metadata: null,
      })

      const { container } = render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Verify items are rendered in correct order
      const items = container.querySelectorAll('.flex.gap-3.items-start')
      expect(items.length).toBe(3)

      // First: message "First" (timestamp 1000)
      expect(items[0].textContent).toContain('First')
      // Second: tool call "Read" (timestamp 2000)
      expect(items[1].textContent).toContain('Read')
      // Third: message "Second" (timestamp 3000)
      expect(items[2].textContent).toContain('Second')
    })

    it('should assign sequential indices for stable ordering when timestamps are equal', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'idle',
        execution: {
          runId: null,
          threadId: null,
          status: 'idle',
          currentStep: null,
          error: null,
          startTime: null,
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      // All events have same timestamp (simulating rapid processing)
      mockUseExecutionLogs.mockReturnValue({
        events: [
          // All at same timestamp - order should be preserved via index
          { type: 'TEXT_MESSAGE_START', timestamp: 1000, messageId: 'msg-1', role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', timestamp: 1000, messageId: 'msg-1', delta: 'Alpha' },
          { type: 'TEXT_MESSAGE_END', timestamp: 1000, messageId: 'msg-1' },
          { type: 'TOOL_CALL_START', timestamp: 1000, toolCallId: 'tool-1', toolCallName: 'Bash' },
          { type: 'TOOL_CALL_END', timestamp: 1000, toolCallId: 'tool-1' },
          { type: 'TOOL_CALL_RESULT', timestamp: 1000, toolCallId: 'tool-1', result: 'ok' },
          { type: 'TEXT_MESSAGE_START', timestamp: 1000, messageId: 'msg-2', role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', timestamp: 1000, messageId: 'msg-2', delta: 'Beta' },
          { type: 'TEXT_MESSAGE_END', timestamp: 1000, messageId: 'msg-2' },
        ],
        loading: false,
        error: null,
        metadata: null,
      })

      const { container } = render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Verify all items rendered
      const items = container.querySelectorAll('.flex.gap-3.items-start')
      expect(items.length).toBe(3)

      // With index-based sorting, order should be:
      // msg-1 (index 0), tool-1 (index 0), msg-2 (index 1)
      // Messages get their own counter, tool calls get their own counter
      // So the order depends on timestamp first, then index within same type
      expect(items[0].textContent).toContain('Alpha')
      expect(items[1].textContent).toContain('Bash')
      expect(items[2].textContent).toContain('Beta')
    })

    it('should show SSE data while logs are loading during transition (no flicker)', () => {
      // SSE stream has data from running execution
      const sseMessages = new Map()
      sseMessages.set('msg-1', {
        messageId: 'msg-1',
        timestamp: 1000,
        role: 'assistant',
        content: 'SSE streamed message',
        complete: true,
      })

      const sseToolCalls = new Map()
      sseToolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '{}',
        status: 'completed',
        startTime: 2000,
        endTime: 2500,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'disconnected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'completed',
          currentStep: null,
          error: null,
          startTime: 1000,
          endTime: 3000,
        },
        messages: sseMessages,
        toolCalls: sseToolCalls,
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      // Logs are still loading
      mockUseExecutionLogs.mockReturnValue({
        events: [],
        loading: true,
        error: null,
        metadata: null,
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should still show SSE data while logs are loading (no flicker)
      expect(screen.getByText('SSE streamed message')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()

      // Should NOT show empty state
      expect(screen.queryByText('No execution activity yet')).not.toBeInTheDocument()
    })

    it('should switch to logs data once loaded', () => {
      // SSE stream has data from running execution
      const sseMessages = new Map()
      sseMessages.set('msg-1', {
        messageId: 'msg-1',
        timestamp: 1000,
        role: 'assistant',
        content: 'SSE message',
        complete: true,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'disconnected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'completed',
          currentStep: null,
          error: null,
          startTime: 1000,
          endTime: 3000,
        },
        messages: sseMessages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      // Logs have finished loading with different content
      mockUseExecutionLogs.mockReturnValue({
        events: [
          { type: 'TEXT_MESSAGE_START', timestamp: 1000, messageId: 'log-msg-1', role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', timestamp: 1000, messageId: 'log-msg-1', delta: 'Logs message' },
          { type: 'TEXT_MESSAGE_END', timestamp: 1000, messageId: 'log-msg-1' },
        ],
        loading: false,
        error: null,
        metadata: { lineCount: 3, byteSize: 100, createdAt: '', updatedAt: '' },
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should show logs data (not SSE data) once logs are loaded
      expect(screen.getByText('Logs message')).toBeInTheDocument()
      expect(screen.queryByText('SSE message')).not.toBeInTheDocument()
    })
  })

  describe('Agent-Specific Rendering', () => {
    it('should use ClaudeCodeTrajectory for claude-code agent type', () => {
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Let me think about this problem...',
        complete: true,
        timestamp: 1000,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      const { container } = render(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'running', agent_type: 'claude-code' } as any}
        />
      )

      // ClaudeCodeTrajectory should render with terminal-style dots
      expect(container.textContent).toContain('⏺')
      expect(screen.getByText(/Let me think/)).toBeInTheDocument()
    })

    it('should use AgentTrajectory for non-claude-code agent types', () => {
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Let me think about this problem...',
        complete: true,
        timestamp: 1000,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{ status: 'running', agent_type: 'codex' } as any}
        />
      )

      // AgentTrajectory should show standard "assistant" badge (not "thinking")
      expect(screen.getByText('assistant')).toBeInTheDocument()
      expect(screen.queryByText('thinking')).not.toBeInTheDocument()
    })

    it('should use AgentTrajectory when agent_type is not specified', () => {
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Test message',
        complete: true,
        timestamp: 1000,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'running' } as any} />
      )

      // Should default to AgentTrajectory (standard rendering)
      expect(screen.getByText('assistant')).toBeInTheDocument()
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })
  })

  describe('TodoTracker Integration', () => {
    it('should display TodoTracker when there are todo tool calls', () => {
      const toolCalls = new Map()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'TodoWrite',
        args: JSON.stringify({
          todos: [
            { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
            { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
          ],
        }),
        status: 'completed',
        result: 'Updated',
        startTime: 1000,
        endTime: 1100,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls,
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
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

    it('should not display TodoTracker when there are no todo tool calls', () => {
      const toolCalls = new Map()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Bash',
        args: JSON.stringify({ command: 'npm test' }),
        status: 'completed',
        result: 'Tests passed',
        startTime: 1000,
        endTime: 2000,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls,
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
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
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Test message',
        complete: true,
        timestamp: 1000,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'completed',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      render(
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
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Test message',
        complete: true,
        timestamp: 1000,
        index: 0,
      })

      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'completed',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        },
        messages,
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: false,
      })

      render(
        <ExecutionMonitor executionId="test-exec-1" execution={{ status: 'completed' } as any} />
      )

      // Should have card wrapper with "Execution Monitor" header
      expect(screen.getByText('Execution Monitor')).toBeInTheDocument()
      // Should still display content
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    it('should display user prompt in compact mode when prompt is provided', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{
            status: 'running',
            prompt: 'Please implement the login feature',
          } as any}
          compact
        />
      )

      // Should display the user prompt
      expect(screen.getByText('Please implement the login feature')).toBeInTheDocument()
    })

    it('should display follow-up prompt in compact mode', () => {
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
        <ExecutionMonitor
          executionId="test-exec-2"
          execution={{
            status: 'running',
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
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      render(
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
      mockUseAgUiStream.mockReturnValue({
        connectionStatus: 'connected',
        execution: {
          runId: 'run-123',
          threadId: 'thread-456',
          status: 'running',
          currentStep: null,
          error: null,
          startTime: Date.now(),
          endTime: null,
        },
        messages: new Map(),
        toolCalls: new Map(),
        state: {},
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      const multilinePrompt = 'Please:\n1. Add tests\n2. Update docs\n3. Fix bugs'

      const { container } = render(
        <ExecutionMonitor
          executionId="test-exec-1"
          execution={{
            status: 'running',
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
})
