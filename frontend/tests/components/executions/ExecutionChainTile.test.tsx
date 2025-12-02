import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { ExecutionChainTile } from '@/components/executions/ExecutionChainTile'
import { executionsApi } from '@/lib/api'
import type { Execution } from '@/types/execution'

// Mock WebSocket context
const mockSubscribe = vi.fn()
const mockUnsubscribe = vi.fn()
const mockAddMessageHandler = vi.fn()
const mockRemoveMessageHandler = vi.fn()

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: true,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    addMessageHandler: mockAddMessageHandler,
    removeMessageHandler: mockRemoveMessageHandler,
  }),
}))

// Mock API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  executionsApi: {
    getChain: vi.fn(),
    createFollowUp: vi.fn(),
    getChanges: vi.fn(),
  },
}))

// Mock child components
vi.mock('@/components/executions/ExecutionMonitor', () => ({
  ExecutionMonitor: ({ executionId, execution, onToolCallsUpdate }: any) => {
    // Simulate tool calls update if the execution has mockToolCalls
    if (onToolCallsUpdate && execution?.mockToolCalls) {
      setTimeout(() => onToolCallsUpdate(execution.mockToolCalls), 0)
    }
    return (
      <div data-testid={`execution-monitor-${executionId}`}>
        <div>ExecutionMonitor for {executionId}</div>
        <div>Status: {execution?.status}</div>
      </div>
    )
  },
  RunIndicator: () => <div data-testid="run-indicator">Running...</div>,
}))

vi.mock('@/components/executions/AgentConfigPanel', () => ({
  AgentConfigPanel: ({ onStart, isFollowUp, disabled }: any) =>
    isFollowUp ? (
      <div data-testid="agent-config-panel">
        <button
          onClick={() => onStart({}, 'Test feedback', 'claude-code')}
          disabled={disabled}
        >
          Send Follow-up
        </button>
      </div>
    ) : null,
}))

vi.mock('@/components/executions/TodoTracker', () => ({
  TodoTracker: ({ todos }: any) => (
    <div data-testid="todo-tracker">
      <div>TodoTracker with {todos?.length || 0} todos</div>
    </div>
  ),
}))

vi.mock('@/components/executions/CodeChangesPanel', () => ({
  CodeChangesPanel: ({ executionId, executionStatus }: any) => (
    <div data-testid="code-changes-panel">
      <div>CodeChangesPanel for {executionId}</div>
      <div>Status: {executionStatus}</div>
    </div>
  ),
}))

vi.mock('@/components/entities/EntityBadge', () => ({
  EntityBadge: ({ entityId, entityType }: { entityId: string; entityType: string }) => (
    <div data-testid="entity-badge" data-entity-id={entityId} data-entity-type={entityType}>
      {entityId}
    </div>
  ),
}))

vi.mock('@/utils/todoExtractor', () => ({
  buildTodoHistory: vi.fn(() => []),
}))

// Helper to create mock execution
const createMockExecution = (overrides: Partial<Execution> = {}): Execution => ({
  id: 'exec-123',
  issue_id: 'i-abc',
  issue_uuid: 'uuid-abc',
  mode: 'worktree',
  prompt: 'Test prompt',
  config: null,
  agent_type: 'claude-code',
  session_id: 'session-123',
  workflow_execution_id: 'workflow-123',
  target_branch: 'main',
  branch_name: 'sudocode/exec-123',
  before_commit: 'commit-before',
  after_commit: 'commit-after',
  worktree_path: '/path/to/worktree',
  status: 'running',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: null,
  cancelled_at: null,
  exit_code: null,
  error_message: null,
  error: null,
  model: 'claude-sonnet-4',
  summary: null,
  files_changed: null,
  parent_execution_id: null,
  step_type: null,
  step_index: null,
  step_config: null,
  ...overrides,
})

// Helper to render with router
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('ExecutionChainTile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Loading State', () => {
    it('shows loading spinner while fetching chain data', async () => {
      // Delay the API response
      vi.mocked(executionsApi.getChain).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rootId: 'exec-123', executions: [] }), 100))
      )

      const { container } = renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      // Should show loading spinner (Loader2 component with animate-spin class)
      expect(container.querySelector('.animate-spin')).toBeTruthy()
    })
  })

  describe('Basic Rendering', () => {
    it('renders execution chain with single execution', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', status: 'running' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-123')).toBeInTheDocument()
      })
    })

    it('renders execution chain with multiple executions (follow-ups)', async () => {
      const executions = [
        createMockExecution({ id: 'exec-1', status: 'completed' }),
        createMockExecution({ id: 'exec-2', status: 'completed', parent_execution_id: 'exec-1' }),
        createMockExecution({ id: 'exec-3', status: 'running', parent_execution_id: 'exec-2' }),
      ]
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-1',
        executions,
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-1" />)

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-1')).toBeInTheDocument()
        expect(screen.getByTestId('execution-monitor-exec-2')).toBeInTheDocument()
        expect(screen.getByTestId('execution-monitor-exec-3')).toBeInTheDocument()
      })
    })

    it('renders issue badge when issue_id is present', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', issue_id: 'i-test-issue' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('entity-badge')).toBeInTheDocument()
        expect(screen.getByText('i-test-issue')).toBeInTheDocument()
      })
    })

    it('renders link to execution detail page', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        const link = screen.getByRole('link', { name: /exec-123/i })
        expect(link).toHaveAttribute('href', '/executions/exec-123')
      })
    })
  })

  describe('WebSocket Subscription', () => {
    it('subscribes to execution events on mount', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalledWith('execution')
      })
    })

    it('registers message handler with unique ID', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(mockAddMessageHandler).toHaveBeenCalledWith(
          'ExecutionChainTile-exec-123',
          expect.any(Function)
        )
      })
    })

    it('removes message handler on unmount', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      const { unmount } = renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(mockAddMessageHandler).toHaveBeenCalled()
      })

      unmount()

      expect(mockRemoveMessageHandler).toHaveBeenCalledWith('ExecutionChainTile-exec-123')
    })

    it('reloads chain when receiving execution_updated message for chain execution', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', status: 'running' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(mockAddMessageHandler).toHaveBeenCalled()
      })

      // Get the message handler that was registered
      const handlerCall = mockAddMessageHandler.mock.calls.find(
        (call) => call[0] === 'ExecutionChainTile-exec-123'
      )
      expect(handlerCall).toBeDefined()
      const messageHandler = handlerCall![1]

      // Clear previous calls to getChain
      vi.mocked(executionsApi.getChain).mockClear()

      // Simulate receiving an execution_updated message
      const updatedExecution = createMockExecution({ id: 'exec-123', status: 'completed' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [updatedExecution],
      })

      messageHandler({
        type: 'execution_updated',
        data: { id: 'exec-123', status: 'completed' },
      })

      await waitFor(() => {
        expect(executionsApi.getChain).toHaveBeenCalledWith('exec-123')
      })
    })

    it('reloads chain when receiving execution_created message for new follow-up', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', status: 'completed' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(mockAddMessageHandler).toHaveBeenCalled()
      })

      const handlerCall = mockAddMessageHandler.mock.calls.find(
        (call) => call[0] === 'ExecutionChainTile-exec-123'
      )
      const messageHandler = handlerCall![1]

      vi.mocked(executionsApi.getChain).mockClear()

      // Simulate receiving a new follow-up execution
      const newFollowUp = createMockExecution({
        id: 'exec-456',
        parent_execution_id: 'exec-123',
        status: 'running',
      })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution, newFollowUp],
      })

      messageHandler({
        type: 'execution_created',
        data: newFollowUp,
      })

      await waitFor(() => {
        expect(executionsApi.getChain).toHaveBeenCalledWith('exec-123')
      })
    })

    it('ignores messages for executions not in the chain', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(mockAddMessageHandler).toHaveBeenCalled()
      })

      const handlerCall = mockAddMessageHandler.mock.calls.find(
        (call) => call[0] === 'ExecutionChainTile-exec-123'
      )
      const messageHandler = handlerCall![1]

      vi.mocked(executionsApi.getChain).mockClear()

      // Simulate receiving a message for a different execution
      messageHandler({
        type: 'execution_updated',
        data: { id: 'exec-999', status: 'completed' },
      })

      // Should not reload chain for unrelated execution
      expect(executionsApi.getChain).not.toHaveBeenCalled()
    })
  })

  describe('CodeChangesPanel', () => {
    it('renders CodeChangesPanel when before_commit or after_commit exists', async () => {
      const mockExecution = createMockExecution({
        id: 'exec-123',
        before_commit: 'abc123',
        after_commit: 'def456',
      })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('code-changes-panel')).toBeInTheDocument()
      })
    })

    it('does not render CodeChangesPanel when no commits exist', async () => {
      const mockExecution = createMockExecution({
        id: 'exec-123',
        before_commit: null,
        after_commit: null,
      })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-123')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('code-changes-panel')).not.toBeInTheDocument()
    })
  })

  describe('RunIndicator', () => {
    it('shows RunIndicator when any execution is running', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', status: 'running' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('run-indicator')).toBeInTheDocument()
      })
    })

    it('does not show RunIndicator when all executions are completed', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', status: 'completed' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-123')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('run-indicator')).not.toBeInTheDocument()
    })
  })

  describe('AgentConfigPanel', () => {
    it('renders AgentConfigPanel for follow-ups', async () => {
      const mockExecution = createMockExecution({ id: 'exec-123', issue_id: 'i-test' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      renderWithRouter(<ExecutionChainTile executionId="exec-123" />)

      await waitFor(() => {
        expect(screen.getByTestId('agent-config-panel')).toBeInTheDocument()
      })
    })
  })

  describe('Hide Button', () => {
    it('calls onToggleVisibility when hide button is clicked', async () => {
      const mockOnToggleVisibility = vi.fn()
      const mockExecution = createMockExecution({ id: 'exec-123' })
      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-123',
        executions: [mockExecution],
      })

      const { container } = renderWithRouter(
        <ExecutionChainTile executionId="exec-123" onToggleVisibility={mockOnToggleVisibility} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-123')).toBeInTheDocument()
      })

      // Find the hide button in the header (the one with X icon, not the follow-up button)
      // It's the button with h-7 w-7 classes in the sticky header
      const hideButton = container.querySelector('.sticky button')
      expect(hideButton).toBeTruthy()
      if (hideButton) {
        hideButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(mockOnToggleVisibility).toHaveBeenCalledWith('exec-123')
      }
    })
  })
})
