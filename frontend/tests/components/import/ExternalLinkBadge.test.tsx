import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExternalLinkBadge } from '@/components/import/ExternalLinkBadge'
import type { ExternalLink } from '@sudocode-ai/types'

describe('ExternalLinkBadge', () => {
  const mockLink: ExternalLink = {
    provider: 'github',
    external_id: 'owner/repo#123',
    external_url: 'https://github.com/owner/repo/issues/123',
    sync_enabled: true,
    sync_direction: 'inbound',
    last_synced_at: '2024-01-15T10:30:00Z',
  }

  const defaultProps = {
    link: mockLink,
    onRefresh: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display provider icon and name', () => {
    renderWithProviders(<ExternalLinkBadge {...defaultProps} />)

    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })

  it('should display external ID', () => {
    renderWithProviders(<ExternalLinkBadge {...defaultProps} />)

    expect(screen.getByText('owner/repo#123')).toBeInTheDocument()
  })

  it('should display external link when URL provided', () => {
    renderWithProviders(<ExternalLinkBadge {...defaultProps} />)

    const link = document.querySelector('a[href="https://github.com/owner/repo/issues/123"]')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should not display external link when URL not provided', () => {
    const linkWithoutUrl = { ...mockLink, external_url: undefined }
    renderWithProviders(<ExternalLinkBadge {...defaultProps} link={linkWithoutUrl} />)

    const link = document.querySelector('a')
    expect(link).not.toBeInTheDocument()
  })

  it('should display last synced time', () => {
    renderWithProviders(<ExternalLinkBadge {...defaultProps} />)

    // Should display relative time
    expect(screen.getByText(/ago/)).toBeInTheDocument()
  })

  it('should not display last synced when not provided', () => {
    const linkWithoutSync = { ...mockLink, last_synced_at: undefined }
    renderWithProviders(<ExternalLinkBadge {...defaultProps} link={linkWithoutSync} />)

    // Clock icon should not be present
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })

  it('should call onRefresh when refresh button clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderWithProviders(<ExternalLinkBadge {...defaultProps} onRefresh={onRefresh} />)

    const refreshButton = screen.getByRole('button')
    await user.click(refreshButton)

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('should disable refresh button when isRefreshing is true', () => {
    renderWithProviders(<ExternalLinkBadge {...defaultProps} isRefreshing />)

    const refreshButton = screen.getByRole('button')
    expect(refreshButton).toBeDisabled()
  })

  it('should show refreshing state when isRefreshing is true', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExternalLinkBadge {...defaultProps} isRefreshing />)

    // Hover over button to see tooltip
    const refreshButton = screen.getByRole('button')
    await user.hover(refreshButton)

    // Check for spinning animation class on icon
    expect(refreshButton.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <ExternalLinkBadge {...defaultProps} className="custom-class" />
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should display warning style when link is stale', () => {
    const staleLink: ExternalLink = {
      ...mockLink,
      metadata: { stale: true },
    }
    const { container } = renderWithProviders(<ExternalLinkBadge {...defaultProps} link={staleLink} />)

    expect(container.firstChild).toHaveClass('border-yellow-500/50')
  })

  it('should display different provider icons', () => {
    const jiraLink: ExternalLink = {
      ...mockLink,
      provider: 'jira',
    }
    renderWithProviders(<ExternalLinkBadge {...defaultProps} link={jiraLink} />)

    expect(screen.getByText('Jira')).toBeInTheDocument()
    // Jira uses a styled letter instead of icon
    expect(screen.getByText('J')).toBeInTheDocument()
  })
})
