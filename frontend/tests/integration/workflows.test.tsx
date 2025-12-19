/**
 * Workflow Integration Tests
 *
 * Tests the complete workflow frontend flow:
 * - Listing workflows
 * - Workflow lifecycle actions (start, pause, resume, cancel)
 * - API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import WorkflowsPage from '@/pages/WorkflowsPage'
import WorkflowDetailPage from '@/pages/WorkflowDetailPage'
import type { Workflow, WorkflowStep } from '@/types/workflow'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  workflowsApi: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    retryStep: vi.fn(),
    skipStep: vi.fn(),
    getEvents: vi.fn(),
  },
  issuesApi: {
    getAll: vi.fn(),
  },
  specsApi: {
    getAll: vi.fn(),
  },
  repositoryApi: {
    getInfo: vi.fn(),
    getBranches: vi.fn(),
    listWorktrees: vi.fn(),
    previewWorktreeSync: vi.fn(),
  },
}))


// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Import mocked API after vi.mock
import { workflowsApi, issuesApi, specsApi, repositoryApi } from '@/lib/api'

// =============================================================================
// Test Data
// =============================================================================

const mockSteps: WorkflowStep[] = [
  {
    id: 'step-1',
    issueId: 'i-abc1',
    status: 'completed',
    index: 0,
    dependencies: [],
    executionId: 'exec-1',
  },
  {
    id: 'step-2',
    issueId: 'i-abc2',
    status: 'running',
    index: 1,
    dependencies: ['step-1'],
    executionId: 'exec-2',
  },
  {
    id: 'step-3',
    issueId: 'i-abc3',
    status: 'pending',
    index: 2,
    dependencies: ['step-2'],
  },
]

const mockWorkflows: Workflow[] = [
  {
    id: 'wf-001',
    title: 'Implement User Authentication',
    source: {
      type: 'goal',
      goal: 'Add user authentication to the app',
    },
    status: 'running',
    steps: mockSteps,
    baseBranch: 'main',
    currentStepIndex: 1,
    config: {
      engineType: 'sequential',
      parallelism: 'sequential',
      onFailure: 'pause',
      autoCommitAfterStep: true,
      defaultAgentType: 'claude-code',
      autonomyLevel: 'human_in_the_loop',
    },
    createdAt: '2025-01-15T09:00:00Z',
    updatedAt: '2025-01-15T10:05:00Z',
    startedAt: '2025-01-15T10:00:00Z',
  },
  {
    id: 'wf-002',
    title: 'Add Dark Mode',
    source: {
      type: 'spec',
      specId: 's-dark',
    },
    status: 'pending',
    steps: [
      {
        id: 'step-dm-1',
        issueId: 'i-dm1',
        status: 'pending',
        index: 0,
        dependencies: [],
      },
    ],
    baseBranch: 'main',
    currentStepIndex: 0,
    config: {
      engineType: 'sequential',
      parallelism: 'sequential',
      onFailure: 'pause',
      autoCommitAfterStep: true,
      defaultAgentType: 'claude-code',
      autonomyLevel: 'human_in_the_loop',
    },
    createdAt: '2025-01-15T08:00:00Z',
    updatedAt: '2025-01-15T08:00:00Z',
  },
  {
    id: 'wf-003',
    title: 'Refactor Database Layer',
    source: {
      type: 'goal',
      goal: 'Refactor database to use connection pooling',
    },
    status: 'completed',
    steps: [
      {
        id: 'step-db-1',
        issueId: 'i-db1',
        status: 'completed',
        index: 0,
        dependencies: [],
        executionId: 'exec-db-1',
      },
    ],
    baseBranch: 'main',
    currentStepIndex: 1,
    config: {
      engineType: 'sequential',
      parallelism: 'sequential',
      onFailure: 'pause',
      autoCommitAfterStep: true,
      defaultAgentType: 'claude-code',
      autonomyLevel: 'human_in_the_loop',
    },
    createdAt: '2025-01-14T09:00:00Z',
    updatedAt: '2025-01-14T11:00:00Z',
    startedAt: '2025-01-14T10:00:00Z',
    completedAt: '2025-01-14T11:00:00Z',
  },
]

const mockIssues = [
  { id: 'i-abc1', title: 'Setup auth middleware', status: 'closed' },
  { id: 'i-abc2', title: 'Implement login endpoint', status: 'in_progress' },
  { id: 'i-abc3', title: 'Add session management', status: 'open' },
  { id: 'i-dm1', title: 'Create theme context', status: 'open' },
  { id: 'i-db1', title: 'Add connection pooling', status: 'closed' },
]

const mockSpecs = [
  { id: 's-auth', title: 'Authentication Spec' },
  { id: 's-dark', title: 'Dark Mode Spec' },
]

// =============================================================================
// Test Helpers
// =============================================================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function renderWithAllProviders(
  ui: React.ReactElement,
  { route = '/' }: { route?: string } = {}
) {
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectProvider defaultProjectId="test-project-123" skipValidation={true}>
        <WebSocketProvider>
          <ThemeProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            </TooltipProvider>
          </ThemeProvider>
        </WebSocketProvider>
      </ProjectProvider>
    </QueryClientProvider>
  )
}

function renderWorkflowsPage() {
  return renderWithAllProviders(<WorkflowsPage />)
}

function renderWorkflowDetailPage(workflowId: string) {
  return renderWithAllProviders(
    <Routes>
      <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
    </Routes>,
    { route: `/workflows/${workflowId}` }
  )
}

// =============================================================================
// Tests
// =============================================================================

describe('Workflow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations - always set these to ensure clean state
    vi.mocked(workflowsApi.list).mockImplementation(() => Promise.resolve(mockWorkflows))
    vi.mocked(workflowsApi.get).mockImplementation((id) =>
      Promise.resolve(mockWorkflows.find((w) => w.id === id)!)
    )
    vi.mocked(workflowsApi.getEvents).mockResolvedValue([])
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues as any)
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs as any)
    vi.mocked(repositoryApi.getInfo).mockResolvedValue({
      name: 'test-repo',
      branch: 'main',
      path: '/test/path',
      ownerRepo: 'test-owner/test-repo',
      gitProvider: 'github',
    })
  })

  afterEach(() => {
    // Restore default mock implementations to prevent test pollution
    vi.mocked(workflowsApi.list).mockImplementation(() => Promise.resolve(mockWorkflows))
  })

  // ===========================================================================
  // WorkflowsPage Tests
  // ===========================================================================

  describe('WorkflowsPage - Listing Workflows', () => {
    it('should show loading state when data is loading', () => {
      // Make API hang to simulate loading
      vi.mocked(workflowsApi.list).mockImplementation(() => new Promise(() => {}))

      renderWorkflowsPage()

      expect(screen.getByText(/loading workflows/i)).toBeInTheDocument()
    })

    it('should call list API on mount', async () => {
      renderWorkflowsPage()

      // Verify API is called
      await waitFor(() => {
        expect(workflowsApi.list).toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // WorkflowDetailPage Tests
  // ===========================================================================

  describe('WorkflowDetailPage - Viewing Workflow', () => {
    it('should display workflow details', async () => {
      renderWorkflowDetailPage('wf-001')

      await waitFor(() => {
        expect(screen.getByText('Implement User Authentication')).toBeInTheDocument()
      })

      // Verify API was called
      expect(workflowsApi.get).toHaveBeenCalledWith('wf-001')
    })

    it('should show error for non-existent workflow', async () => {
      vi.mocked(workflowsApi.get).mockRejectedValue(new Error('Not found'))

      renderWorkflowDetailPage('wf-nonexistent')

      await waitFor(() => {
        expect(screen.getByText(/not found|error|failed/i)).toBeInTheDocument()
      })
    })
  })

  describe('WorkflowDetailPage - Lifecycle Actions', () => {
    it('should pause a running workflow', async () => {
      const user = userEvent.setup()
      const { toast } = await import('sonner')

      // Default mock from beforeEach returns mockWorkflows[0] for wf-001 which has status: 'running'
      const pausedWorkflow = { ...mockWorkflows[0], status: 'paused' as const }
      vi.mocked(workflowsApi.pause).mockResolvedValue(pausedWorkflow)

      renderWorkflowDetailPage('wf-001')

      // Wait for workflow to load and controls to appear
      await waitFor(
        () => {
          expect(screen.getByText('Implement User Authentication')).toBeInTheDocument()
        },
        { timeout: 3000 }
      )

      // Now wait for the pause button specifically
      const pauseButton = await screen.findByRole('button', { name: /pause/i })
      await user.click(pauseButton)

      // Verify API was called
      await waitFor(() => {
        expect(workflowsApi.pause).toHaveBeenCalledWith('wf-001')
      })

      // Verify success toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Workflow paused')
      })
    })

    it('should resume a paused workflow', async () => {
      const user = userEvent.setup()
      const { toast } = await import('sonner')

      const pausedWorkflow: Workflow = { ...mockWorkflows[0], status: 'paused' }
      const resumedWorkflow: Workflow = { ...mockWorkflows[0], status: 'running' }

      vi.mocked(workflowsApi.get).mockResolvedValue(pausedWorkflow)
      vi.mocked(workflowsApi.resume).mockResolvedValue(resumedWorkflow)

      renderWorkflowDetailPage('wf-001')

      // Wait for workflow to load and controls to appear
      await waitFor(
        () => {
          expect(screen.getByText('Implement User Authentication')).toBeInTheDocument()
          expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
        },
        { timeout: 3000 }
      )

      // Click resume button to open dialog
      const resumeButton = screen.getByRole('button', { name: /resume/i })
      await user.click(resumeButton)

      // Wait for dialog to appear and click confirm button inside dialog
      const dialogResumeButton = await screen.findByRole('button', { name: /^resume$/i })
      await user.click(dialogResumeButton)

      // Verify API was called
      await waitFor(() => {
        expect(workflowsApi.resume).toHaveBeenCalledWith('wf-001', undefined)
      })

      // Verify success toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Workflow resumed')
      })
    })

    it('should cancel a workflow', async () => {
      const user = userEvent.setup()
      const { toast } = await import('sonner')

      // Default mock from beforeEach returns mockWorkflows[0] for wf-001 which has status: 'running'
      const cancelledWorkflow = { ...mockWorkflows[0], status: 'cancelled' as const }
      vi.mocked(workflowsApi.cancel).mockResolvedValue(cancelledWorkflow)

      renderWorkflowDetailPage('wf-001')

      // Wait for workflow to load
      await waitFor(
        () => {
          expect(screen.getByText('Implement User Authentication')).toBeInTheDocument()
        },
        { timeout: 3000 }
      )

      // Now wait for the cancel button specifically
      const cancelButton = await screen.findByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Verify API was called
      await waitFor(() => {
        expect(workflowsApi.cancel).toHaveBeenCalledWith('wf-001')
      })

      // Verify success toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Workflow cancelled')
      })
    })

    it('should start a pending workflow', async () => {
      const user = userEvent.setup()
      const { toast } = await import('sonner')

      const pendingWorkflow = mockWorkflows[1] // 'Add Dark Mode' is pending
      const startedWorkflow = { ...pendingWorkflow, status: 'running' as const }

      vi.mocked(workflowsApi.get).mockResolvedValue(pendingWorkflow)
      vi.mocked(workflowsApi.start).mockResolvedValue(startedWorkflow)

      renderWorkflowDetailPage('wf-002')

      await waitFor(() => {
        expect(screen.getByText('Add Dark Mode')).toBeInTheDocument()
      })

      // Click start button
      const startButton = screen.getByRole('button', { name: /start/i })
      await user.click(startButton)

      // Verify API was called
      await waitFor(() => {
        expect(workflowsApi.start).toHaveBeenCalledWith('wf-002')
      })

      // Verify success toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Workflow started')
      })
    })
  })

  // ===========================================================================
  // API Integration Tests
  // ===========================================================================

  describe('API Integration', () => {
    it('should call list API on workflows page load', async () => {
      renderWorkflowsPage()

      await waitFor(() => {
        expect(workflowsApi.list).toHaveBeenCalled()
      })
    })

    it('should call get API for workflow detail', async () => {
      renderWorkflowDetailPage('wf-001')

      await waitFor(() => {
        expect(workflowsApi.get).toHaveBeenCalledWith('wf-001')
      })
    })

    it('should call issues API to enrich workflow steps', async () => {
      renderWorkflowDetailPage('wf-001')

      await waitFor(() => {
        expect(issuesApi.getAll).toHaveBeenCalled()
      })
    })

    it('should handle API errors gracefully', async () => {
      vi.mocked(workflowsApi.list).mockRejectedValue(new Error('API Error'))

      renderWorkflowsPage()

      // Should not crash
      await waitFor(() => {
        expect(screen.queryByText(/loading workflows/i)).not.toBeInTheDocument()
      })
    })
  })

})
