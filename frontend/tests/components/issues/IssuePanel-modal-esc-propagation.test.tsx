/**
 * Tests for ESC key modal propagation bug in IssuePanel
 *
 * These tests verify the correct behavior of ESC key handling when sub-modals
 * (DeleteIssueDialog, etc.) are open within IssuePanel.
 *
 * Current bug: When IssuePanel is open → execution starts → sub-modal opens → ESC pressed:
 * - BOTH modals collapse (incorrect - should only close sub-modal)
 * - Execution stops (incorrect - should continue running)
 *
 * Expected behavior:
 * - First ESC: Close ONLY the sub-modal, keep IssuePanel open
 * - Second ESC: Stop execution (if running) OR close IssuePanel
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { IssuePanel } from '@/components/issues/IssuePanel'
import type { Issue, Execution } from '@sudocode-ai/types'
import { executionsApi } from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    executionsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      createFollowUp: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn().mockResolvedValue({}),
    },
    repositoryApi: {
      getInfo: vi.fn().mockResolvedValue({
        name: 'test-repo',
        path: '/test/path',
        branch: 'main',
      }),
      getBranches: vi.fn().mockResolvedValue({
        current: 'main',
        branches: ['main', 'develop'],
      }),
    },
    agentsApi: {
      getAll: vi.fn().mockResolvedValue([
        {
          type: 'claude-code',
          displayName: 'Claude',
          supportedModes: ['structured', 'interactive', 'hybrid'],
          supportsStreaming: true,
          supportsStructuredOutput: true,
          implemented: true,
        },
      ]),
    },
    filesApi: {
      search: vi.fn().mockResolvedValue([]),
    },
    specsApi: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    issuesApi: {
      getAll: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      delete: vi.fn(),
    },
    relationshipsApi: {
      getForEntity: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
    },
  }
})

// Mock caret position utility
vi.mock('@/lib/caret-position', () => ({
  getCaretClientRect: vi.fn(() => ({
    top: 100,
    left: 100,
    bottom: 120,
    right: 200,
    width: 100,
    height: 20,
  })),
}))

const mockIssue: Issue = {
  id: 'i-test',
  uuid: 'test-uuid-1',
  title: 'Test Issue',
  content: 'Test content',
  status: 'in_progress',
  priority: 1,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-02T15:30:00Z',
}

const mockRunningExecution: Execution = {
  id: 'exec-123',
  issue_id: 'i-test',
  issue_uuid: null,
  agent_type: 'claude-code',
  config: JSON.stringify({ type: 'claude-code' }),
  status: 'running',
  mode: 'worktree',
  prompt: null,
  session_id: null,
  workflow_execution_id: null,
  target_branch: 'main',
  branch_name: 'sudocode/exec-123',
  before_commit: 'abc123',
  after_commit: null,
  worktree_path: '/test/worktree',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:05:00Z',
  started_at: '2024-01-01T10:00:00Z',
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
}

describe('IssuePanel - ESC Modal Propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executionsApi.list).mockResolvedValue([])
  })

  describe('Test 1: ESC in sub-modal should not close parent modal', () => {
    it('should close only DeleteIssueDialog when ESC is pressed, keeping IssuePanel open', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onDelete = vi.fn()

      renderWithProviders(
        <IssuePanel issue={mockIssue} onClose={onClose} onDelete={onDelete} />
      )

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('i-test')).toBeInTheDocument()
      })

      // Open the delete dialog by clicking the delete button
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      // Verify DeleteIssueDialog is open
      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()
      })

      // Press ESC key
      await user.keyboard('{Escape}')

      // EXPECTED: DeleteIssueDialog should close
      await waitFor(() => {
        expect(screen.queryByText(/Are you sure you want to delete/i)).not.toBeInTheDocument()
      })

      // EXPECTED: IssuePanel should still be open (onClose should NOT have been called)
      expect(onClose).not.toHaveBeenCalled()

      // Verify we can see IssuePanel content
      expect(screen.getByText('i-test')).toBeInTheDocument()

      // Press ESC again to close the IssuePanel
      await user.keyboard('{Escape}')

      // NOW the IssuePanel should close
      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should allow multiple sub-modal open/close cycles without affecting IssuePanel', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onDelete = vi.fn()

      renderWithProviders(
        <IssuePanel issue={mockIssue} onClose={onClose} onDelete={onDelete} />
      )

      await waitFor(() => {
        expect(screen.getByText('i-test')).toBeInTheDocument()
      })

      // First cycle: Open and close delete dialog
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText(/Are you sure you want to delete/i)).not.toBeInTheDocument()
      })

      // IssuePanel should still be open
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('i-test')).toBeInTheDocument()

      // Second cycle: Open and close delete dialog again
      const deleteButton2 = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton2)

      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText(/Are you sure you want to delete/i)).not.toBeInTheDocument()
      })

      // IssuePanel should STILL be open after second cycle
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('i-test')).toBeInTheDocument()
    })
  })

  describe('Test 2: ESC in sub-modal should not stop execution', () => {
    it('should close only DeleteIssueDialog when ESC is pressed, without stopping the running execution', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onDelete = vi.fn()

      // Mock a running execution
      vi.mocked(executionsApi.list).mockResolvedValue([mockRunningExecution])

      renderWithProviders(
        <IssuePanel issue={mockIssue} onClose={onClose} onDelete={onDelete} />
      )

      // Wait for component to render and execution to load
      await waitFor(() => {
        expect(screen.getByText('i-test')).toBeInTheDocument()
      })

      // Give the component time to process the execution
      await new Promise(resolve => setTimeout(resolve, 100))

      // Open the delete dialog
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      // Verify DeleteIssueDialog is open
      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()
      })

      // Press ESC key while execution is running and dialog is open
      await user.keyboard('{Escape}')

      // EXPECTED: DeleteIssueDialog should close
      await waitFor(() => {
        expect(screen.queryByText(/Are you sure you want to delete/i)).not.toBeInTheDocument()
      })

      // EXPECTED: Execution should NOT be cancelled
      expect(executionsApi.cancel).not.toHaveBeenCalled()

      // EXPECTED: IssuePanel should still be open
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('i-test')).toBeInTheDocument()

      // Press ESC again - this should NOW cancel the execution (first ESC on running execution)
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(executionsApi.cancel).toHaveBeenCalledWith('exec-123')
      })

      // IssuePanel should still be open (first ESC on running execution stops it, doesn't close panel)
      expect(onClose).not.toHaveBeenCalled()

      // Press ESC one more time to close the panel
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should handle ESC correctly when execution starts after DeleteIssueDialog is already open', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const onDelete = vi.fn()

      // Start with no running execution
      vi.mocked(executionsApi.list).mockResolvedValue([])

      renderWithProviders(
        <IssuePanel issue={mockIssue} onClose={onClose} onDelete={onDelete} />
      )

      await waitFor(() => {
        expect(screen.getByText('i-test')).toBeInTheDocument()
      })

      // Open the delete dialog BEFORE execution starts
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()
      })

      // Simulate execution starting (mock executions list updating)
      vi.mocked(executionsApi.list).mockResolvedValue([mockRunningExecution])

      // Wait a bit for potential re-renders
      await new Promise(resolve => setTimeout(resolve, 100))

      // Press ESC - should close dialog only, NOT stop execution
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText(/Are you sure you want to delete/i)).not.toBeInTheDocument()
      })

      // Execution should NOT be cancelled
      expect(executionsApi.cancel).not.toHaveBeenCalled()

      // IssuePanel should still be open
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
