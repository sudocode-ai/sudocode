import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { IssuePanel } from '@/components/issues/IssuePanel'
import type { Issue } from '@sudocode-ai/types'
import { executionsApi } from '@/lib/api'

// Mock the executionsApi, repositoryApi, and agentsApi
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    executionsApi: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      createFollowUp: vi.fn(),
      get: vi.fn(),
    },
    repositoryApi: {
      getInfo: vi.fn().mockResolvedValue({
        name: 'test-repo',
        path: '/test/path',
        branch: 'main',
      }),
      getBranches: vi.fn().mockResolvedValue({
        current: 'main',
        branches: ['main', 'develop', 'feature/test'],
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
    },
    relationshipsApi: {
      list: vi.fn().mockResolvedValue([]),
      getForEntity: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
    },
  }
})

// Mock caret position utility for ContextSearchTextarea
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
  id: 'ISSUE-001',
  uuid: 'test-uuid-1',
  title: 'Test Issue',
  content: 'Test content in detail',
  status: 'in_progress',
  priority: 1,
  assignee: 'john.doe',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-02T15:30:00Z',
  closed_at: undefined,
  parent_id: 'ISSUE-000',
}

describe('IssuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default empty array for executions
    vi.mocked(executionsApi.list).mockResolvedValue([])
  })

  it('should render issue details with editable fields', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(screen.getByText('ISSUE-001')).toBeInTheDocument()

    // Title should be in an editable input
    expect(screen.getByDisplayValue('Test Issue')).toBeInTheDocument()

    // Content is rendered by TiptapEditor
    await waitFor(() => {
      expect(screen.getByText(/Test content in detail/)).toBeInTheDocument()
    })

    // Status and Priority should be in selects
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('High (P1)')).toBeInTheDocument()

    expect(screen.getByText('john.doe')).toBeInTheDocument()
    expect(screen.getByText('ISSUE-000')).toBeInTheDocument()
  })

  it('should render close button when onClose is provided', () => {
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    expect(screen.getByLabelText('Back')).toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    const closeButton = screen.getByLabelText('Back')
    await user.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should render save status when onUpdate is provided', () => {
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('should render Delete button when onDelete is provided', () => {
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    expect(screen.getByLabelText('Delete')).toBeInTheDocument()
  })

  it('should show unsaved changes status when fields are modified', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    // Initially should show all saved
    expect(screen.getByText('All changes saved')).toBeInTheDocument()

    // Modify the title
    const titleInput = screen.getByPlaceholderText('Issue title...')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Title')

    // Should show unsaved changes
    expect(screen.getByText('Unsaved changes...')).toBeInTheDocument()
  })

  it('should auto-save changes after debounce', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    // Modify the title
    const titleInput = screen.getByPlaceholderText('Issue title...')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Title')

    // Wait for auto-save debounce (1 second)
    await waitFor(
      () => {
        expect(onUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Updated Title',
          })
        )
      },
      { timeout: 2000 }
    )
  })

  it('should show delete confirmation dialog when Delete button is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    const deleteButton = screen.getByLabelText('Delete')
    await user.click(deleteButton)

    // Should show delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByText('Delete Issue')).toBeInTheDocument()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()
    })
  })

  it('should call onDelete when delete is confirmed', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    // Click Delete button
    const deleteButton = screen.getByLabelText('Delete')
    await user.click(deleteButton)

    // Confirm deletion in dialog
    const confirmButton = await screen.findByRole('button', { name: /^Delete$/ })
    await user.click(confirmButton)

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should not call onDelete when deletion is cancelled', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    // Click Delete button
    const deleteButton = screen.getByLabelText('Delete')
    await user.click(deleteButton)

    // Cancel deletion in dialog
    const cancelButton = await screen.findByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('should show Saving status and disable Delete button when isUpdating is true', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(
      <IssuePanel issue={mockIssue} onUpdate={onUpdate} onDelete={onDelete} isUpdating={true} />
    )

    // When isUpdating is true, should show "Saving..." status
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
  })

  it('should disable Delete button when isDeleting is true', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(
      <IssuePanel issue={mockIssue} onUpdate={onUpdate} onDelete={onDelete} isDeleting={true} />
    )

    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
  })

  it('should display formatted timestamps', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    // Check that timestamps are formatted (not raw ISO strings)
    expect(screen.queryByText('2024-01-01T10:00:00Z')).not.toBeInTheDocument()
    expect(screen.queryByText('2024-01-02T15:30:00Z')).not.toBeInTheDocument()

    // Should have "Updated" timestamp
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
  })

  it('should not show closed_at when issue is not closed', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(screen.queryByText(/Closed/)).not.toBeInTheDocument()
  })

  it('should show closed_at when issue is closed', () => {
    const closedIssue = {
      ...mockIssue,
      status: 'closed' as const,
      closed_at: '2024-01-03T12:00:00Z',
    }

    renderWithProviders(<IssuePanel issue={closedIssue} />)

    expect(screen.getByText(/Closed.*ago/)).toBeInTheDocument()
  })

  it('should not show assignee section when assignee is undefined', () => {
    const issueWithoutAssignee = { ...mockIssue, assignee: undefined }

    renderWithProviders(<IssuePanel issue={issueWithoutAssignee} />)

    expect(screen.queryByText('Assignee')).not.toBeInTheDocument()
    expect(screen.queryByText('john.doe')).not.toBeInTheDocument()
  })

  it('should not show parent section when parent_id is undefined', () => {
    const issueWithoutParent = { ...mockIssue, parent_id: undefined }

    renderWithProviders(<IssuePanel issue={issueWithoutParent} />)

    expect(screen.queryByText('Parent Issue')).not.toBeInTheDocument()
    expect(screen.queryByText('ISSUE-000')).not.toBeInTheDocument()
  })

  it('should render Archive button when issue is not archived', () => {
    const onArchive = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onArchive={onArchive} />)

    expect(screen.getByRole('button', { name: /Archive/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unarchive/ })).not.toBeInTheDocument()
  })

  it('should render Unarchive button when issue is archived', () => {
    const archivedIssue = { ...mockIssue, archived: true, archived_at: '2024-01-04T10:00:00Z' }
    const onUnarchive = vi.fn()

    renderWithProviders(<IssuePanel issue={archivedIssue} onUnarchive={onUnarchive} />)

    expect(screen.getByRole('button', { name: /Unarchive/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archive$/ })).not.toBeInTheDocument()
  })

  it('should call onArchive when Archive button is clicked', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onArchive={onArchive} />)

    const archiveButton = screen.getByRole('button', { name: /Archive/ })
    await user.click(archiveButton)

    expect(onArchive).toHaveBeenCalledWith('ISSUE-001')
  })

  it('should call onUnarchive when Unarchive button is clicked', async () => {
    const user = userEvent.setup()
    const archivedIssue = { ...mockIssue, archived: true, archived_at: '2024-01-04T10:00:00Z' }
    const onUnarchive = vi.fn()

    renderWithProviders(<IssuePanel issue={archivedIssue} onUnarchive={onUnarchive} />)

    const unarchiveButton = screen.getByRole('button', { name: /Unarchive/ })
    await user.click(unarchiveButton)

    expect(onUnarchive).toHaveBeenCalledWith('ISSUE-001')
  })

  it('should disable Archive button when isUpdating is true', () => {
    const onArchive = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onArchive={onArchive} isUpdating={true} />)

    expect(screen.getByRole('button', { name: /Archive/ })).toBeDisabled()
  })

  it('should call onClose when ESC key is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should cancel execution on first ESC press, then close panel on second ESC press', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    // Mock a running execution
    vi.mocked(executionsApi.list).mockResolvedValue([
      {
        id: 'exec-123',
        issue_id: 'ISSUE-001',
        status: 'running',
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        mode: 'worktree',
        target_branch: 'main',
        agent_type: 'claude-code',
        parent_execution_id: null,
      } as any,
    ])

    // Mock cancel API
    const mockCancel = vi.fn().mockResolvedValue({})
    vi.mocked(executionsApi).cancel = mockCancel

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    // Wait for execution to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Execution is running (esc to cancel)')).toBeDisabled()
    })

    // First ESC press should cancel the execution
    await user.keyboard('{Escape}')
    expect(mockCancel).toHaveBeenCalledWith('exec-123')
    expect(onClose).not.toHaveBeenCalled()

    // Mock the execution as stopped after cancel
    vi.mocked(executionsApi.list).mockResolvedValue([
      {
        id: 'exec-123',
        issue_id: 'ISSUE-001',
        status: 'cancelled',
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        mode: 'worktree',
        target_branch: 'main',
        agent_type: 'claude-code',
        parent_execution_id: null,
      } as any,
    ])

    // Second ESC press should close the panel
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should not call onClose when ESC is pressed while delete dialog is open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} onDelete={onDelete} />)

    // Open delete dialog
    const deleteButton = screen.getByLabelText('Delete')
    await user.click(deleteButton)

    // ESC should not close the panel when dialog is open
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('should not stop execution when ESC closes untracked modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    // Mock a running execution
    vi.mocked(executionsApi.list).mockResolvedValue([
      {
        id: 'exec-123',
        issue_id: 'ISSUE-001',
        status: 'running',
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        mode: 'worktree',
        target_branch: 'main',
        agent_type: 'claude-code',
        parent_execution_id: null,
      } as any,
    ])

    // Mock cancel API
    const mockCancel = vi.fn().mockResolvedValue({})
    vi.mocked(executionsApi).cancel = mockCancel

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    // Wait for execution to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Execution is running (esc to cancel)')).toBeDisabled()
    })

    // Simulate an untracked modal being open (e.g., AgentSettingsDialog, CommitChangesDialog)
    // by creating a Radix UI dialog element in the DOM
    const mockDialog = document.createElement('div')
    mockDialog.setAttribute('role', 'dialog')
    mockDialog.setAttribute('data-state', 'open')
    mockDialog.textContent = 'Mock Settings Dialog'
    document.body.appendChild(mockDialog)

    // Verify the mock dialog is in the DOM
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeInTheDocument()

    // Press ESC - this simulates user closing the untracked modal
    await user.keyboard('{Escape}')

    // Remove the mock dialog (simulating it closing)
    document.body.removeChild(mockDialog)

    // Wait a bit to ensure any handlers have run
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"][data-state="open"]')).not.toBeInTheDocument()
    })

    // BUG: The running execution should NOT be cancelled when closing an untracked modal
    // This test should FAIL initially (execution gets cancelled incorrectly)
    // After fix, this assertion should PASS (execution continues running)
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('should not close panel when ESC dismisses a modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    // Simulate a modal being open (e.g., AgentSettingsDialog, CommitChangesDialog)
    // by creating a Radix UI dialog element in the DOM
    const mockDialog = document.createElement('div')
    mockDialog.setAttribute('role', 'dialog')
    mockDialog.setAttribute('data-state', 'open')
    mockDialog.textContent = 'Mock Settings Dialog'
    document.body.appendChild(mockDialog)

    // Verify the mock dialog is in the DOM
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeInTheDocument()

    // Press ESC - this simulates user closing the modal
    await user.keyboard('{Escape}')

    // Remove the mock dialog (simulating it closing)
    document.body.removeChild(mockDialog)

    // Wait a bit to ensure any handlers have run
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"][data-state="open"]')).not.toBeInTheDocument()
    })

    // BUG: The panel should NOT close when ESC dismisses a modal
    // This test should FAIL initially (panel closes incorrectly)
    // After fix, this assertion should PASS (panel stays open)
    expect(onClose).not.toHaveBeenCalled()
  })

  describe('Follow-up Mode and New Execution Button', () => {
    it('should show "New conversation" button when there is a completed execution', async () => {
      // Mock executions API to return a completed execution
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      await waitFor(() => {
        expect(screen.getByText('New conversation')).toBeInTheDocument()
      })
    })

    it('should not show "New conversation" button when there are no executions', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      await waitFor(() => {
        expect(screen.queryByText('New conversation')).not.toBeInTheDocument()
      })
    })

    it('should not show "New conversation" button when execution is still running', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      await waitFor(() => {
        expect(screen.queryByText('New conversation')).not.toBeInTheDocument()
      })
    })

    it('should hide "New conversation" button after clicking it', async () => {
      const user = userEvent.setup()
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      const newExecutionButton = await screen.findByText('New conversation')
      await user.click(newExecutionButton)

      await waitFor(() => {
        expect(screen.queryByText('New conversation')).not.toBeInTheDocument()
      })
    })

    it('should update placeholder text when clicking "New conversation" button', async () => {
      const user = userEvent.setup()
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Initial placeholder should be for continuing
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Continue the previous conversation... (ctrl+k for new, @ for context)')
        ).toBeInTheDocument()
      })

      const newExecutionButton = await screen.findByText('New conversation')
      await user.click(newExecutionButton)

      // After clicking, placeholder should change to new execution mode
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Start a new execution... (ctrl+k to continue previous, @ for context)')
        ).toBeInTheDocument()
      })
    })

    it('should follow the latest execution in chain', async () => {
      // Parent execution with a follow-up
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-parent',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
        {
          id: 'exec-child',
          issue_id: 'ISSUE-001',
          status: 'completed',
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T13:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: 'exec-parent',
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      // Should show follow-up placeholder (meaning it found the child execution to continue)
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Continue the previous conversation... (ctrl+k for new, @ for context)')
        ).toBeInTheDocument()
      })

      // "New conversation" button should be present
      expect(screen.getByText('New conversation')).toBeInTheDocument()
    })

    it('should disable input when execution is running', async () => {
      vi.mocked(executionsApi.list).mockResolvedValue([
        {
          id: 'exec-123',
          issue_id: 'ISSUE-001',
          status: 'running',
          created_at: '2024-01-01T10:00:00Z',
          updated_at: '2024-01-01T11:00:00Z',
          mode: 'worktree',
          target_branch: 'main',
          agent_type: 'claude-code',
          parent_execution_id: null,
        } as any,
      ])

      renderWithProviders(<IssuePanel issue={mockIssue} />)

      await waitFor(() => {
        const textarea = screen.getByPlaceholderText('Execution is running (esc to cancel)')
        expect(textarea).toBeDisabled()
      })
    })
  })
})
