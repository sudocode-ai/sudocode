import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@/contexts/ThemeContext'
import Sidebar from '@/components/layout/Sidebar'

const renderSidebar = (props = {}) => {
  return render(
    <ThemeProvider>
      <BrowserRouter>
        <Sidebar open={false} collapsed={false} {...props} />
      </BrowserRouter>
    </ThemeProvider>
  )
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

  it('should show phase information in footer', () => {
    renderSidebar({ open: true })
    expect(screen.getByText('Phase 1 MVP')).toBeInTheDocument()
  })
})
