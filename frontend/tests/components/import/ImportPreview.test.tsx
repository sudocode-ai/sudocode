import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ImportPreview } from '@/components/import/ImportPreview'
import type { ExternalEntity } from '@/lib/api'

describe('ImportPreview', () => {
  const mockEntity: ExternalEntity = {
    id: 'gh-123',
    type: 'spec',
    title: 'Test Issue Title',
    description: 'This is a test description for the issue.',
    status: 'open',
    priority: 2,
    url: 'https://github.com/owner/repo/issues/123',
  }

  const defaultProps = {
    provider: 'github',
    entity: mockEntity,
    onImport: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display provider name and icon', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })

  it('should display entity title', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    expect(screen.getByText('Test Issue Title')).toBeInTheDocument()
  })

  it('should display entity description', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    expect(screen.getByText('This is a test description for the issue.')).toBeInTheDocument()
  })

  it('should truncate long descriptions', () => {
    const longDescription = 'A'.repeat(600)
    const entityWithLongDesc = { ...mockEntity, description: longDescription }

    renderWithProviders(<ImportPreview {...defaultProps} entity={entityWithLongDesc} />)

    // Should truncate to 500 chars + '...'
    expect(screen.getByText(/A{500}\.\.\./)).toBeInTheDocument()
  })

  it('should display entity status badge', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('should show external link when URL provided', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    const link = document.querySelector('a[href="https://github.com/owner/repo/issues/123"]')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should show comments checkbox when commentsCount > 0', () => {
    renderWithProviders(<ImportPreview {...defaultProps} commentsCount={5} />)

    expect(screen.getByLabelText(/Include 5 comments as feedback/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Include 5 comments/ })).toBeChecked()
  })

  it('should not show comments checkbox when commentsCount is 0', () => {
    renderWithProviders(<ImportPreview {...defaultProps} commentsCount={0} />)

    expect(screen.queryByText(/comments as feedback/)).not.toBeInTheDocument()
  })

  it('should handle singular comment count', () => {
    renderWithProviders(<ImportPreview {...defaultProps} commentsCount={1} />)

    expect(screen.getByLabelText(/Include 1 comment as feedback/)).toBeInTheDocument()
  })

  it('should display priority selector with default value', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    expect(screen.getByLabelText('Priority')).toBeInTheDocument()
    // Default priority from entity is 2 (Medium)
    expect(screen.getByText('Medium (P2)')).toBeInTheDocument()
  })

  it('should allow changing priority', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ImportPreview {...defaultProps} />)

    // Click the trigger button
    const trigger = screen.getByRole('combobox')
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'High (P1)' }))

    expect(screen.getByText('High (P1)')).toBeInTheDocument()
  })

  it('should display tags input', () => {
    renderWithProviders(<ImportPreview {...defaultProps} />)

    expect(screen.getByText('Tags')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Add tags...')).toBeInTheDocument()
  })

  it('should add tags on Enter', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ImportPreview {...defaultProps} />)

    const tagInput = screen.getByPlaceholderText('Add tags...')
    await user.type(tagInput, 'frontend{Enter}')

    expect(screen.getByText('frontend')).toBeInTheDocument()
  })

  it('should remove tags when X clicked', async () => {
    const user = userEvent.setup()

    const { container } = renderWithProviders(<ImportPreview {...defaultProps} />)

    const tagInput = screen.getByPlaceholderText('Add tags...')
    await user.type(tagInput, 'frontend{Enter}')

    expect(screen.getByText('frontend')).toBeInTheDocument()

    // Click the X button inside the badge to remove the tag
    const removeButton = container.querySelector('button svg.h-3')?.parentElement
    if (removeButton) {
      await user.click(removeButton)
    }

    expect(screen.queryByText('frontend')).not.toBeInTheDocument()
  })

  it('should call onImport with options when Import button clicked', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()

    const { container } = renderWithProviders(
      <ImportPreview {...defaultProps} onImport={onImport} commentsCount={3} />
    )

    // Add a tag using the input id
    const tagInput = container.querySelector('#import-tags') as HTMLInputElement
    await user.type(tagInput, 'bug{Enter}')

    // Click import
    await user.click(screen.getByRole('button', { name: 'Import as Spec' }))

    expect(onImport).toHaveBeenCalledWith({
      priority: 2,
      includeComments: true,
      tags: ['bug'],
    })
  })

  it('should call onImport without includeComments when unchecked', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()

    renderWithProviders(
      <ImportPreview {...defaultProps} onImport={onImport} commentsCount={3} />
    )

    // Uncheck comments
    await user.click(screen.getByRole('checkbox', { name: /Include 3 comments/ }))

    // Click import
    await user.click(screen.getByRole('button', { name: 'Import as Spec' }))

    expect(onImport).toHaveBeenCalledWith({
      priority: 2,
    })
  })

  it('should call onCancel when Cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    renderWithProviders(<ImportPreview {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should show loading state when importing', () => {
    renderWithProviders(<ImportPreview {...defaultProps} isImporting={true} />)

    expect(screen.getByRole('button', { name: /Importing\.\.\./ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled()
  })

  it('should disable inputs when importing', () => {
    renderWithProviders(
      <ImportPreview {...defaultProps} isImporting={true} commentsCount={3} />
    )

    expect(screen.getByRole('checkbox', { name: /Include 3 comments/ })).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('should lowercase tags', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()

    renderWithProviders(<ImportPreview {...defaultProps} onImport={onImport} />)

    const tagInput = screen.getByPlaceholderText('Add tags...')
    await user.type(tagInput, 'BUG{Enter}')

    expect(screen.getByText('bug')).toBeInTheDocument()
  })

  it('should not add duplicate tags', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ImportPreview {...defaultProps} />)

    const tagInput = screen.getByPlaceholderText('Add tags...')
    await user.type(tagInput, 'bug{Enter}')
    await user.type(tagInput, 'bug{Enter}')

    // Should only have one 'bug' badge
    const bugBadges = screen.getAllByText('bug')
    expect(bugBadges).toHaveLength(1)
  })
})
