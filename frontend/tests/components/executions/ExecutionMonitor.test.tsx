/**
 * ExecutionMonitor Component Tests
 *
 * Tests for the AG-UI execution monitoring component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ExecutionMonitor } from '@/components/executions/ExecutionMonitor'
import * as useAgUiStreamModule from '@/hooks/useAgUiStream'

// Mock the useAgUiStream hook
const mockUseAgUiStream = vi.spyOn(useAgUiStreamModule, 'useAgUiStream')

describe('ExecutionMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

      expect(screen.getByText('Messages')).toBeInTheDocument()
      expect(screen.getByText('assistant')).toBeInTheDocument()
      expect(screen.getByText('Hello, this is a test message!')).toBeInTheDocument()
    })

    it('should show spinner for incomplete messages', () => {
      const messages = new Map()
      messages.set('msg-1', {
        messageId: 'msg-1',
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

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
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

      const { rerender } = render(
        <ExecutionMonitor executionId="test-exec-1" onError={onError} />
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
})
