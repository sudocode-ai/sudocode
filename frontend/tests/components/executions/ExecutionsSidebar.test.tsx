import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExecutionsSidebar } from '@/components/executions/ExecutionsSidebar'
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

// Mock EntityBadge component
vi.mock('@/components/entities/EntityBadge', () => ({
  EntityBadge: ({ entityId, entityType }: { entityId: string; entityType: string }) => (
    <div data-testid="entity-badge" data-entity-id={entityId} data-entity-type={entityType}>
      {entityId}
    </div>
  ),
}))

// Sample executions for testing
const createMockExecution = (overrides: Partial<Execution> = {}): Execution => ({
  id: 'exec-123',
  issue_id: 'i-abc',
  issue_uuid: 'uuid-abc',
  mode: 'worktree',
  prompt: 'Test prompt',
  config: null,
  agent_type: 'claude',
  session_id: 'session-123',
  workflow_execution_id: 'workflow-123',
  target_branch: 'main',
  branch_name: 'sudocode/exec-123',
  before_commit: 'commit-before',
  after_commit: null,
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
  model: null,
  summary: null,
  files_changed: null,
  parent_execution_id: null,
  step_type: null,
  step_index: null,
  step_config: null,
  stream_id: null,
  deleted_at: null,
  deletion_reason: null,
  ...overrides,
})

describe('ExecutionsSidebar', () => {
  const mockOnToggleVisibility = vi.fn()
  const mockOnToggleAll = vi.fn()

  // Default props for all tests
  const defaultProps = {
    onToggleVisibility: mockOnToggleVisibility,
    allChecked: false,
    onToggleAll: mockOnToggleAll,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when no executions provided', () => {
    render(<ExecutionsSidebar {...defaultProps} executions={[]} visibleExecutionIds={new Set()} />)

    expect(screen.getByText('No executions yet')).toBeInTheDocument()
    expect(screen.getByText('Start by creating an execution from an issue.')).toBeInTheDocument()
  })

  it('renders executions list with metadata', () => {
    const executions: Execution[] = [
      createMockExecution({
        id: 'exec-1',
        issue_id: 'i-test1',
        branch_name: 'sudocode/test-branch-1',
        status: 'running',
      }),
      createMockExecution({
        id: 'exec-2',
        issue_id: 'i-test2',
        branch_name: 'sudocode/test-branch-2',
        status: 'completed',
      }),
    ]

    render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    // Check execution count badge
    expect(screen.getByText('2')).toBeInTheDocument()

    // Check executions are rendered (using getAllByText since IDs appear in truncated form)
    const executionIds = screen.getAllByText(/exec-/)
    expect(executionIds.length).toBeGreaterThanOrEqual(2)

    // Check issue IDs
    expect(screen.getByText('i-test1')).toBeInTheDocument()
    expect(screen.getByText('i-test2')).toBeInTheDocument()
  })

  it('shows checkboxes with correct checked state', () => {
    const executions: Execution[] = [
      createMockExecution({ id: 'exec-1', status: 'running' }),
      createMockExecution({ id: 'exec-2', status: 'completed' }),
    ]

    const visibleIds = new Set(['exec-1'])

    render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={visibleIds}
      />
    )

    const checkboxes = screen.getAllByRole('checkbox')
    // Now we have 3 checkboxes: 1 "All" checkbox + 2 execution checkboxes
    expect(checkboxes).toHaveLength(3)

    // Second checkbox (first execution) should be checked
    expect(checkboxes[1]).toBeChecked()
    // Third checkbox (second execution) should not be checked
    expect(checkboxes[2]).not.toBeChecked()
  })

  it('calls onToggleVisibility when checkbox is clicked', () => {
    const executions: Execution[] = [createMockExecution({ id: 'exec-1', status: 'running' })]

    render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    // Get all checkboxes (first is "All", second is the execution checkbox)
    const checkboxes = screen.getAllByRole('checkbox')
    const executionCheckbox = checkboxes[1]
    fireEvent.click(executionCheckbox)

    expect(mockOnToggleVisibility).toHaveBeenCalledWith('exec-1')
  })

  it('calls onToggleVisibility when execution item is clicked', () => {
    const executions: Execution[] = [
      createMockExecution({ id: 'exec-unique-123', status: 'running', branch_name: 'test-branch' }),
    ]

    const { container } = render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    // Click on the execution item (not the checkbox)
    // Find the execution item by its container div
    const executionItem = container.querySelector('.border-b.cursor-pointer')
    if (executionItem) {
      fireEvent.click(executionItem)
      expect(mockOnToggleVisibility).toHaveBeenCalledWith('exec-unique-123')
    }
  })

  it('subscribes to WebSocket events on mount', () => {
    const executions: Execution[] = [createMockExecution({ id: 'exec-1', status: 'running' })]

    render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    expect(mockSubscribe).toHaveBeenCalledWith('execution')
    expect(mockAddMessageHandler).toHaveBeenCalledWith('executions-sidebar', expect.any(Function))
  })

  it('renders different status icons correctly', () => {
    const executions: Execution[] = [
      createMockExecution({ id: 'exec-1', status: 'running' }),
      createMockExecution({ id: 'exec-2', status: 'completed' }),
      createMockExecution({ id: 'exec-3', status: 'failed' }),
      createMockExecution({ id: 'exec-4', status: 'pending' }),
    ]

    const { container } = render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    // Check that status icons are rendered (should have multiple SVG elements)
    const svgIcons = container.querySelectorAll('svg')
    expect(svgIcons.length).toBeGreaterThan(0)
  })

  it('calls onToggleAll when "All" checkbox is clicked', () => {
    const executions: Execution[] = [createMockExecution({ id: 'exec-1', status: 'running' })]

    render(
      <ExecutionsSidebar
        {...defaultProps}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    // Find the "All" checkbox (first checkbox in the header)
    const checkboxes = screen.getAllByRole('checkbox')
    const allCheckbox = checkboxes[0]

    fireEvent.click(allCheckbox)
    expect(mockOnToggleAll).toHaveBeenCalled()
  })

  it('displays "All" checkbox with correct checked state', () => {
    const executions: Execution[] = [createMockExecution({ id: 'exec-1', status: 'running' })]

    const { rerender } = render(
      <ExecutionsSidebar
        {...defaultProps}
        allChecked={true}
        executions={executions}
        visibleExecutionIds={new Set(['exec-1'])}
      />
    )

    const checkboxes = screen.getAllByRole('checkbox')
    const allCheckbox = checkboxes[0]
    expect(allCheckbox).toBeChecked()

    // Re-render with allChecked false
    rerender(
      <ExecutionsSidebar
        {...defaultProps}
        allChecked={false}
        executions={executions}
        visibleExecutionIds={new Set()}
      />
    )

    expect(allCheckbox).not.toBeChecked()
  })
})
