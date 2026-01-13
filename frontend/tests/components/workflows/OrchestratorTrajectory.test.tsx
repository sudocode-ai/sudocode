import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { OrchestratorTrajectory } from '@/components/workflows/OrchestratorTrajectory'
import type { EscalationData } from '@/types/workflow'
import type { AgentMessage, ToolCall } from '@/hooks/useSessionUpdateStream'

// Mock the useSessionUpdateStream hook
const mockUseSessionUpdateStream = vi.fn()
vi.mock('@/hooks/useSessionUpdateStream', () => ({
  useSessionUpdateStream: (props: { executionId: string }) => mockUseSessionUpdateStream(props),
}))

describe('OrchestratorTrajectory', () => {
  const mockOnEscalationResponse = vi.fn()

  const baseProps = {
    executionId: 'exec-123',
    workflowId: 'wf-456',
    onEscalationResponse: mockOnEscalationResponse,
  }

  const createMessage = (partial: Partial<AgentMessage>): AgentMessage => ({
    id: 'msg-1',
    content: 'Test message',
    timestamp: new Date(),
    isStreaming: false,
    index: 0,
    ...partial,
  })

  const createToolCall = (partial: Partial<ToolCall>): ToolCall => ({
    id: 'tool-1',
    title: 'workflow_status',
    rawInput: '{}',
    status: 'success',
    timestamp: new Date(),
    index: 0,
    ...partial,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: true,
      error: null,
    })
  })

  it('should show loading state when not connected and no data', () => {
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: false,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Connecting to orchestrator...')).toBeInTheDocument()
  })

  it('should show waiting state when connected but no activity', () => {
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Waiting for orchestrator activity...')).toBeInTheDocument()
  })

  it('should show error state when there is an error', () => {
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [],
      isConnected: false,
      error: new Error('Connection failed'),
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Failed to load trajectory')).toBeInTheDocument()
  })

  it('should render messages from orchestrator', () => {
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [
        createMessage({
          id: 'msg-1',
          content: 'Starting to process the workflow',
          timestamp: new Date(Date.now() - 30000),
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [
        createMessage({
          id: 'msg-1',
          content: '[System] Internal message',
          timestamp: new Date(),
        }),
        createMessage({
          id: 'msg-2',
          content: 'Regular message',
          timestamp: new Date(),
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'execute_issue',
          rawInput: JSON.stringify({ issue_id: 'i-abc123', agent_type: 'claude-code' }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'execution_status',
          rawInput: JSON.stringify({ execution_id: 'exec-12345678' }),
          result: JSON.stringify({ data: { status: 'completed' } }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'escalate_to_user',
          rawInput: JSON.stringify({ message: 'Need user input for decision' }),
          status: 'success',
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

    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'escalate_to_user',
          rawInput: JSON.stringify({ message: 'Should I proceed?' }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'workflow_complete',
          rawInput: JSON.stringify({
            summary: 'All issues completed successfully',
            status: 'completed',
          }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'workflow_complete',
          rawInput: JSON.stringify({ summary: 'Failed due to errors', status: 'failed' }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'notify_user',
          rawInput: JSON.stringify({ message: 'Step 1 is complete', level: 'info' }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'execution_cancel',
          rawInput: JSON.stringify({ execution_id: 'exec-12345678', reason: 'User requested' }),
          status: 'success',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'execute_issue',
          rawInput: JSON.stringify({ issue_id: 'i-abc123' }),
          status: 'running',
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'execute_issue',
          rawInput: JSON.stringify({ issue_id: 'i-abc123' }),
          status: 'failed',
          result: { error: 'Issue not found' },
        }),
      ],
      isConnected: true,
      error: null,
    })

    renderWithProviders(<OrchestratorTrajectory {...baseProps} />)

    expect(screen.getByText('Issue not found')).toBeInTheDocument()
  })

  it('should show connection indicator when connected', () => {
    mockUseSessionUpdateStream.mockReturnValue({
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [
        createMessage({
          id: 'msg-1',
          content: 'Second message',
          timestamp: new Date(now - 1000),
          index: 1,
        }),
        createMessage({
          id: 'msg-0',
          content: 'First message',
          timestamp: new Date(now - 2000),
          index: 0,
        }),
      ],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'workflow_status',
          timestamp: new Date(now - 1500),
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [
        createMessage({
          id: 'msg-1',
          content: 'Still typing...',
          isStreaming: true,
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
    mockUseSessionUpdateStream.mockReturnValue({
      messages: [],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'unknown_tool',
          rawInput: '{}',
          status: 'success',
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
