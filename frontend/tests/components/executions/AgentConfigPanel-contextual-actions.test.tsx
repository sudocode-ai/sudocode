import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import type { Execution } from '@/types/execution'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { ProjectProvider } from '@/contexts/ProjectContext'

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

// Mock API modules
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
      worktreeExists: vi.fn().mockResolvedValue({ exists: true }),
      getChanges: vi.fn().mockResolvedValue({
        available: true,
        captured: { files: [], summary: null, commitRange: null, uncommitted: true },
        uncommittedSnapshot: { files: ['file1.ts', 'file2.ts', 'file3.ts'], summary: null, commitRange: null },
      }),
      commit: vi.fn().mockResolvedValue({}),
      deleteWorktree: vi.fn().mockResolvedValue({}),
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
    filesApi: {
      search: vi.fn().mockResolvedValue([]),
    },
    specsApi: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    issuesApi: {
      getAll: vi.fn().mockResolvedValue([]),
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

// Mock useWorktrees
vi.mock('@/hooks/useWorktrees', () => ({
  useWorktrees: () => ({
    worktrees: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}))

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

// Mock useProject hook
vi.mock('@/hooks/useProject', () => ({
  useProject: vi.fn(() => ({
    currentProjectId: 'test-project-123',
    setCurrentProjectId: vi.fn(),
  })),
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
    stream_id: null,
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
    it('should not show actions by default (disableContextualActions defaults to true)', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
      })

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Merge Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Cleanup Worktree')).not.toBeInTheDocument()
      })
    })

    it('should not show actions when no execution is provided', async () => {
      renderComponent({
        disableContextualActions: false,
      })

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Merge Changes')).not.toBeInTheDocument()
      })
    })

    it('should show commit action when execution has uncommitted files and actions are enabled', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
        hasUncommittedChanges: true,
      })

      await waitFor(() => {
        expect(screen.getByText('Commit Changes')).toBeInTheDocument()
      })
    })

    it('should show file count badge on commit button', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
        hasUncommittedChanges: true,
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
        disableContextualActions: false,
      })

      await waitFor(() => {
        expect(screen.getByText('Merge Changes')).toBeInTheDocument()
      })
    })

    it('should show cleanup action for worktree executions', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
      })

      await waitFor(() => {
        expect(screen.getByText('Cleanup Worktree')).toBeInTheDocument()
      })
    })

    it('should not show commit action when there are no uncommitted files', async () => {
      // When files are committed, files_changed might still have values
      // but we're testing the case where there are no uncommitted changes
      const committedExecution: Execution = {
        ...mockCompletedExecution,
        after_commit: 'def456',
        files_changed: null, // No uncommitted changes to commit
      }

      renderComponent({
        currentExecution: committedExecution,
        disableContextualActions: false,
        hasUncommittedChanges: false, // Explicitly no uncommitted changes
      })

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
      })
    })

    it('should not show actions for running executions even when enabled', async () => {
      renderComponent({
        currentExecution: {
          ...mockCompletedExecution,
          status: 'running',
        },
        isRunning: true,
        disableContextualActions: false,
      })

      await waitFor(() => {
        // Commit action should be hidden since execution is not in terminal state
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
      })
    })
  })

  describe('Action Interactions', () => {
    it('should call fetchSyncPreview when sync button is clicked', async () => {
      const user = userEvent.setup()

      renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
      })

      await waitFor(() => {
        expect(screen.getByText('Merge Changes')).toBeInTheDocument()
      })

      const syncButton = screen.getByText('Merge Changes')
      await user.click(syncButton)

      expect(mockFetchSyncPreview).toHaveBeenCalledWith('exec-123')
    })
  })

  describe('Action States', () => {
    it('should disable all actions when panel is disabled', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disabled: true,
        disableContextualActions: false,
        hasUncommittedChanges: true,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        const syncButton = screen.getByText('Merge Changes').closest('button')
        const cleanupButton = screen.getByText('Cleanup Worktree').closest('button')

        expect(commitButton).toBeDisabled()
        expect(syncButton).toBeDisabled()
        expect(cleanupButton).toBeDisabled()
      })
    })

    it('should disable all actions when execution is running', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        isRunning: true,
        disableContextualActions: false,
      })

      await waitFor(() => {
        // Actions should still render but be disabled
        const buttons = screen.getAllByRole('button')
        const actionButtons = buttons.filter(
          (btn) =>
            btn.textContent?.includes('Commit') ||
            btn.textContent?.includes('Squash') ||
            btn.textContent?.includes('Cleanup')
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
        disableContextualActions: false,
        hasUncommittedChanges: true,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        const syncButton = screen.getByText('Merge Changes').closest('button')
        const cleanupButton = screen.getByText('Cleanup Worktree').closest('button')

        expect(commitButton).not.toBeDisabled()
        expect(syncButton).not.toBeDisabled()
        expect(cleanupButton).not.toBeDisabled()
      })
    })
  })

  describe('Multiple Executions', () => {
    it('should update actions when execution changes', async () => {
      const { rerender } = renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
        hasUncommittedChanges: true,
      })

      await waitFor(() => {
        expect(screen.getByText('Commit Changes')).toBeInTheDocument()
      })

      // Change to execution with no uncommitted changes
      const committedExecution: Execution = {
        ...mockCompletedExecution,
        after_commit: 'def456',
        files_changed: null, // No uncommitted changes
      }

      rerender(
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <ProjectProvider>
              <AgentConfigPanel
                issueId="i-test1"
                onStart={mockOnStart}
                currentExecution={committedExecution}
                disableContextualActions={false}
                hasUncommittedChanges={false}
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
        disableContextualActions: false,
        hasUncommittedChanges: true,
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
                disableContextualActions={false}
                hasUncommittedChanges={true}
              />
            </ProjectProvider>
          </WebSocketProvider>
        </QueryClientProvider>
      )

      await waitFor(() => {
        expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Merge Changes')).not.toBeInTheDocument()
      })
    })
  })

  describe('Layout and Styling', () => {
    it('should render actions in a flex container', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
        hasUncommittedChanges: true,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes')
        const container = commitButton.closest('div.flex')
        expect(container).toHaveClass('items-center')
      })
    })

    it('should render action buttons with correct styling', async () => {
      renderComponent({
        currentExecution: mockCompletedExecution,
        disableContextualActions: false,
        hasUncommittedChanges: true,
      })

      await waitFor(() => {
        const commitButton = screen.getByText('Commit Changes').closest('button')
        const syncButton = screen.getByText('Merge Changes').closest('button')
        const cleanupButton = screen.getByText('Cleanup Worktree').closest('button')

        expect(commitButton).toBeInTheDocument()
        expect(syncButton).toBeInTheDocument()
        expect(cleanupButton).toBeInTheDocument()
      })
    })
  })
})
