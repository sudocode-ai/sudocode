import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipForm } from '@/components/relationships/RelationshipForm'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Issue, Spec } from '@/types/api'

// Mock the hooks
vi.mock('@/hooks/useIssues', () => ({
  useIssues: vi.fn(() => ({
    issues: [
      { id: 'i-001', title: 'Test Issue 1' },
      { id: 'i-002', title: 'Test Issue 2' },
      { id: 'i-003', title: 'Another Issue' },
    ] as Issue[],
    isLoading: false,
  })),
}))

vi.mock('@/hooks/useSpecs', () => ({
  useSpecs: vi.fn(() => ({
    specs: [
      { id: 's-001', title: 'Test Spec 1' },
      { id: 's-002', title: 'Test Spec 2' },
      { id: 's-003', title: 'Another Spec' },
    ] as Spec[],
    isLoading: false,
  })),
}))

// Mock WebSocket context
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn(),
    removeMessageHandler: vi.fn(),
  }),
}))

describe('RelationshipForm', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    )
  }

  // Helper to get the entity combobox button
  const getEntityCombobox = () => {
    // Find the button with either "Search issues", "Search specs", or a selected entity text
    const buttons = screen.getAllByRole('combobox')
    // The entity combobox is the one that is NOT the entity type select (Issue/Spec dropdown)
    // and NOT the relationship type select
    // It should contain text like "Search issues", "Search specs", or "i-xxx - ..."
    return buttons.find(
      (btn) =>
        btn.textContent?.includes('Search issues') ||
        btn.textContent?.includes('Search specs') ||
        /[is]-\d{3}/.test(btn.textContent || '')
    ) as HTMLElement
  }

  describe('rendering', () => {
    it('should render form with all fields', () => {
      const onSubmit = vi.fn()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      expect(screen.getByText('Target Entity')).toBeInTheDocument()
      expect(screen.getByText('Relationship Type')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Create/i })).toBeInTheDocument()
    })

    it('should render as a card by default', () => {
      const onSubmit = vi.fn()
      const { container } = renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Card wrapper should exist
      const card = container.querySelector('.p-4')
      expect(card).toBeInTheDocument()
    })

    it('should render inline when inline prop is true', () => {
      const onSubmit = vi.fn()
      const { container } = renderWithClient(<RelationshipForm onSubmit={onSubmit} inline={true} />)

      // Card wrapper should not exist
      const card = container.querySelector('.p-4')
      expect(card).not.toBeInTheDocument()
    })

    it('should show cancel button when onCancel is provided', () => {
      const onSubmit = vi.fn()
      const onCancel = vi.fn()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} onCancel={onCancel} />)

      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('should not show cancel button when onCancel is not provided', () => {
      const onSubmit = vi.fn()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()
    })
  })

  describe('entity combobox', () => {
    it('should show placeholder for issue by default', () => {
      const onSubmit = vi.fn()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      expect(screen.getByText(/Search issues/i)).toBeInTheDocument()
    })

    it('should open dropdown and show issues when clicked', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Click the entity combobox trigger (the one showing "Search issues...")
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)

      // Should show issues in dropdown
      await waitFor(() => {
        expect(screen.getByText('i-001')).toBeInTheDocument()
        expect(screen.getByText('Test Issue 1')).toBeInTheDocument()
        expect(screen.getByText('i-002')).toBeInTheDocument()
        expect(screen.getByText('Test Issue 2')).toBeInTheDocument()
      })
    })

    it('should filter issues based on search input', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Open the combobox
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)

      // Type in search input
      const searchInput = screen.getByPlaceholderText(/Search issues/i)
      await user.type(searchInput, 'Another')

      // Should only show the matching issue
      await waitFor(() => {
        expect(screen.getByText('i-003')).toBeInTheDocument()
        expect(screen.queryByText('i-001')).not.toBeInTheDocument()
        expect(screen.queryByText('i-002')).not.toBeInTheDocument()
      })
    })

    it('should select an entity when clicked', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Open the combobox
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)

      // Click on an issue
      const issue = screen.getByText('i-001')
      await user.click(issue)

      // Should close dropdown and show selected value
      await waitFor(() => {
        const combobox = getEntityCombobox()
        expect(combobox.textContent).toContain('i-001')
        expect(combobox.textContent).toContain('Test Issue 1')
      })
    })
  })

  describe('entity type selection', () => {
    it('should change to specs when spec type is selected', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Initially should show issue placeholder
      expect(screen.getByText(/Search issues/i)).toBeInTheDocument()

      // Click the entity type select
      const selectTriggers = screen.getAllByRole('combobox')
      const entityTypeSelect = selectTriggers.find((el) =>
        el.textContent?.includes('Issue') || el.textContent?.includes('Spec')
      )
      await user.click(entityTypeSelect!)

      // Click on Spec option
      const specOption = screen.getByRole('option', { name: /Spec/i })
      await user.click(specOption)

      // Should now show spec placeholder
      await waitFor(() => {
        expect(screen.getByText(/Search specs/i)).toBeInTheDocument()
      })
    })

    it('should show specs in dropdown when spec type is selected', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Change to spec type
      const selectTriggers = screen.getAllByRole('combobox')
      const entityTypeSelect = selectTriggers.find((el) =>
        el.textContent?.includes('Issue') || el.textContent?.includes('Spec')
      )
      await user.click(entityTypeSelect!)
      const specOption = screen.getByRole('option', { name: /Spec/i })
      await user.click(specOption)

      // Open the entity combobox
      await waitFor(() => {
        expect(screen.getByText(/Search specs/i)).toBeInTheDocument()
      })

      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)

      // Should show specs in dropdown
      await waitFor(() => {
        expect(screen.getByText('s-001')).toBeInTheDocument()
        expect(screen.getByText('Test Spec 1')).toBeInTheDocument()
      })
    })

    it('should clear selection when entity type is changed', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Select an issue
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const issue = screen.getByText('i-001')
      await user.click(issue)

      // Verify selection
      await waitFor(() => {
        const combobox = getEntityCombobox()
        expect(combobox.textContent).toContain('i-001')
      })

      // Change entity type to spec
      const selectTriggers = screen.getAllByRole('combobox')
      const entityTypeSelect = selectTriggers.find((el) =>
        el.textContent?.includes('Issue') || el.textContent?.includes('Spec')
      )
      await user.click(entityTypeSelect!)
      const specOption = screen.getByRole('option', { name: /Spec/i })
      await user.click(specOption)

      // Selection should be cleared
      await waitFor(() => {
        expect(screen.getByText(/Search specs/i)).toBeInTheDocument()
        const combobox = getEntityCombobox()
        expect(combobox.textContent).not.toContain('i-001')
      })
    })
  })

  describe('relationship type selection', () => {
    it('should default to "related" type', () => {
      const onSubmit = vi.fn()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // The relationship type select (with id="relationship-type") should show default value "Related to"
      const relationshipTypeSelect = screen.getByRole('combobox', { name: /relationship type/i })
      expect(relationshipTypeSelect).toBeInTheDocument()
      expect(relationshipTypeSelect.textContent).toContain('Related to')
    })

    it('should allow changing relationship type', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Find and click the relationship type select
      const relationshipTypeSelect = screen.getByRole('combobox', { name: /relationship type/i })
      await user.click(relationshipTypeSelect)

      // Should show all relationship types
      expect(screen.getByRole('option', { name: /Blocks/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Related to/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Discovered from/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Implements/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /References/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Depends on/i })).toBeInTheDocument()
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with correct parameters when form is submitted', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Select an issue
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const issue = screen.getByText('i-002')
      await user.click(issue)

      // Submit the form
      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('i-002', 'issue', 'related')
      })
    })

    it('should reset form after successful submission', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Select an issue
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const issue = screen.getByText('i-002')
      await user.click(issue)

      // Submit
      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })

      // Form should be reset - should show placeholder again
      await waitFor(() => {
        expect(screen.getByText(/Search issues/i)).toBeInTheDocument()
      })
    })

    it('should disable submit button when target ID is empty', () => {
      const onSubmit = vi.fn()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      const submitButton = screen.getByRole('button', { name: /Create/i })
      expect(submitButton).toBeDisabled()
    })

    it('should enable submit button when target ID is provided', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Select an issue
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const issue = screen.getByText('i-002')
      await user.click(issue)

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled()
      })
    })

    it('should disable inputs during submission', async () => {
      const onSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)))
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Select an issue
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const issue = screen.getByText('i-002')
      await user.click(issue)

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      // During submission, buttons should be disabled
      expect(submitButton).toBeDisabled()

      // Wait for submission to complete
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  describe('cancel functionality', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const onSubmit = vi.fn()
      const onCancel = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} onCancel={onCancel} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      await user.click(cancelButton)

      expect(onCancel).toHaveBeenCalled()
    })

    it('should disable cancel button during submission', async () => {
      const onSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)))
      const onCancel = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} onCancel={onCancel} />)

      // Select an issue
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const issue = screen.getByText('i-002')
      await user.click(issue)

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      // Cancel button should be disabled during submission
      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      expect(cancelButton).toBeDisabled()

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  describe('integration tests', () => {
    it('should submit with spec type and implements relationship', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // Change to spec type
      const selectTriggers = screen.getAllByRole('combobox')
      const entityTypeSelect = selectTriggers.find((el) =>
        el.textContent?.includes('Issue') || el.textContent?.includes('Spec')
      )
      await user.click(entityTypeSelect!)
      const specOption = screen.getByRole('option', { name: /Spec/i })
      await user.click(specOption)

      // Select a spec
      await waitFor(() => {
        expect(screen.getByText(/Search specs/i)).toBeInTheDocument()
      })
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      const spec = await screen.findByText('s-002')
      await user.click(spec)

      // Change relationship type to implements
      const relationshipTypeSelect = screen.getByRole('combobox', { name: /relationship type/i })
      await user.click(relationshipTypeSelect)
      const implementsOption = screen.getByRole('option', { name: /Implements/i })
      await user.click(implementsOption)

      // Submit
      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('s-002', 'spec', 'implements')
      })
    })

    it('should handle multiple form submissions', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm onSubmit={onSubmit} />)

      // First submission
      let comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      let issue = screen.getByText('i-002')
      await user.click(issue)

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('i-002', 'issue', 'related')
      })

      // Form should be reset
      await waitFor(() => {
        expect(screen.getByText(/Search issues/i)).toBeInTheDocument()
      })

      // Second submission
      comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)
      issue = screen.getByText('i-003')
      await user.click(issue)
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('i-003', 'issue', 'related')
      })

      expect(onSubmit).toHaveBeenCalledTimes(2)
    })

    it('should filter out the current entity from the list', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      renderWithClient(<RelationshipForm fromId="i-002" onSubmit={onSubmit} />)

      // Open the combobox
      const comboboxTrigger = getEntityCombobox()
      await user.click(comboboxTrigger)

      // Should show issues except i-002
      await waitFor(() => {
        expect(screen.getByText('i-001')).toBeInTheDocument()
        expect(screen.queryByText('i-002')).not.toBeInTheDocument()
        expect(screen.getByText('i-003')).toBeInTheDocument()
      })
    })
  })
})
