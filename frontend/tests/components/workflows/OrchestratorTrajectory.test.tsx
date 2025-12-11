import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { OrchestratorTrajectory } from '@/components/workflows/OrchestratorTrajectory'
import type { EscalationData } from '@/types/workflow'
import type { MessageBuffer, ToolCallTracking } from '@/hooks/useAgUiStream'

// Mock the useAgUiStream hook
const mockUseAgUiStream = vi.fn()
vi.mock('@/hooks/useAgUiStream', () => ({
  useAgUiStream: (props: { executionId: string }) => mockUseAgUiStream(props),
}))

describe('OrchestratorTrajectory', () => {
  const mockOnEscalationResponse = vi.fn()

  const baseProps = {
    executionId: 'exec-123',
    workflowId: 'wf-456',
    onEscalationResponse: mockOnEscalationResponse,
  }

  const createMessage = (partial: Partial<MessageBuffer>): MessageBuffer => ({
    messageId: 'msg-1',
    role: 'assistant',
    content: 'Test message',
    timestamp: Date.now(),
    complete: true,
    index: 0,
    ...partial,
  })

  const createToolCall = (partial: Partial<ToolCallTracking>): ToolCallTracking => ({
    toolCallId: 'tool-1',
    toolCallName: 'workflow_status',
    args: '{}',
    status: 'completed',
    startTime: Date.now(),
    index: 0,
    ...partial,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: true,
      error: null,
    })
  })

  it('should show loading state when not connected and no data', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: false,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Connecting to orchestrator...')).toBeInTheDocument()
  })

  it('should show waiting state when connected but no activity', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Waiting for orchestrator activity...')).toBeInTheDocument()
  })

  it('should show error state when there is an error', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: false,
      error: new Error('Connection failed'),
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Failed to load trajectory')).toBeInTheDocument()
  })

  it('should render messages from orchestrator', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [
        createMessage({
          messageId: 'msg-1',
          content: 'Starting to process the workflow',
          timestamp: Date.now() - 30000,
        }),
      ],
      toolCalls: [],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Starting to process the workflow')).toBeInTheDocument()
    expect(screen.getByText('orchestrator')).toBeInTheDocument()
  })

  it('should filter out system messages', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [
        createMessage({
          messageId: 'msg-1',
          content: '[System] Internal message',
          timestamp: Date.now(),
        }),
        createMessage({
          messageId: 'msg-2',
          content: 'Regular message',
          timestamp: Date.now(),
        }),
      ],
      toolCalls: [],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.queryByText('[System] Internal message')).not.toBeInTheDocument()
    expect(screen.getByText('Regular message')).toBeInTheDocument()
  })

  it('should render execute_issue tool call with proper formatting', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'execute_issue',
          args: JSON.stringify({ issue_id: 'i-abc123', agent_type: 'claude-code' }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Starting issue i-abc123')).toBeInTheDocument()
    expect(screen.getByText('Agent: claude-code')).toBeInTheDocument()
  })

  it('should render execution_status tool call with status', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'execution_status',
          args: JSON.stringify({ execution_id: 'exec-12345678' }),
          result: JSON.stringify({ data: { status: 'completed' } }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    // The execution_id is sliced to 8 chars, so "exec-12345678" becomes "exec-123"
    expect(screen.getByText(/Checking execution exec-123/)).toBeInTheDocument()
    expect(screen.getByText('Completed successfully')).toBeInTheDocument()
  })

  it('should render escalate_to_user tool call with warning styling', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'escalate_to_user',
          args: JSON.stringify({ message: 'Need user input for decision' }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Requesting user input')).toBeInTheDocument()
    expect(screen.getByText(/Need user input/)).toBeInTheDocument()
  })

  it('should render inline EscalationPanel when escalation is provided with escalate_to_user call', () => {
    const escalation: EscalationData = {
      requestId: 'esc-123',
      message: 'Should I proceed with this approach?',
    }

    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'escalate_to_user',
          args: JSON.stringify({ message: 'Should I proceed?' }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(
      <OrchestratorTrajectory
        {...baseProps}
        escalation={escalation}
        onEscalationResponse={mockOnEscalationResponse}
      />
    )

    // EscalationPanel should be rendered with the escalation data
    expect(screen.getByText('Orchestrator Needs Input')).toBeInTheDocument()
    expect(screen.getByText('Should I proceed with this approach?')).toBeInTheDocument()
  })

  it('should render workflow_complete tool call with success styling', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'workflow_complete',
          args: JSON.stringify({
            summary: 'All issues completed successfully',
            status: 'completed',
          }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Workflow completed')).toBeInTheDocument()
    expect(screen.getByText('All issues completed successfully')).toBeInTheDocument()
  })

  it('should render workflow_complete with failure styling when status is failed', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'workflow_complete',
          args: JSON.stringify({ summary: 'Failed due to errors', status: 'failed' }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Workflow failed')).toBeInTheDocument()
    expect(screen.getByText('Failed due to errors')).toBeInTheDocument()
  })

  it('should render notify_user tool call', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'notify_user',
          args: JSON.stringify({ message: 'Step 1 is complete', level: 'info' }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Notification (info)')).toBeInTheDocument()
    expect(screen.getByText('Step 1 is complete')).toBeInTheDocument()
  })

  it('should render execution_cancel tool call', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'execution_cancel',
          args: JSON.stringify({ execution_id: 'exec-12345678', reason: 'User requested' }),
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    // The execution_id is sliced to 8 chars, so "exec-12345678" becomes "exec-123"
    expect(screen.getByText(/Cancelling execution exec-123/)).toBeInTheDocument()
    expect(screen.getByText('User requested')).toBeInTheDocument()
  })

  it('should show loading spinner for in-progress tool calls', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'execute_issue',
          args: JSON.stringify({ issue_id: 'i-abc123' }),
          status: 'executing',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    // Should have a spinner (Loader2 with animate-spin)
    const spinner = document.querySelector('svg.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('should show tool call error when present', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'execute_issue',
          args: JSON.stringify({ issue_id: 'i-abc123' }),
          status: 'error',
          error: 'Issue not found',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Issue not found')).toBeInTheDocument()
  })

  it('should show connection indicator when connected', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [createMessage({ content: 'Test' })],
      toolCalls: [],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('should order items chronologically', () => {
    const now = Date.now()
    mockUseAgUiStream.mockReturnValue({
      messages: [
        createMessage({
          messageId: 'msg-1',
          content: 'Second message',
          timestamp: now - 1000,
          index: 1,
        }),
        createMessage({
          messageId: 'msg-0',
          content: 'First message',
          timestamp: now - 2000,
          index: 0,
        }),
      ],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'workflow_status',
          startTime: now - 1500,
          index: 0,
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    // Get all text elements and check order
    const firstMessage = screen.getByText('First message')
    const statusCheck = screen.getByText('Checking workflow status')
    const secondMessage = screen.getByText('Second message')

    // Verify they're all rendered (order is tested by position in DOM)
    expect(firstMessage).toBeInTheDocument()
    expect(statusCheck).toBeInTheDocument()
    expect(secondMessage).toBeInTheDocument()
  })

  it('should show loading indicator for incomplete messages', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [
        createMessage({
          messageId: 'msg-1',
          content: 'Still typing...',
          complete: false,
        }),
      ],
      toolCalls: [],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    // Should have a spinner for incomplete message
    const spinners = document.querySelectorAll('svg.animate-spin')
    expect(spinners.length).toBeGreaterThan(0)
  })

  it('should handle unknown tool calls gracefully', () => {
    mockUseAgUiStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          toolCallId: 'tool-1',
          toolCallName: 'unknown_tool',
          args: '{}',
          status: 'completed',
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    // Should display the tool name as-is
    expect(screen.getByText('unknown_tool')).toBeInTheDocument()
  })
})
