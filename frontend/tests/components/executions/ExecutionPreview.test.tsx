import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionPreview } from '@/components/executions/ExecutionPreview'
import type { Execution } from '@/types/execution'
import type { AgentMessage, ToolCall } from '@/hooks/useSessionUpdateStream'

// Mock useSessionUpdateStream hook
const mockUseSessionUpdateStream = vi.fn()
vi.mock('@/hooks/useSessionUpdateStream', () => ({
  useSessionUpdateStream: (props: { executionId: string | null }) =>
    mockUseSessionUpdateStream(props),
}))

vi.mock('@/hooks/useExecutionLogs', () => ({
  useExecutionLogs: vi.fn(() => ({
    events: [
      {
        type: 'TEXT_MESSAGE_CONTENT',
        value: { content: 'Execution completed successfully' },
        timestamp: Date.now(),
      },
      {
        type: 'TOOL_CALL_START',
        value: { toolCallId: 'tool-1', name: 'Read' },
        timestamp: Date.now() - 10000,
      },
      {
        type: 'TOOL_CALL_RESULT',
        value: { toolCallId: 'tool-1', result: 'File contents...' },
        timestamp: Date.now() - 8000,
      },
    ],
    loading: false,
    error: null,
    metadata: {},
  })),
}))

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
  title: 'Edit',
  rawInput: '{}',
  status: 'success',
  timestamp: new Date(),
  index: 0,
  ...partial,
})

describe('ExecutionPreview', () => {
  const mockExecution: Execution = {
    id: 'exec-123',
    issue_id: 'issue-1',
    issue_uuid: null,
    status: 'running',
    agent_type: 'claude-code',
    mode: 'autonomous',
    prompt: null,
    config: null,
    session_id: null,
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'test-branch',
    before_commit: null,
    after_commit: null,
    worktree_path: null,
    created_at: new Date(Date.now() - 300000).toISOString(), // 5 min ago
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    exit_code: null,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4-5',
    summary: null,
    files_changed: null,
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
    stream_id: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSessionUpdateStream.mockReturnValue({
      connectionStatus: 'connected',
      execution: {
        runId: 'run-123',
        status: 'running',
        error: null,
        startTime: Date.now() - 5000,
        endTime: null,
      },
      messages: [
        createMessage({
          id: 'msg-1',
          content: 'Starting execution...',
          timestamp: new Date(Date.now() - 5000),
        }),
        createMessage({
          id: 'msg-2',
          content:
            'Analyzing the codebase to find relevant files...\nFound 5 files to process.',
          timestamp: new Date(),
        }),
      ],
      toolCalls: [
        createToolCall({
          id: 'tool-1',
          title: 'Edit',
          rawInput: '{"file": "test.ts"}',
          status: 'success',
          result: 'File edited successfully',
          timestamp: new Date(Date.now() - 5000),
        }),
        createToolCall({
          id: 'tool-2',
          title: 'Bash',
          rawInput: '{"command": "npm test"}',
          status: 'running',
          timestamp: new Date(Date.now() - 2000),
        }),
      ],
      thoughts: [],
      isStreaming: true,
      isConnected: true,
      error: null,
    })
  })

  describe('Compact Variant', () => {
    it('should render compact preview with status badge', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="compact"
        />
      )

      // Should show status
      expect(screen.getByText('Running')).toBeInTheDocument()

      // Should show agent type
      expect(screen.getByText('claude-code')).toBeInTheDocument()

      // Should show timestamp
      expect(screen.getByText(/ago/)).toBeInTheDocument()
    })

    it('should show View button when onViewFull provided', async () => {
      const user = userEvent.setup()
      const onViewFull = vi.fn()

      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="compact"
          onViewFull={onViewFull}
        />
      )

      const viewButton = screen.getByRole('button', { name: /view/i })
      expect(viewButton).toBeInTheDocument()

      await user.click(viewButton)
      expect(onViewFull).toHaveBeenCalledOnce()
    })

    it('should not show View button when onViewFull not provided', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="compact"
        />
      )

      expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument()
    })

    it('should render compact preview without status label when showStatusLabel is false', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="compact"
          showStatusLabel={false}
        />
      )

      // Should NOT show status label text
      expect(screen.queryByText('Running')).not.toBeInTheDocument()

      // Should show agent type
      expect(screen.getByText('claude-code')).toBeInTheDocument()

      // Should show timestamp
      expect(screen.getByText(/ago/)).toBeInTheDocument()
    })
  })

  describe('Standard Variant', () => {
    it('should render standard preview with status and metrics', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
        />
      )

      // Should show status
      expect(screen.getByText('Running')).toBeInTheDocument()

      // Should show agent type badge
      expect(screen.getByText('claude-code')).toBeInTheDocument()

      // Should show metrics
      expect(screen.getByText(/tool calls/)).toBeInTheDocument()
    })

    it('should display tool calls with status icons', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
        />
      )

      // Should show tool call names
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Bash')).toBeInTheDocument()
    })

    it('should display messages with truncation', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          maxMessages={1}
        />
      )

      // Should show last message (msg-2)
      expect(
        screen.getByText(/Analyzing the codebase/)
      ).toBeInTheDocument()

      // Should indicate more messages
      expect(screen.getByText(/\+1 more message/)).toBeInTheDocument()
    })

    it('should truncate long messages to maxLines', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          maxLines={1}
        />
      )

      // Should show first line only
      expect(
        screen.getByText(/Analyzing the codebase/)
      ).toBeInTheDocument()

      // Should show ellipsis
      expect(screen.getByText('...')).toBeInTheDocument()
    })

    it('should show View Full Execution button when onViewFull provided', async () => {
      const user = userEvent.setup()
      const onViewFull = vi.fn()

      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          onViewFull={onViewFull}
        />
      )

      const viewButton = screen.getByRole('button', { name: /view full execution/i })
      expect(viewButton).toBeInTheDocument()

      await user.click(viewButton)
      expect(onViewFull).toHaveBeenCalledOnce()
    })
  })

  describe('Detailed Variant', () => {
    it('should render detailed preview with all information', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="detailed"
        />
      )

      // Should show status
      expect(screen.getByText('Running')).toBeInTheDocument()

      // Should show metrics
      expect(screen.getByText(/tool calls/)).toBeInTheDocument()

      // Should show tool calls with results
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('File edited successfully')).toBeInTheDocument()
    })

    it('should show more messages and tool calls than standard', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="detailed"
        />
      )

      // Should show both messages (maxMessages: 10)
      expect(screen.getByText(/Starting execution/)).toBeInTheDocument()
      expect(
        screen.getByText(/Analyzing the codebase/)
      ).toBeInTheDocument()

      // Should show both tool calls (maxToolCalls: 10)
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Bash')).toBeInTheDocument()
    })
  })

  describe('Status Display', () => {
    it('should show correct status for completed execution', () => {
      const completedExecution: Execution = {
        ...mockExecution,
        status: 'completed',
      }

      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={completedExecution}
          variant="standard"
        />
      )

      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    it('should show correct status for failed execution', () => {
      const failedExecution: Execution = {
        ...mockExecution,
        status: 'failed',
      }

      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={failedExecution}
          variant="standard"
        />
      )

      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('should hide status when showStatus is false', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          showStatus={false}
        />
      )

      expect(screen.queryByText('Running')).not.toBeInTheDocument()
    })
  })


  describe('Custom Overrides', () => {
    it('should respect maxMessages override', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          maxMessages={1}
        />
      )

      // Should show indicator for additional messages
      expect(screen.getByText(/\+1 more message/)).toBeInTheDocument()
    })

    it('should respect maxToolCalls override', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          maxToolCalls={1}
        />
      )

      // Should show indicator for additional tool calls
      expect(screen.getByText(/\+1 more tool call/)).toBeInTheDocument()
    })

    it('should respect maxLines override', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          maxLines={1}
        />
      )

      // Multi-line message should be truncated
      expect(screen.getByText('...')).toBeInTheDocument()
    })
  })

  describe('Metrics Display', () => {
    it('should hide metrics when showMetrics is false', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          showMetrics={false}
        />
      )

      // Metrics should not be visible (check that container doesn't have metrics text)
      expect(screen.queryByText(/tool calls/)).not.toBeInTheDocument()
    })

    it('should show metrics when showMetrics is true', () => {
      renderWithProviders(
        <ExecutionPreview
          executionId="exec-123"
          execution={mockExecution}
          variant="standard"
          showMetrics={true}
        />
      )

      // Metrics should be visible
      expect(screen.getByText(/tool calls/)).toBeInTheDocument()
    })
  })
})
