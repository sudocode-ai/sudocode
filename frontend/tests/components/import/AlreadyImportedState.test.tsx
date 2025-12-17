import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { AlreadyImportedState } from '@/components/import/AlreadyImportedState'

describe('AlreadyImportedState', () => {
  const defaultProps = {
    entityId: 's-abc123',
    entityType: 'spec' as const,
    onViewEntity: vi.fn(),
    onRefresh: vi.fn(),
  }

  it('should display already imported message', () => {
    renderWithProviders(<AlreadyImportedState {...defaultProps} />)

    expect(screen.getByText('Already Imported')).toBeInTheDocument()
    expect(screen.getByText(/spec s-abc123/)).toBeInTheDocument()
  })

  it('should display issue type correctly', () => {
    renderWithProviders(
      <AlreadyImportedState {...defaultProps} entityType="issue" entityId="i-xyz789" />
    )

    expect(screen.getByText(/issue i-xyz789/)).toBeInTheDocument()
  })

  it('should display last synced time when provided', () => {
    const lastSyncedAt = new Date(Date.now() - 3600000).toISOString() // 1 hour ago

    renderWithProviders(
      <AlreadyImportedState {...defaultProps} lastSyncedAt={lastSyncedAt} />
    )

    expect(screen.getByText(/last synced/)).toBeInTheDocument()
  })

  it('should not display last synced when not provided', () => {
    renderWithProviders(<AlreadyImportedState {...defaultProps} />)

    expect(screen.queryByText(/last synced/)).not.toBeInTheDocument()
  })

  it('should call onViewEntity when View button clicked', async () => {
    const user = userEvent.setup()
    const onViewEntity = vi.fn()

    renderWithProviders(
      <AlreadyImportedState {...defaultProps} onViewEntity={onViewEntity} />
    )

    await user.click(screen.getByRole('button', { name: /View Spec/ }))

    expect(onViewEntity).toHaveBeenCalledTimes(1)
  })

  it('should display correct view button text for issue', () => {
    renderWithProviders(<AlreadyImportedState {...defaultProps} entityType="issue" />)

    expect(screen.getByRole('button', { name: /View Issue/ })).toBeInTheDocument()
  })

  it('should call onRefresh when Refresh button clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    renderWithProviders(
      <AlreadyImportedState {...defaultProps} onRefresh={onRefresh} />
    )

    await user.click(screen.getByRole('button', { name: /Refresh/ }))

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('should show loading state when refreshing', () => {
    renderWithProviders(<AlreadyImportedState {...defaultProps} isRefreshing={true} />)

    expect(screen.getByRole('button', { name: /Refreshing\.\.\./ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refreshing\.\.\./ })).toBeDisabled()
  })

  it('should disable refresh button when refreshing', () => {
    renderWithProviders(<AlreadyImportedState {...defaultProps} isRefreshing={true} />)

    const refreshButton = screen.getByRole('button', { name: /Refreshing\.\.\./ })
    expect(refreshButton).toBeDisabled()
  })
})
