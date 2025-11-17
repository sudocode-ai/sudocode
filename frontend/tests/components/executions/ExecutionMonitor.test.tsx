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
import * as CRDTContextModule from '@/contexts/CRDTContext'

// Mock the hooks
const mockUseAgUiStream = vi.spyOn(useAgUiStreamModule, 'useAgUiStream')
const mockUseExecutionLogs = vi.spyOn(useExecutionLogsModule, 'useExecutionLogs')
const mockUseExecution = vi.spyOn(CRDTContextModule, 'useCRDTExecution')
const mockUseAgent = vi.spyOn(CRDTContextModule, 'useCRDTAgent')

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

    // Default mock for CRDT hooks (no CRDT state by default)
    mockUseExecution.mockReturnValue(undefined)
    mockUseAgent.mockReturnValue(undefined)
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

  describe('CRDT Integration', () => {
    it('should display CRDT execution phase', () => {
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

      mockUseExecution.mockReturnValue({
        id: 'test-exec-1',
        issueId: 'i-test',
        status: 'running',
        phase: 'Research and planning',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        agentId: 'test-agent',
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Phase:')).toBeInTheDocument()
      expect(screen.getByText('Research and planning')).toBeInTheDocument()
    })

    it('should display CRDT execution progress', () => {
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

      mockUseExecution.mockReturnValue({
        id: 'test-exec-1',
        issueId: 'i-test',
        status: 'running',
        progress: {
          current: 3,
          total: 10,
          message: 'Analyzing code',
        },
        startedAt: Date.now(),
        updatedAt: Date.now(),
        agentId: 'test-agent',
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Analyzing code')).toBeInTheDocument()
      expect(screen.getByText('3 / 10')).toBeInTheDocument()
    })

    it('should display agent status and heartbeat', () => {
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

      mockUseExecution.mockReturnValue({
        id: 'test-exec-1',
        issueId: 'i-test',
        status: 'running',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        agentId: 'test-agent',
      })

      const lastHeartbeat = Date.now() - 5000 // 5 seconds ago
      mockUseAgent.mockReturnValue({
        id: 'test-agent',
        status: 'working',
        lastHeartbeat,
        connectedAt: Date.now() - 60000,
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Agent:')).toBeInTheDocument()
      expect(screen.getByText('working')).toBeInTheDocument()
      expect(screen.getByText(/last heartbeat:/)).toBeInTheDocument()
    })

    it('should prefer CRDT progress over SSE state progress', () => {
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
          // SSE state has progress, but CRDT should take precedence
          progress: 50,
          totalSteps: 100,
        },
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      mockUseExecution.mockReturnValue({
        id: 'test-exec-1',
        issueId: 'i-test',
        status: 'running',
        progress: {
          current: 7,
          total: 10,
          message: 'CRDT progress',
        },
        startedAt: Date.now(),
        updatedAt: Date.now(),
        agentId: 'test-agent',
      })

      render(<ExecutionMonitor executionId="test-exec-1" />)

      // Should show CRDT progress, not SSE progress
      expect(screen.getByText('CRDT progress')).toBeInTheDocument()
      expect(screen.getByText('7 / 10')).toBeInTheDocument()
      // Should not show SSE progress
      expect(screen.queryByText('50 / 100')).not.toBeInTheDocument()
    })

    it('should fallback to SSE progress when no CRDT progress', () => {
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
          progress: 25,
          totalSteps: 50,
        },
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        isConnected: true,
      })

      // No CRDT execution state
      mockUseExecution.mockReturnValue(undefined)

      render(<ExecutionMonitor executionId="test-exec-1" />)

      // Should show SSE progress
      expect(screen.getByText('Progress')).toBeInTheDocument()
      expect(screen.getByText('25 / 50')).toBeInTheDocument()
    })

    it('should handle missing CRDT data gracefully', () => {
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

      // No CRDT state
      mockUseExecution.mockReturnValue(undefined)
      mockUseAgent.mockReturnValue(undefined)

      // Should render without errors
      render(<ExecutionMonitor executionId="test-exec-1" />)

      expect(screen.getByText('Execution Monitor')).toBeInTheDocument()
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
  })
})
