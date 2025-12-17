import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { RefreshConflictDialog } from '@/components/import/RefreshConflictDialog'
import type { FieldChange } from '@/components/import/RefreshConflictDialog'

describe('RefreshConflictDialog', () => {
  const mockChanges: FieldChange[] = [
    {
      field: 'title',
      localValue: 'Local Title',
      remoteValue: 'Remote Title',
    },
    {
      field: 'content',
      localValue: 'Local content that is different',
      remoteValue: 'Remote content that was updated',
    },
  ]

  const defaultProps = {
    open: true,
    changes: mockChanges,
    onKeepLocal: vi.fn(),
    onOverwrite: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display dialog when open', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Refresh Conflict')).toBeInTheDocument()
    })
  })

  it('should not display dialog when closed', () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} open={false} />)

    expect(screen.queryByText('Refresh Conflict')).not.toBeInTheDocument()
  })

  it('should display all changed fields', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('title')).toBeInTheDocument()
      expect(screen.getByText('content')).toBeInTheDocument()
    })
  })

  it('should show truncated preview of changes', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} />)

    // Truncated values should be visible
    await waitFor(() => {
      expect(screen.getByText(/Local Title/)).toBeInTheDocument()
      expect(screen.getByText(/Remote Title/)).toBeInTheDocument()
    })
  })

  it('should expand change details when clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RefreshConflictDialog {...defaultProps} />)

    // Wait for dialog to render
    await waitFor(() => {
      expect(screen.getByText('title')).toBeInTheDocument()
    })

    // Click on the title field to expand
    await user.click(screen.getByText('title'))

    // Should now show the full details
    await waitFor(() => {
      expect(screen.getByText('Local (will be lost)')).toBeInTheDocument()
      expect(screen.getByText('Remote (will be applied)')).toBeInTheDocument()
    })
  })

  it('should show lines changed badge for content field', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} />)

    // Content field should show lines changed
    await waitFor(() => {
      expect(screen.getByText(/lines/)).toBeInTheDocument()
    })
  })

  it('should call onKeepLocal when Keep Local button clicked', async () => {
    const user = userEvent.setup()
    const onKeepLocal = vi.fn()
    renderWithProviders(<RefreshConflictDialog {...defaultProps} onKeepLocal={onKeepLocal} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep Local' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Keep Local' }))

    expect(onKeepLocal).toHaveBeenCalledTimes(1)
  })

  it('should call onOverwrite when Overwrite button clicked', async () => {
    const user = userEvent.setup()
    const onOverwrite = vi.fn()
    renderWithProviders(<RefreshConflictDialog {...defaultProps} onOverwrite={onOverwrite} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Overwrite with Remote' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Overwrite with Remote' }))

    expect(onOverwrite).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when Cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderWithProviders(<RefreshConflictDialog {...defaultProps} onCancel={onCancel} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should disable buttons when isOverwriting is true', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} isOverwriting />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Keep Local' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Overwriting...' })).toBeDisabled()
    })
  })

  it('should display Overwriting... text when isOverwriting', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} isOverwriting />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Overwriting...' })).toBeInTheDocument()
    })
  })

  it('should handle empty changes array', async () => {
    renderWithProviders(<RefreshConflictDialog {...defaultProps} changes={[]} />)

    await waitFor(() => {
      expect(screen.getByText('Refresh Conflict')).toBeInTheDocument()
    })
    // Should still render without crashing
  })

  it('should show (empty) for empty field values', async () => {
    const user = userEvent.setup()
    const changesWithEmpty: FieldChange[] = [
      {
        field: 'content',
        localValue: '',
        remoteValue: 'New content',
      },
    ]
    renderWithProviders(<RefreshConflictDialog {...defaultProps} changes={changesWithEmpty} />)

    // Wait for dialog to render
    await waitFor(() => {
      expect(screen.getByText('content')).toBeInTheDocument()
    })

    // Expand the content field
    await user.click(screen.getByText('content'))

    await waitFor(() => {
      expect(screen.getByText('(empty)')).toBeInTheDocument()
    })
  })
})
