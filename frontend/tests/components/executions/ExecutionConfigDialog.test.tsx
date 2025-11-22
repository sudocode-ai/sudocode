import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionConfigDialog } from '@/components/executions/ExecutionConfigDialog'
import { executionsApi } from '@/lib/api'
import type { ExecutionPrepareResult } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  executionsApi: {
    prepare: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    createFollowUp: vi.fn(),
    cancel: vi.fn(),
  },
}))

describe('ExecutionConfigDialog', () => {
  const mockOnStart = vi.fn()
  const mockOnCancel = vi.fn()

  const mockPrepareResult: ExecutionPrepareResult = {
    renderedPrompt: 'Test prompt for ISSUE-001',
    issue: {
      id: 'ISSUE-001',
      title: 'Test Issue',
      description: 'Test description',
    },
    relatedSpecs: [
      { id: 'SPEC-001', title: 'Test Spec' },
    ],
    relatedFeedback: [
      { issueId: 'ISSUE-002', content: 'Test feedback' },
    ],
    defaultConfig: {
      mode: 'worktree',
      baseBranch: 'main',
      cleanupMode: 'auto',
      model: 'claude-sonnet-4',
    },
    availableModels: ['claude-sonnet-4', 'claude-opus-4'],
    availableBranches: ['main', 'develop'],
    warnings: [],
    errors: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executionsApi.prepare).mockResolvedValue(mockPrepareResult)
  })

  it('should not render when open is false', () => {
    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={false}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.queryByText('Configure Agent Execution')).not.toBeInTheDocument()
  })

  it('should render when open is true', () => {
    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByText('Configure Agent Execution')).toBeInTheDocument()
  })

  it('should load template preview when dialog opens', async () => {
    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(executionsApi.prepare).toHaveBeenCalledWith('ISSUE-001')
    })

    await waitFor(() => {
      expect(screen.getByText(/Test prompt for ISSUE-001/)).toBeInTheDocument()
    })
  })

  it('should display loading state while preparing', () => {
    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByText('Loading template...')).toBeInTheDocument()
  })

  it('should display related context information', async () => {
    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Context Included/)).toBeInTheDocument()
    })

    expect(screen.getByText(/1 related spec\(s\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 feedback item\(s\)/)).toBeInTheDocument()
  })

  it('should display warnings when present', async () => {
    vi.mocked(executionsApi.prepare).mockResolvedValue({
      ...mockPrepareResult,
      warnings: ['Uncommitted changes detected'],
    })

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Warnings')).toBeInTheDocument()
      expect(screen.getByText('Uncommitted changes detected')).toBeInTheDocument()
    })
  })

  it('should display errors when present', async () => {
    vi.mocked(executionsApi.prepare).mockResolvedValue({
      ...mockPrepareResult,
      errors: ['No base branch configured'],
    })

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Errors')).toBeInTheDocument()
      expect(screen.getByText('No base branch configured')).toBeInTheDocument()
    })
  })

  it('should disable start button when errors are present', async () => {
    vi.mocked(executionsApi.prepare).mockResolvedValue({
      ...mockPrepareResult,
      errors: ['No base branch configured'],
    })

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      const startButton = screen.getByRole('button', { name: /Start Agent/ })
      expect(startButton).toBeDisabled()
    })
  })

  it('should allow editing the prompt', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Test prompt for ISSUE-001/)).toBeInTheDocument()
    })

    const promptTextarea = screen.getByLabelText('Prompt')
    await user.clear(promptTextarea)
    await user.type(promptTextarea, 'Modified prompt text')

    expect(promptTextarea).toHaveValue('Modified prompt text')
  })

  it('should call onStart with config and prompt when start button clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Test prompt for ISSUE-001/)).toBeInTheDocument()
    })

    const startButton = screen.getByRole('button', { name: /Start Agent/ })
    await user.click(startButton)

    expect(mockOnStart).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'worktree',
        cleanupMode: 'auto',
      }),
      'Test prompt for ISSUE-001'
    )
  })

  it('should call onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Configure Agent Execution/)).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should show advanced options when toggled', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Advanced Options/)).toBeInTheDocument()
    })

    // Advanced options should not be visible initially
    expect(screen.queryByLabelText('Timeout (ms)')).not.toBeInTheDocument()

    // Click to show advanced options
    const advancedToggle = screen.getByText(/Advanced Options/)
    await user.click(advancedToggle)

    // Now advanced options should be visible
    expect(screen.getByLabelText('Timeout (ms)')).toBeInTheDocument()
    expect(screen.getByLabelText('Max Tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Temperature')).toBeInTheDocument()
  })

  it('should disable start button when prompt is empty', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Test prompt for ISSUE-001/)).toBeInTheDocument()
    })

    // Clear the prompt
    const promptTextarea = screen.getByLabelText('Prompt')
    await user.clear(promptTextarea)

    // Start button should be disabled
    const startButton = screen.getByRole('button', { name: /Start Agent/ })
    expect(startButton).toBeDisabled()
  })

  it('should handle API error gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(executionsApi.prepare).mockRejectedValue(new Error('API Error'))

    renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to prepare execution:',
        expect.any(Error)
      )
    })

    consoleErrorSpy.mockRestore()
  })

  it('should reload template when dialog is reopened', async () => {
    const { rerender } = renderWithProviders(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(executionsApi.prepare).toHaveBeenCalledTimes(1)
    })

    // Close dialog
    rerender(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={false}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    // Reopen dialog
    rerender(
      <ExecutionConfigDialog
        issueId="ISSUE-001"
        open={true}
        onStart={mockOnStart}
        onCancel={mockOnCancel}
      />
    )

    await waitFor(() => {
      expect(executionsApi.prepare).toHaveBeenCalledTimes(2)
    })
  })
})
