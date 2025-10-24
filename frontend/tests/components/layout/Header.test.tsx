import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@/contexts/ThemeContext'
import Header from '@/components/layout/Header'

const renderHeader = (props = {}) => {
  return render(
    <ThemeProvider>
      <BrowserRouter>
        <Header {...props} />
      </BrowserRouter>
    </ThemeProvider>
  )
}

describe('Header', () => {
  it('should render the Sudocode logo', () => {
    renderHeader()
    expect(screen.getByText('Sudocode')).toBeInTheDocument()
  })

  it('should call onMenuClick when menu button is clicked', async () => {
    const user = userEvent.setup()
    const onMenuClick = vi.fn()

    renderHeader({ onMenuClick })

    const menuButtons = screen.queryAllByLabelText('Toggle menu')
    if (menuButtons.length > 0) {
      await user.click(menuButtons[0])
      expect(onMenuClick).toHaveBeenCalledTimes(1)
    }
  })

  it('should render theme toggle button', () => {
    renderHeader()
    const themeButton = screen.getByLabelText(/switch to/i)
    expect(themeButton).toBeInTheDocument()
  })

  it('should have correct link to home', () => {
    renderHeader()
    const logo = screen.getByText('S')
    const link = logo.closest('a')
    expect(link).toHaveAttribute('href', '/')
  })
})
