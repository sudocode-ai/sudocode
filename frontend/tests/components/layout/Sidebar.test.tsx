import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import Sidebar from '@/components/layout/Sidebar'

const renderSidebar = (props = {}) => {
  return renderWithProviders(<Sidebar open={false} collapsed={false} {...props} />)
}

describe('Sidebar', () => {
  it('should render navigation items', () => {
    renderSidebar({ open: true })
    expect(screen.getByText('Issues')).toBeInTheDocument()
    expect(screen.getByText('Specs')).toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderSidebar({ open: true, onClose })

    const closeButton = screen.getByLabelText('Close menu')
    await user.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should have correct links', () => {
    renderSidebar({ open: true })

    const issuesLink = screen.getByRole('link', { name: /issues/i })
    const specsLink = screen.getByRole('link', { name: /specs/i })

    expect(issuesLink).toHaveAttribute('href', '/issues')
    expect(specsLink).toHaveAttribute('href', '/specs')
  })

  it('should show settings button', () => {
    renderSidebar({ open: true })
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })
})
