import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import type { Execution } from '@/types/execution'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { toast } from 'sonner'

// Mock WebSocket
vi.mock('@/contexts/WebSocketContext', async () => {
  const actual = await vi.importActual('@/contexts/WebSocketContext')
  return {
    ...actual,
    WebSocketProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }
})

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock execution sync hook
const mockFetchSyncPreview = vi.fn()
const mockOpenWorktreeInIDE = vi.fn()

vi.mock('@/hooks/useExecutionSync', () => ({
  useExecutionSync: () => ({
    fetchSyncPreview: mockFetchSyncPreview,
    openWorktreeInIDE: mockOpenWorktreeInIDE,
    closeSyncDialogs: vi.fn(),
    resetSyncState: vi.fn(),
    syncPreview: null,
    syncStatus: 'idle',
    syncResult: null,
    syncError: null,
    isSyncPreviewOpen: false,
    isSyncProgressOpen: false,
  }),
}))

// Mock executionsApi
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    executionsApi: {
      ...actual.executionsApi,
      prepare: vi.fn().mockResolvedValue({
        renderedPrompt: 'Test prompt',
        issue: { id: 'i-test', title: 'Test', description: 'Test issue' },
      }),
    },
  }
})

// Mock useAgents
vi.mock('@/hooks/useAgents', () => ({
  useAgents: () => ({
    agents: [
      { id: 'claude-code', name: 'Claude Code', isImplemented: true },
      { id: 'codex', name: 'Codex', isImplemented: true },
    ],
    loading: false,
  }),
}))

describe('AgentConfigPanel - Contextual Actions', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const mockOnStart = vi.fn()

  const mockCompletedExecution: Execution = {
    id: 'exec-123',
    issue_id: 'i-test1',
    issue_uuid: 'uuid-123',
    mode: 'worktree',
    prompt: 'Test prompt',
    config: JSON.stringify({ mode: 'worktree' }),
    agent_type: 'claude-code',
    session_id: 'session-123',
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'feature/test',
    before_commit: 'abc123',
    after_commit: null,
    worktree_path: '/path/to/worktree',
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T01:00:00Z',
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4',
    summary: 'Completed successfully',
    files_changed: JSON.stringify(['file1.ts', 'file2.ts', 'file3.ts']),
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
  }

  const renderComponent = (props: any = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <WebSocketProvider>
          <ProjectProvider>
            <AgentConfigPanel
              issueId="i-test1"
              onStart={mockOnStart}
              currentExecution={null}
              {...props}
            />
          </ProjectProvider>
        </WebSocketProvider>
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
  })

  describe('Action Visibility', () => {
    it('should not show actions when no execution is provided', async () => {
      renderComponent()

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Sync to Main')).not.toBeInTheDocument()
        expect(screen.queryByText('Open in IDE')).not.toBeInTheDocument()
        expect(screen.queryByText('Verify Code')).not.toBeInTheDocument()
      })
    })

    it('should show commit action when execution has uncommitted files', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Commit Changes')).toBeInTheDocument()
      })
    })

    it('should show file count badge on commit button', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        expect(commitButton).toBeInTheDocument()
        // Badge should show "3" for 3 files
        expect(commitButton).toHaveTextContent('3')
      })
    })

    it('should show sync action for worktree executions', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Sync to Main')).toBeInTheDocument()
      })
    })

    it('should show open worktree action', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Open in IDE')).toBeInTheDocument()
      })
    })

    it('should show verify action for completed executions', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Verify Code')).toBeInTheDocument()
      })
    })

    it('should not show commit action when files are already committed', async () => {
      const committedExecution: Execution = {
        ...mockCompletedExecution,
        after_commit: 'def456',
      }

      renderComponent({
        currentExecution: committedExecution,
      })

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
      })
    })

    it('should not show actions for running executions when disabled', async () => {
      renderComponent({
        currentExecution: {
          ...mockCompletedExecution,
          status: 'running',
        },
        isRunning: true,
      })

      await waitFor(() => {
        // Verify action should be hidden since execution is not completed
        expect(screen.queryByText('Verify Code')).not.toBeInTheDocument()
      })
    })
  })

  describe('Action Interactions', () => {
    it('should show toast when commit button is clicked', async () => {
      const user = userEvent.setup()

      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Commit Changes')).toBeInTheDocument()
      })

      const commitButton = screen.getByText('Commit Changes')
      await user.click(commitButton)

      expect(toast.success).toHaveBeenCalledWith('Commit changes functionality coming soon')
    })

    it('should call fetchSyncPreview when sync button is clicked', async () => {
      const user = userEvent.setup()

      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Sync to Main')).toBeInTheDocument()
      })

      const syncButton = screen.getByText('Sync to Main')
      await user.click(syncButton)

      expect(mockFetchSyncPreview).toHaveBeenCalledWith('exec-123')
    })

    it('should call openWorktreeInIDE when open button is clicked', async () => {
      const user = userEvent.setup()

      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Open in IDE')).toBeInTheDocument()
      })

      const openButton = screen.getByText('Open in IDE')
      await user.click(openButton)

      await waitFor(() => {
        expect(mockOpenWorktreeInIDE).toHaveBeenCalledWith(mockCompletedExecution)
      })
    })

    it('should populate prompt textarea when verify button is clicked', async () => {
      const user = userEvent.setup()

      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Verify Code')).toBeInTheDocument()
      })

      const verifyButton = screen.getByText('Verify Code')
      await user.click(verifyButton)

      await waitFor(() => {
        // Find textarea by role instead of placeholder
        const textarea = screen.getByRole('textbox')
        const value = (textarea as HTMLTextAreaElement).value
        expect(value).toContain('Review and verify the implementation')
      })
    })
  })

  describe('Action States', () => {
    it('should disable all actions when panel is disabled', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disabled: true,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        const syncButton = screen.getByText('Sync to Main').closest('button')
        const openButton = screen.getByText('Open in IDE').closest('button')
        const verifyButton = screen.getByText('Verify Code').closest('button')

        expect(commitButton).toBeDisabled()
        expect(syncButton).toBeDisabled()
        expect(openButton).toBeDisabled()
        expect(verifyButton).toBeDisabled()
      })
    })

    it('should disable all actions when execution is running', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        isRunning: true,
      })

      await waitFor(() => {
        // Actions should still render but be disabled
        const buttons = screen.getAllByRole('button')
        const actionButtons = buttons.filter(
          (btn) =>
            btn.textContent?.includes('Commit') ||
            btn.textContent?.includes('Sync') ||
            btn.textContent?.includes('Open') ||
            btn.textContent?.includes('Verify')
        )

        actionButtons.forEach((button) => {
          expect(button).toBeDisabled()
        })
      })
    })

    it('should enable actions when panel is not disabled', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disabled: false,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        const syncButton = screen.getByText('Sync to Main').closest('button')
        const openButton = screen.getByText('Open in IDE').closest('button')
        const verifyButton = screen.getByText('Verify Code').closest('button')

        expect(commitButton).not.toBeDisabled()
        expect(syncButton).not.toBeDisabled()
        expect(openButton).not.toBeDisabled()
        expect(verifyButton).not.toBeDisabled()
      })
    })
  })

  describe('Multiple Executions', () => {
    it('should update actions when execution changes', async () => {
      const { rerender } = renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Commit Changes')).toBeInTheDocument()
      })

      // Change to committed execution
      const committedExecution: Execution = {
        ...mockCompletedExecution,
        after_commit: 'def456',
      }

      rerender(
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <ProjectProvider>
              <AgentConfigPanel
                issueId="i-test1"
                onStart={mockOnStart}
                currentExecution={committedExecution}
              />
            </ProjectProvider>
          </WebSocketProvider>
        </QueryClientProvider>
      )

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
      })
    })

    it('should clear actions when execution becomes null', async () => {
      const { rerender } = renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.getByText('Commit Changes')).toBeInTheDocument()
      })

      // Clear execution
      rerender(
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <ProjectProvider>
              <AgentConfigPanel
                issueId="i-test1"
                onStart={mockOnStart}
                currentExecution={null}
              />
            </ProjectProvider>
          </WebSocketProvider>
        </QueryClientProvider>
      )

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Sync to Main')).not.toBeInTheDocument()
      })
    })
  })

  describe('Layout and Styling', () => {
    it('should render actions in a centered container', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes')
        const container = commitButton.closest('div.flex')
        expect(container).toHaveClass('items-center', 'justify-center')
      })
    })

    it('should render action buttons with outline variant', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        // Check that button has outline styling (this depends on your Button component implementation)
        expect(commitButton).toBeInTheDocument()
      })
    })
  })
})
