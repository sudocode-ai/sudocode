import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AgentDetailSidebar, SidebarBackdrop } from '@/components/codeviz/AgentDetailSidebar'

// Mock the API
const mockGetById = vi.fn()
const mockIssueGetById = vi.fn()
const mockSpecGetById = vi.fn()
const mockRelationshipsGetForEntity = vi.fn()
const mockGetChanges = vi.fn()
const mockGetFileDiff = vi.fn()
const mockCancel = vi.fn()
const mockCreateFollowUp = vi.fn()
vi.mock('@/lib/api', () => ({
  executionsApi: {
    getById: (id: string) => mockGetById(id),
    getChanges: (id: string) => mockGetChanges(id),
    getFileDiff: (id: string, path: string) => mockGetFileDiff(id, path),
    cancel: (id: string) => mockCancel(id),
    createFollowUp: (id: string, req: { feedback: string }) => mockCreateFollowUp(id, req),
  },
  issuesApi: {
    getById: (id: string) => mockIssueGetById(id),
  },
  specsApi: {
    getById: (id: string) => mockSpecGetById(id),
  },
  relationshipsApi: {
    getForEntity: (id: string, type: string) => mockRelationshipsGetForEntity(id, type),
  },
}))

// Mock useProjectRoutes
vi.mock('@/hooks/useProjectRoutes', () => ({
  useProjectRoutes: () => ({
    paths: {
      issue: (id: string) => `/issues/${id}`,
      spec: (id: string) => `/specs/${id}`,
    },
  }),
}))

// Mock colors utility
vi.mock('@/utils/colors', () => ({
  getAgentColor: vi.fn((id: string) => `#color-${id}`),
}))

// Mock ThemeContext for DiffViewer
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))

// Mock FollowUpDialog
const mockFollowUpDialogSubmit = vi.fn()
vi.mock('@/components/executions/FollowUpDialog', () => ({
  FollowUpDialog: ({ open, onSubmit, onCancel }: { open: boolean; onSubmit: (feedback: string) => Promise<void>; onCancel: () => void }) => {
    if (!open) return null
    return (
      <div data-testid="follow-up-dialog">
        <button data-testid="follow-up-submit" onClick={() => {
          mockFollowUpDialogSubmit()
          onSubmit('Test feedback')
        }}>Submit Follow Up</button>
        <button data-testid="follow-up-cancel" onClick={onCancel}>Cancel</button>
      </div>
    )
  },
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Sample execution data
const mockExecution = {
  id: 'exec-001',
  issue_id: 'i-abc1',
  agent_type: 'claude-code',
  status: 'running' as const,
  prompt: 'Implement the authentication middleware with proper error handling',
  worktree_path: '/path/to/worktree',
  branch_name: 'sudocode/exec-001',
  target_branch: 'main',
  started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

// Sample issue data
const mockIssue = {
  id: 'i-abc1',
  title: 'Implement authentication middleware',
  description: 'Add JWT token validation',
  status: 'in_progress' as const,
  priority: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

// Sample spec data
const mockSpec = {
  id: 's-xyz9',
  title: 'Authentication System Design',
  description: 'Full authentication flow specification',
  priority: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

// Sample relationships data
const mockRelationships = [
  {
    id: 'r-001',
    from_id: 'i-abc1',
    from_type: 'issue',
    to_id: 's-xyz9',
    to_type: 'spec',
    relationship_type: 'implements',
  },
]

// Sample changes data
const mockChangesData = {
  available: true,
  current: {
    files: [
      { path: 'src/middleware/auth.ts', additions: 47, deletions: 12, status: 'M' as const },
      { path: 'src/types/auth.d.ts', additions: 23, deletions: 0, status: 'A' as const },
      { path: 'src/index.ts', additions: 3, deletions: 1, status: 'M' as const },
    ],
    summary: { totalFiles: 3, totalAdditions: 73, totalDeletions: 13 },
    commitRange: { before: 'abc123', after: 'def456' },
    uncommitted: false,
  },
}

// Create a wrapper with QueryClientProvider and MemoryRouter
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('AgentDetailSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetById.mockResolvedValue(mockExecution)
    mockIssueGetById.mockResolvedValue(mockIssue)
    mockSpecGetById.mockResolvedValue(mockSpec)
    mockRelationshipsGetForEntity.mockResolvedValue(mockRelationships)
    mockGetChanges.mockResolvedValue(mockChangesData)
    mockGetFileDiff.mockResolvedValue({ oldContent: 'old', newContent: 'new' })
    mockCancel.mockResolvedValue({})
    mockCreateFollowUp.mockResolvedValue({ id: 'exec-002' })
  })

  describe('Rendering', () => {
    it('should render sidebar when open', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-sidebar')).toBeInTheDocument()
      })
    })

    it('should be hidden when closed', () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={false} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      const sidebar = screen.getByTestId('agent-detail-sidebar')
      expect(sidebar).toHaveClass('translate-x-full')
    })

    it('should show loading state while fetching', () => {
      mockGetById.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      // Should show spinner
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    })

    it('should show error state on fetch failure', async () => {
      mockGetById.mockRejectedValue(new Error('Failed to fetch'))

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Failed to load execution')).toBeInTheDocument()
      })
    })
  })

  describe('Agent Info', () => {
    it('should display agent type formatted correctly', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })
    })

    it('should display codex agent type', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, agent_type: 'codex' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Codex')).toBeInTheDocument()
      })
    })

    it('should display unknown agent type as-is', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, agent_type: 'custom-agent' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('custom-agent')).toBeInTheDocument()
      })
    })
  })

  describe('Status Display', () => {
    it('should show running status', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Running')).toBeInTheDocument()
      })
    })

    it('should show completed status', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'completed' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Completed')).toBeInTheDocument()
      })
    })

    it('should show failed status', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'failed' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument()
      })
    })

    it('should show paused status', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'paused' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Paused')).toBeInTheDocument()
      })
    })
  })

  describe('Time Display', () => {
    it('should display relative start time', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        // Should show "Started X ago" or similar
        expect(screen.getByText(/started/i)).toBeInTheDocument()
      })
    })

    it('should not show time if started_at is missing', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, started_at: null })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByText(/started/i)).not.toBeInTheDocument()
    })
  })

  describe('Prompt Display', () => {
    it('should display prompt preview', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText(/implement the authentication/i)).toBeInTheDocument()
      })
    })

    it('should not show prompt section if no prompt', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, prompt: null })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByText('Prompt:')).not.toBeInTheDocument()
    })
  })

  describe('Close Actions', () => {
    it('should call onClose when Back button clicked', async () => {
      const onClose = vi.fn()

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={onClose} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('sidebar-back-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('sidebar-back-button'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when X button clicked', async () => {
      const onClose = vi.fn()

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={onClose} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('sidebar-close-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('sidebar-close-button'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Linked Issue Card', () => {
    it('should display linked issue card when issue exists', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('linked-issue-card')).toBeInTheDocument()
      })

      expect(screen.getByText('Implement authentication middleware')).toBeInTheDocument()
      expect(screen.getByText('i-abc1')).toBeInTheDocument()
      expect(screen.getByText('In Progress')).toBeInTheDocument()
    })

    it('should show loading state while fetching issue', async () => {
      mockIssueGetById.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      // Wait for execution to load, then issue loading state
      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      // Should show a spinner for issue (loader in the issue section)
      expect(screen.queryByTestId('linked-issue-card')).not.toBeInTheDocument()
    })

    it('should not show issue section when no issue_id', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, issue_id: null })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByText('Issue')).not.toBeInTheDocument()
      expect(screen.queryByTestId('linked-issue-card')).not.toBeInTheDocument()
    })

    it('should show different issue statuses', async () => {
      mockIssueGetById.mockResolvedValue({ ...mockIssue, status: 'blocked' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Blocked')).toBeInTheDocument()
      })
    })
  })

  describe('Linked Spec Card', () => {
    it('should display linked spec card when spec relationship exists', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('linked-spec-card')).toBeInTheDocument()
      })

      expect(screen.getByText('Authentication System Design')).toBeInTheDocument()
      expect(screen.getByText('s-xyz9')).toBeInTheDocument()
    })

    it('should not show spec section when no implements relationship', async () => {
      mockRelationshipsGetForEntity.mockResolvedValue([])

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByText('Implements Spec')).not.toBeInTheDocument()
      expect(screen.queryByTestId('linked-spec-card')).not.toBeInTheDocument()
    })

    it('should fetch relationships for issue', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(mockRelationshipsGetForEntity).toHaveBeenCalledWith('i-abc1', 'issue')
      })
    })
  })

  describe('Changed Files List', () => {
    it('should display changed files list with file count', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('changed-files-list')).toBeInTheDocument()
      })

      expect(screen.getByText('Changed Files (3)')).toBeInTheDocument()
    })

    it('should display file rows with status badges', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('changed-file-row')).toHaveLength(3)
      })

      // Should show file names
      expect(screen.getByText('auth.ts')).toBeInTheDocument()
      expect(screen.getByText('auth.d.ts')).toBeInTheDocument()
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    it('should display addition/deletion stats', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('+47')).toBeInTheDocument()
        expect(screen.getByText('-12')).toBeInTheDocument()
      })
    })

    it('should not show changed files when unavailable', async () => {
      mockGetChanges.mockResolvedValue({ available: false, reason: 'missing_commits' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('changed-files-list')).not.toBeInTheDocument()
    })

    it('should not show changed files when no files changed', async () => {
      mockGetChanges.mockResolvedValue({
        available: true,
        current: { files: [], summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 }, commitRange: null, uncommitted: false },
      })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('changed-files-list')).not.toBeInTheDocument()
    })

    it('should open diff modal when file row clicked', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('changed-file-row')).toHaveLength(3)
      })

      // Click first file row
      fireEvent.click(screen.getAllByTestId('changed-file-row')[0])

      await waitFor(() => {
        expect(mockGetFileDiff).toHaveBeenCalledWith('exec-001', 'src/middleware/auth.ts')
      })
    })

    it('should call onFileHover when hovering over a file', async () => {
      const onFileHover = vi.fn()

      render(
        <AgentDetailSidebar
          executionId="exec-001"
          isOpen={true}
          onClose={vi.fn()}
          onFileHover={onFileHover}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('changed-file-row')).toHaveLength(3)
      })

      // Hover over first file row
      fireEvent.mouseEnter(screen.getAllByTestId('changed-file-row')[0])

      expect(onFileHover).toHaveBeenCalledWith('src/middleware/auth.ts')
    })

    it('should call onFileLeave when leaving a file', async () => {
      const onFileLeave = vi.fn()

      render(
        <AgentDetailSidebar
          executionId="exec-001"
          isOpen={true}
          onClose={vi.fn()}
          onFileLeave={onFileLeave}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('changed-file-row')).toHaveLength(3)
      })

      // Hover and leave first file row
      fireEvent.mouseEnter(screen.getAllByTestId('changed-file-row')[0])
      fireEvent.mouseLeave(screen.getAllByTestId('changed-file-row')[0])

      expect(onFileLeave).toHaveBeenCalledWith('src/middleware/auth.ts')
    })

    it('should handle multiple rapid hovers without issues', async () => {
      const onFileHover = vi.fn()
      const onFileLeave = vi.fn()

      render(
        <AgentDetailSidebar
          executionId="exec-001"
          isOpen={true}
          onClose={vi.fn()}
          onFileHover={onFileHover}
          onFileLeave={onFileLeave}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('changed-file-row')).toHaveLength(3)
      })

      const fileRows = screen.getAllByTestId('changed-file-row')

      // Rapidly hover over multiple files
      fireEvent.mouseEnter(fileRows[0])
      fireEvent.mouseLeave(fileRows[0])
      fireEvent.mouseEnter(fileRows[1])
      fireEvent.mouseLeave(fileRows[1])
      fireEvent.mouseEnter(fileRows[2])

      // Verify all hover calls were made
      expect(onFileHover).toHaveBeenCalledTimes(3)
      expect(onFileHover).toHaveBeenCalledWith('src/middleware/auth.ts')
      expect(onFileHover).toHaveBeenCalledWith('src/types/auth.d.ts')
      expect(onFileHover).toHaveBeenCalledWith('src/index.ts')
      expect(onFileLeave).toHaveBeenCalledTimes(2)
    })
  })

  describe('API Integration', () => {
    it('should fetch execution data when opened', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(mockGetById).toHaveBeenCalledWith('exec-001')
      })
    })

    it('should not fetch when closed', () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={false} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      expect(mockGetById).not.toHaveBeenCalled()
    })

    it('should refetch when executionId changes', async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })

      const { rerender } = render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />
          </QueryClientProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetById).toHaveBeenCalledWith('exec-001')
      })

      // Rerender with new executionId - reuse same providers
      rerender(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentDetailSidebar executionId="exec-002" isOpen={true} onClose={vi.fn()} />
          </QueryClientProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetById).toHaveBeenCalledWith('exec-002')
      })
    })
  })

  describe('Execution Actions', () => {
    it('should show Stop button for running execution', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('stop-execution-button')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('follow-up-button')).not.toBeInTheDocument()
    })

    it('should show Stop button for pending execution', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'pending' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('stop-execution-button')).toBeInTheDocument()
      })
    })

    it('should show Stop button for paused execution', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'paused' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('stop-execution-button')).toBeInTheDocument()
      })
    })

    it('should show Follow Up button for completed execution', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'completed' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-button')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('stop-execution-button')).not.toBeInTheDocument()
    })

    it('should show Follow Up button for stopped execution', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'stopped' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-button')).toBeInTheDocument()
      })
    })

    it('should show Follow Up button for failed execution', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'failed' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-button')).toBeInTheDocument()
      })
    })

    it('should not show actions for cancelled execution', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'cancelled' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('execution-actions')).not.toBeInTheDocument()
    })

    it('should open stop confirmation dialog when Stop clicked', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('stop-execution-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('stop-execution-button'))

      await waitFor(() => {
        expect(screen.getByText('Stop Execution?')).toBeInTheDocument()
      })
    })

    it('should call cancel API when stop confirmed', async () => {
      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('stop-execution-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('stop-execution-button'))

      await waitFor(() => {
        expect(screen.getByText('Stop Execution?')).toBeInTheDocument()
      })

      // Click the confirm button in the dialog
      fireEvent.click(screen.getByRole('button', { name: /stop execution/i }))

      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledWith('exec-001')
      })
    })

    it('should open follow up dialog when Follow Up clicked', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'completed' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('follow-up-button'))

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-dialog')).toBeInTheDocument()
      })
    })

    it('should call createFollowUp API when follow up submitted', async () => {
      mockGetById.mockResolvedValue({ ...mockExecution, status: 'completed' })

      render(
        <AgentDetailSidebar executionId="exec-001" isOpen={true} onClose={vi.fn()} />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('follow-up-button'))

      await waitFor(() => {
        expect(screen.getByTestId('follow-up-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('follow-up-submit'))

      await waitFor(() => {
        expect(mockCreateFollowUp).toHaveBeenCalledWith('exec-001', { feedback: 'Test feedback' })
      })
    })
  })
})

describe('SidebarBackdrop', () => {
  it('should render when open', () => {
    render(<SidebarBackdrop isOpen={true} onClick={vi.fn()} />)

    expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument()
  })

  it('should not render when closed', () => {
    render(<SidebarBackdrop isOpen={false} onClick={vi.fn()} />)

    expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    const onClick = vi.fn()

    render(<SidebarBackdrop isOpen={true} onClick={onClick} />)

    fireEvent.click(screen.getByTestId('sidebar-backdrop'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
