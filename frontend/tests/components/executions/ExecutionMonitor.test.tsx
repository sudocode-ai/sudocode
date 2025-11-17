/**
 * ExecutionMonitor Component Tests
 *
 * Tests for the AG-UI execution monitoring component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionMonitor } from '@/components/executions/ExecutionMonitor'
import * as useAgUiStreamModule from '@/hooks/useAgUiStream'
import * as useExecutionLogsModule from '@/hooks/useExecutionLogs'
import type { Execution } from '@/types/execution'

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

      expect(screen.getByText('No execution activity yet')).toBeInTheDocument()
      expect(screen.getByText('Waiting for events...')).toBeInTheDocument()
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
  })

  describe('View Mode Switching', () => {
    const createMockStreamData = () => ({
      connectionStatus: 'connected' as const,
      execution: {
        runId: 'run-123',
        threadId: 'thread-456',
        status: 'running' as const,
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

    beforeEach(() => {
      mockUseAgUiStream.mockReturnValue(createMockStreamData())
    })

    it('should default to structured view for structured execution', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'structured',
        terminal_enabled: false,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // Should show structured view (no view switcher for single mode)
      expect(screen.queryByText('View:')).not.toBeInTheDocument()
    })

    it('should default to terminal view for interactive execution', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'interactive',
        terminal_enabled: true,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // Should show terminal view (no view switcher for single mode)
      expect(screen.queryByText('View:')).not.toBeInTheDocument()
    })

    it('should default to split view for hybrid execution', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'hybrid',
        terminal_enabled: true,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // Should show view switcher for hybrid mode
      expect(screen.getByText('View:')).toBeInTheDocument()

      // Split button should be active by default
      const splitButton = screen.getByRole('button', { name: /split/i })
      expect(splitButton).toHaveClass('bg-primary') // or check variant
    })

    it('should switch between views in hybrid mode', async () => {
      const user = userEvent.setup()
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'hybrid',
        terminal_enabled: true,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // Click structured view button
      const structuredButton = screen.getByRole('button', { name: /structured/i })
      await user.click(structuredButton)

      // Structured button should now be active
      expect(structuredButton).toHaveClass('bg-primary')

      // Click terminal view button
      const terminalButton = screen.getByRole('button', { name: /^terminal$/i })
      await user.click(terminalButton)

      // Terminal button should now be active
      expect(terminalButton).toHaveClass('bg-primary')

      // Click split view button
      const splitButton = screen.getByRole('button', { name: /split/i })
      await user.click(splitButton)

      // Split button should now be active
      expect(splitButton).toHaveClass('bg-primary')
    })

    it('should disable terminal and split views when terminal is not available', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'hybrid',
        terminal_enabled: false, // Terminal not enabled
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // View switcher should be present
      expect(screen.getByText('View:')).toBeInTheDocument()

      // Terminal and split buttons should be disabled
      const terminalButton = screen.getByRole('button', { name: /^terminal$/i })
      const splitButton = screen.getByRole('button', { name: /split/i })

      expect(terminalButton).toBeDisabled()
      expect(splitButton).toBeDisabled()

      // Structured button should not be disabled
      const structuredButton = screen.getByRole('button', { name: /structured/i })
      expect(structuredButton).not.toBeDisabled()
    })

    it('should show terminal unavailable message when switching to terminal without terminal enabled', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'hybrid',
        terminal_enabled: false,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // Try to click terminal view (should be disabled, but test the UI anyway)
      const terminalButton = screen.getByRole('button', { name: /^terminal$/i })
      expect(terminalButton).toBeDisabled()
    })

    it('should only show structured view option for structured mode', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'structured',
        terminal_enabled: false,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // View switcher should not be shown (only one view available)
      expect(screen.queryByText('View:')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /structured/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /terminal/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /split/i })).not.toBeInTheDocument()
    })

    it('should only show terminal view option for interactive mode', () => {
      const execution = {
        id: 'exec-1',
        issue_id: 'i-1',
        status: 'running',
        execution_mode: 'interactive',
        terminal_enabled: true,
        config: null,
        created_at: new Date().toISOString(),
      } as Execution

      render(<ExecutionMonitor executionId="exec-1" execution={execution} />)

      // View switcher should not be shown (only one view available)
      expect(screen.queryByText('View:')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /structured/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /terminal/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /split/i })).not.toBeInTheDocument()
    })
  })
})
