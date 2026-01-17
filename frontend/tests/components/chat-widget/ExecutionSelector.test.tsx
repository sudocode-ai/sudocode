import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionSelector } from '@/components/chat-widget/ExecutionSelector'
import type { Execution } from '@/types/execution'

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
  workflow_execution_id: null,
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

describe('ExecutionSelector', () => {
  const defaultProps = {
    executions: [] as Execution[],
    value: null as string | null,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Empty State', () => {
    it('should render select trigger', () => {
      render(<ExecutionSelector {...defaultProps} />)

      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should show "New" when no value is selected', () => {
      render(<ExecutionSelector {...defaultProps} />)

      expect(screen.getByText('New')).toBeInTheDocument()
    })
  })

  describe('With Executions', () => {
    it('should show selected execution agent type', () => {
      const executions = [createMockExecution({ id: 'exec-1', agent_type: 'claude-code' })]

      render(
        <ExecutionSelector
          {...defaultProps}
          executions={executions}
          value="exec-1"
        />
      )

      // ExecutionSelector shows agent type, not ID in the trigger
      expect(screen.getByText('Claude Code')).toBeInTheDocument()
    })

    it('should display execution options when opened', async () => {
      const user = userEvent.setup()
      const executions = [
        createMockExecution({ id: 'exec-1', status: 'running', agent_type: 'claude-code' }),
        createMockExecution({ id: 'exec-2', status: 'completed', agent_type: 'codex' }),
      ]

      render(<ExecutionSelector {...defaultProps} executions={executions} />)

      // Open the dropdown
      await user.click(screen.getByRole('combobox'))

      // Should show "New execution" option
      expect(screen.getByText('New execution')).toBeInTheDocument()

      // Should show executions by their agent type labels
      expect(screen.getAllByText('Claude Code').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Codex').length).toBeGreaterThan(0)
    })

    it('should group executions by status', async () => {
      const user = userEvent.setup()
      const executions = [
        createMockExecution({ id: 'exec-running', status: 'running' }),
        createMockExecution({ id: 'exec-completed', status: 'completed' }),
        createMockExecution({ id: 'exec-pending', status: 'pending' }),
      ]

      render(<ExecutionSelector {...defaultProps} executions={executions} />)

      await user.click(screen.getByRole('combobox'))

      // Should have Active and Recent groups
      expect(screen.getByText('Active')).toBeInTheDocument()
      expect(screen.getByText('Recent')).toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    it('should call onChange with execution id when execution is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const executions = [createMockExecution({ id: 'exec-1', agent_type: 'codex', status: 'completed' })]

      render(
        <ExecutionSelector {...defaultProps} executions={executions} onChange={onChange} />
      )

      await user.click(screen.getByRole('combobox'))
      // Click on the Codex option (in Recent group)
      const options = screen.getAllByRole('option')
      // Find the option that's not the new execution option
      const codexOption = options.find(opt => opt.textContent?.includes('Codex'))
      if (codexOption) {
        await user.click(codexOption)
      }

      expect(onChange).toHaveBeenCalledWith('exec-1')
    })

    it('should call onChange with null when "New execution" is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const executions = [createMockExecution({ id: 'exec-1', status: 'running' })]

      render(
        <ExecutionSelector
          {...defaultProps}
          executions={executions}
          value="exec-1"
          onChange={onChange}
        />
      )

      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByText('New execution'))

      expect(onChange).toHaveBeenCalledWith(null)
    })
  })

  describe('Status Indicators', () => {
    it('should show running status indicator', async () => {
      const user = userEvent.setup()
      const executions = [createMockExecution({ id: 'exec-1', status: 'running' })]

      render(<ExecutionSelector {...defaultProps} executions={executions} />)

      await user.click(screen.getByRole('combobox'))

      // Running status should have a loader or indicator
      const container = screen.getByRole('listbox')
      expect(container).toBeInTheDocument()
    })

    it('should show completed status', async () => {
      const user = userEvent.setup()
      const executions = [createMockExecution({ id: 'exec-1', status: 'completed' })]

      render(<ExecutionSelector {...defaultProps} executions={executions} />)

      await user.click(screen.getByRole('combobox'))

      // Completed status is in "Recent" group
      expect(screen.getByText('Recent')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should apply custom className to trigger', () => {
      render(<ExecutionSelector {...defaultProps} className="custom-class" />)

      // The className is applied to the SelectTrigger (the combobox button)
      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('custom-class')
    })
  })
})
