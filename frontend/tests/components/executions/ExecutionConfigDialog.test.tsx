import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionConfigDialog } from '@/components/executions/ExecutionConfigDialog'
import { executionsApi } from '@/lib/api'
import type { ExecutionPrepareResult } from '@/types/execution'

// Mock the API
vi.mock('@/lib/api', () => ({
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

  describe('CLI Execution Mode Selection', () => {
    it('should default to structured mode', async () => {
      renderWithProviders(
        <ExecutionConfigDialog
          issueId="ISSUE-001"
          open={true}
          onStart={mockOnStart}
          onCancel={mockOnCancel}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Should show structured mode as default
      const modeSelector = screen.getByLabelText('CLI Execution Mode')
      expect(modeSelector).toBeInTheDocument()
    })

    it('should not show terminal config for structured mode', async () => {
      renderWithProviders(
        <ExecutionConfigDialog
          issueId="ISSUE-001"
          open={true}
          onStart={mockOnStart}
          onCancel={mockOnCancel}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Terminal configuration should not be visible for structured mode
      expect(screen.queryByText('Terminal Configuration')).not.toBeInTheDocument()
    })

    it('should show terminal config when interactive mode is selected', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Find and click the execution mode selector
      const modeButton = screen.getByRole('combobox', { name: /CLI Execution Mode/i })
      await user.click(modeButton)

      // Select interactive mode
      const interactiveOption = screen.getByRole('option', { name: /Interactive/ })
      await user.click(interactiveOption)

      // Terminal configuration should now be visible
      await waitFor(() => {
        expect(screen.getByText('Terminal Configuration')).toBeInTheDocument()
        expect(screen.getByLabelText('Columns')).toBeInTheDocument()
        expect(screen.getByLabelText('Rows')).toBeInTheDocument()
      })
    })

    it('should show terminal config when hybrid mode is selected', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Find and click the execution mode selector
      const modeButton = screen.getByRole('combobox', { name: /CLI Execution Mode/i })
      await user.click(modeButton)

      // Select hybrid mode
      const hybridOption = screen.getByRole('option', { name: /Hybrid/ })
      await user.click(hybridOption)

      // Terminal configuration should now be visible
      await waitFor(() => {
        expect(screen.getByText('Terminal Configuration')).toBeInTheDocument()
        expect(screen.getByLabelText('Columns')).toBeInTheDocument()
        expect(screen.getByLabelText('Rows')).toBeInTheDocument()
      })
    })

    it('should validate terminal config columns', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Switch to interactive mode
      const modeButton = screen.getByRole('combobox', { name: /CLI Execution Mode/i })
      await user.click(modeButton)
      const interactiveOption = screen.getByRole('option', { name: /Interactive/ })
      await user.click(interactiveOption)

      await waitFor(() => {
        expect(screen.getByText('Terminal Configuration')).toBeInTheDocument()
      })

      // Enter invalid columns (too small)
      const colsInput = screen.getByLabelText('Columns')
      await user.clear(colsInput)
      await user.type(colsInput, '5')

      // Should show validation error
      await waitFor(() => {
        expect(screen.getByText(/Columns must be an integer between 20 and 500/)).toBeInTheDocument()
      })

      // Start button should be disabled
      const startButton = screen.getByRole('button', { name: /Start Agent/ })
      expect(startButton).toBeDisabled()
    })

    it('should validate terminal config rows', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Switch to interactive mode
      const modeButton = screen.getByRole('combobox', { name: /CLI Execution Mode/i })
      await user.click(modeButton)
      const interactiveOption = screen.getByRole('option', { name: /Interactive/ })
      await user.click(interactiveOption)

      await waitFor(() => {
        expect(screen.getByText('Terminal Configuration')).toBeInTheDocument()
      })

      // Enter invalid rows (too large)
      const rowsInput = screen.getByLabelText('Rows')
      await user.clear(rowsInput)
      await user.type(rowsInput, '150')

      // Should show validation error
      await waitFor(() => {
        expect(screen.getByText(/Rows must be an integer between 10 and 100/)).toBeInTheDocument()
      })

      // Start button should be disabled
      const startButton = screen.getByRole('button', { name: /Start Agent/ })
      expect(startButton).toBeDisabled()
    })

    it('should include execution_mode in config when starting', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Switch to hybrid mode
      const modeButton = screen.getByRole('combobox', { name: /CLI Execution Mode/i })
      await user.click(modeButton)
      const hybridOption = screen.getByRole('option', { name: /Hybrid/ })
      await user.click(hybridOption)

      await waitFor(() => {
        expect(screen.getByText('Terminal Configuration')).toBeInTheDocument()
      })

      // Click start
      const startButton = screen.getByRole('button', { name: /Start Agent/ })
      await user.click(startButton)

      // Should include execution_mode and terminal_config in the config
      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_mode: 'hybrid',
          terminal_config: expect.objectContaining({
            cols: expect.any(Number),
            rows: expect.any(Number),
          }),
        }),
        expect.any(String)
      )
    })

    it('should not include terminal_config for structured mode', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Structured is default, just click start
      const startButton = screen.getByRole('button', { name: /Start Agent/ })
      await user.click(startButton)

      // Should not include terminal_config for structured mode
      expect(mockOnStart).toHaveBeenCalledWith(
        expect.not.objectContaining({
          terminal_config: expect.anything(),
        }),
        expect.any(String)
      )
    })

    it('should show contextual help text for each mode', async () => {
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
        expect(screen.getByText(/CLI Execution Mode/)).toBeInTheDocument()
      })

      // Structured mode help (default)
      expect(screen.getByText(/Recommended for automated workflows and background executions/)).toBeInTheDocument()

      // Switch to interactive mode
      const modeButton = screen.getByRole('combobox', { name: /CLI Execution Mode/i })
      await user.click(modeButton)
      const interactiveOption = screen.getByRole('option', { name: /Interactive/ })
      await user.click(interactiveOption)

      // Interactive mode help
      await waitFor(() => {
        expect(screen.getByText(/Recommended when you need to respond to prompts or see colorful output/)).toBeInTheDocument()
      })

      // Switch to hybrid mode
      await user.click(modeButton)
      const hybridOption = screen.getByRole('option', { name: /Hybrid/ })
      await user.click(hybridOption)

      // Hybrid mode help
      await waitFor(() => {
        expect(screen.getByText(/Best of both worlds - structured parsing with live terminal view/)).toBeInTheDocument()
      })
    })
  })
})
