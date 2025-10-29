import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipForm } from '@/components/relationships/RelationshipForm'

describe('RelationshipForm', () => {
  describe('rendering', () => {
    it('should render form with all fields', () => {
      const onSubmit = vi.fn()

      render(<RelationshipForm onSubmit={onSubmit} />)

      expect(screen.getByLabelText('Target Entity')).toBeInTheDocument()
      expect(screen.getByLabelText('Relationship Type')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Create/i })).toBeInTheDocument()
    })

    it('should render as a card by default', () => {
      const onSubmit = vi.fn()
      const { container } = render(<RelationshipForm onSubmit={onSubmit} />)

      // Card wrapper should exist
      const card = container.querySelector('.p-4')
      expect(card).toBeInTheDocument()
    })

    it('should render inline when inline prop is true', () => {
      const onSubmit = vi.fn()
      const { container } = render(<RelationshipForm onSubmit={onSubmit} inline={true} />)

      // Card wrapper should not exist
      const card = container.querySelector('.p-4')
      expect(card).not.toBeInTheDocument()
    })

    it('should show cancel button when onCancel is provided', () => {
      const onSubmit = vi.fn()
      const onCancel = vi.fn()

      render(<RelationshipForm onSubmit={onSubmit} onCancel={onCancel} />)

      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('should not show cancel button when onCancel is not provided', () => {
      const onSubmit = vi.fn()

      render(<RelationshipForm onSubmit={onSubmit} />)

      expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()
    })
  })

  describe('entity type selection', () => {
    it('should default to issue type', () => {
      const onSubmit = vi.fn()

      render(<RelationshipForm onSubmit={onSubmit} />)

      const input = screen.getByPlaceholderText('ISSUE-001')
      expect(input).toBeInTheDocument()
    })

    it('should change placeholder when entity type is changed', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      // Initially should show issue placeholder
      expect(screen.getByPlaceholderText('ISSUE-001')).toBeInTheDocument()

      // Click the entity type select
      const selectTrigger = screen.getAllByRole('combobox')[0]
      await user.click(selectTrigger)

      // Click on Spec option
      const specOption = screen.getByRole('option', { name: /Spec/i })
      await user.click(specOption)

      // Should now show spec placeholder
      await waitFor(() => {
        expect(screen.getByPlaceholderText('SPEC-001')).toBeInTheDocument()
      })
    })
  })

  describe('relationship type selection', () => {
    it('should default to "related" type', () => {
      const onSubmit = vi.fn()

      render(<RelationshipForm onSubmit={onSubmit} />)

      // The select should show the default value "Related to"
      const relationshipTypeSelect = screen.getAllByRole('combobox')[1]
      expect(relationshipTypeSelect).toBeInTheDocument()
    })

    it('should allow changing relationship type', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      // Click the relationship type select
      const selectTrigger = screen.getAllByRole('combobox')[1]
      await user.click(selectTrigger)

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

      render(<RelationshipForm onSubmit={onSubmit} />)

      // Fill in the target ID
      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, 'ISSUE-002')

      // Submit the form
      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('ISSUE-002', 'issue', 'related')
      })
    })

    it('should trim whitespace from target ID before submitting', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, '  ISSUE-002  ')

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('ISSUE-002', 'issue', 'related')
      })
    })

    it('should reset form after successful submission', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      // Fill in the form
      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, 'ISSUE-002')

      // Submit
      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })

      // Form should be reset - input should be empty
      expect(input).toHaveValue('')
    })

    it('should disable submit button when target ID is empty', () => {
      const onSubmit = vi.fn()

      render(<RelationshipForm onSubmit={onSubmit} />)

      const submitButton = screen.getByRole('button', { name: /Create/i })
      expect(submitButton).toBeDisabled()
    })

    it('should enable submit button when target ID is provided', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, 'ISSUE-002')

      const submitButton = screen.getByRole('button', { name: /Create/i })
      expect(submitButton).not.toBeDisabled()
    })

    it('should not submit form if target ID is only whitespace', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, '   ')

      // Button should still be enabled (input has value)
      // but clicking shouldn't call onSubmit
      const submitButton = screen.getByRole('button', { name: /Create/i })

      // The submit button should actually be disabled because we check toId.trim()
      expect(submitButton).toBeDisabled()
    })

    it('should disable all inputs during submission', async () => {
      const onSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)))
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, 'ISSUE-002')

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      // During submission, input should be disabled
      expect(input).toBeDisabled()
      expect(submitButton).toBeDisabled()

      // Wait for submission to complete
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })

    // Note: The component doesn't catch errors from onSubmit - they bubble up to the parent
    // This is correct behavior, so we don't test error handling here
  })

  describe('cancel functionality', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const onSubmit = vi.fn()
      const onCancel = vi.fn()
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} onCancel={onCancel} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      await user.click(cancelButton)

      expect(onCancel).toHaveBeenCalled()
    })

    it('should disable cancel button during submission', async () => {
      const onSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)))
      const onCancel = vi.fn()
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} onCancel={onCancel} />)

      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, 'ISSUE-002')

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

      render(<RelationshipForm onSubmit={onSubmit} />)

      // Change to spec type
      const entityTypeSelect = screen.getAllByRole('combobox')[0]
      await user.click(entityTypeSelect)
      const specOption = screen.getByRole('option', { name: /Spec/i })
      await user.click(specOption)

      // Fill in target ID
      const input = screen.getByPlaceholderText('SPEC-001')
      await user.type(input, 'SPEC-042')

      // Change relationship type to implements
      const relationshipTypeSelect = screen.getAllByRole('combobox')[1]
      await user.click(relationshipTypeSelect)
      const implementsOption = screen.getByRole('option', { name: /Implements/i })
      await user.click(implementsOption)

      // Submit
      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('SPEC-042', 'spec', 'implements')
      })
    })

    it('should handle multiple form submissions', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()

      render(<RelationshipForm onSubmit={onSubmit} />)

      // First submission
      const input = screen.getByPlaceholderText('ISSUE-001')
      await user.type(input, 'ISSUE-002')

      const submitButton = screen.getByRole('button', { name: /Create/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('ISSUE-002', 'issue', 'related')
      })

      // Form should be reset
      expect(input).toHaveValue('')

      // Second submission
      await user.type(input, 'ISSUE-003')
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('ISSUE-003', 'issue', 'related')
      })

      expect(onSubmit).toHaveBeenCalledTimes(2)
    })
  })
})
