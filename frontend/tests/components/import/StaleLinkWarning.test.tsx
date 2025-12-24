import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { StaleLinkWarning } from '@/components/import/StaleLinkWarning'
import type { ExternalLink } from '@sudocode-ai/types'

describe('StaleLinkWarning', () => {
  const mockLink: ExternalLink = {
    provider: 'github',
    external_id: 'owner/repo#123',
    external_url: 'https://github.com/owner/repo/issues/123',
    sync_enabled: false,
    sync_direction: 'inbound',
    metadata: {
      stale: true,
      stale_reason: 'external_entity_not_found',
      stale_at: '2024-01-15T10:30:00Z',
    },
  }

  const defaultProps = {
    link: mockLink,
    onUnlink: vi.fn(),
    onDismiss: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display warning title', () => {
    renderWithProviders(<StaleLinkWarning {...defaultProps} />)

    expect(screen.getByText('External Link Stale')).toBeInTheDocument()
  })

  it('should display provider icon', () => {
    const { container } = renderWithProviders(<StaleLinkWarning {...defaultProps} />)

    // GitHub uses an SVG icon from lucide
    expect(container.querySelector('svg.lucide-github')).toBeInTheDocument()
  })

  it('should display stale message for not found reason', () => {
    renderWithProviders(<StaleLinkWarning {...defaultProps} />)

    expect(
      screen.getByText(/The GitHub entity \(owner\/repo#123\) was not found/)
    ).toBeInTheDocument()
  })

  it('should display stale message for fetch failed reason', () => {
    const linkWithFetchFailed: ExternalLink = {
      ...mockLink,
      metadata: {
        stale: true,
        stale_reason: 'fetch_failed_404',
      },
    }
    renderWithProviders(<StaleLinkWarning {...defaultProps} link={linkWithFetchFailed} />)

    expect(
      screen.getByText(/Could not fetch the GitHub entity \(owner\/repo#123\)/)
    ).toBeInTheDocument()
  })

  it('should display generic message for unknown reason', () => {
    const linkWithUnknownReason: ExternalLink = {
      ...mockLink,
      metadata: {
        stale: true,
      },
    }
    renderWithProviders(<StaleLinkWarning {...defaultProps} link={linkWithUnknownReason} />)

    expect(
      screen.getByText('The external entity linked to this item no longer exists.')
    ).toBeInTheDocument()
  })

  it('should display stale timestamp when available', () => {
    renderWithProviders(<StaleLinkWarning {...defaultProps} />)

    // Should show formatted date
    expect(screen.getByText(/Detected/)).toBeInTheDocument()
  })

  it('should not display stale timestamp when not available', () => {
    const linkWithoutStaleAt: ExternalLink = {
      ...mockLink,
      metadata: {
        stale: true,
        stale_reason: 'external_entity_not_found',
      },
    }
    renderWithProviders(<StaleLinkWarning {...defaultProps} link={linkWithoutStaleAt} />)

    expect(screen.queryByText(/Detected/)).not.toBeInTheDocument()
  })

  it('should call onUnlink when Remove Link button clicked', async () => {
    const user = userEvent.setup()
    const onUnlink = vi.fn()
    renderWithProviders(<StaleLinkWarning {...defaultProps} onUnlink={onUnlink} />)

    await user.click(screen.getByRole('button', { name: 'Remove Link' }))

    expect(onUnlink).toHaveBeenCalledTimes(1)
  })

  it('should call onDismiss when Dismiss button clicked', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    renderWithProviders(<StaleLinkWarning {...defaultProps} onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('should disable buttons when isUnlinking is true', () => {
    renderWithProviders(<StaleLinkWarning {...defaultProps} isUnlinking />)

    expect(screen.getByRole('button', { name: 'Unlinking...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
  })

  it('should show Unlinking... text when isUnlinking', () => {
    renderWithProviders(<StaleLinkWarning {...defaultProps} isUnlinking />)

    expect(screen.getByRole('button', { name: 'Unlinking...' })).toBeInTheDocument()
  })

  it('should display Jira provider correctly', () => {
    const jiraLink: ExternalLink = {
      ...mockLink,
      provider: 'jira',
      external_id: 'PROJ-123',
    }
    renderWithProviders(<StaleLinkWarning {...defaultProps} link={jiraLink} />)

    // Jira uses a letter "J" for its icon
    expect(screen.getByText('J')).toBeInTheDocument()
    // The error message should reference Jira
    expect(screen.getByText(/The Jira entity/)).toBeInTheDocument()
  })

  it('should display warning icon', () => {
    const { container } = renderWithProviders(<StaleLinkWarning {...defaultProps} />)

    // AlertTriangle icon should be present (lucide uses different class naming)
    expect(container.querySelector('svg.lucide')).toBeInTheDocument()
  })
})
