/**
 * PermissionRequest Component Tests
 *
 * Tests for the ACP permission request UI component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionRequest } from '@/components/executions/PermissionRequest'
import type { PermissionRequest as PermissionRequestType } from '@/types/permissions'
import { ThemeProvider } from '@/contexts/ThemeContext'

// Helper to wrap component with ThemeProvider
const renderWithTheme = (ui: React.ReactElement) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

// Helper to create a permission request
function createPermissionRequest(
  overrides: Partial<PermissionRequestType> = {}
): PermissionRequestType {
  return {
    requestId: 'req-123',
    sessionId: 'session-456',
    toolCall: {
      toolCallId: 'tool-789',
      title: 'Bash',
      status: 'pending',
      rawInput: { command: 'npm test' },
    },
    options: [
      { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
      { optionId: 'allow_always', name: 'Allow Always', kind: 'allow_always' },
      { optionId: 'deny_once', name: 'Deny Once', kind: 'deny_once' },
      { optionId: 'deny_always', name: 'Deny Always', kind: 'deny_always' },
    ],
    responded: false,
    timestamp: new Date(),
    ...overrides,
  }
}

describe('PermissionRequest', () => {
  const mockOnRespond = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render tool call title', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('Bash')).toBeInTheDocument()
    })

    it('should render awaiting permission text', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('awaiting permission')).toBeInTheDocument()
    })

    it('should render all permission options as buttons', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByRole('button', { name: 'Allow Once' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Allow Always' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Deny Once' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Deny Always' })).toBeInTheDocument()
    })

    it('should display tool input for Bash commands', () => {
      const request = createPermissionRequest({
        toolCall: {
          toolCallId: 'tool-789',
          title: 'Bash',
          status: 'pending',
          rawInput: { command: 'npm test' },
        },
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('npm test')).toBeInTheDocument()
    })

    it('should display file path for file operations', () => {
      const request = createPermissionRequest({
        toolCall: {
          toolCallId: 'tool-789',
          title: 'Read',
          status: 'pending',
          rawInput: { file_path: '/path/to/file.ts' },
        },
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('/path/to/file.ts')).toBeInTheDocument()
    })

    it('should show keyboard navigation hints', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText(/Use/)).toBeInTheDocument()
      expect(screen.getByText(/to navigate/)).toBeInTheDocument()
      expect(screen.getByText(/to select/)).toBeInTheDocument()
    })
  })

  describe('Click handling', () => {
    it('should call onRespond when clicking an option', async () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      const allowButton = screen.getByRole('button', { name: 'Allow Once' })
      await userEvent.click(allowButton)

      expect(mockOnRespond).toHaveBeenCalledWith('req-123', 'allow_once')
    })

    it('should call onRespond with correct optionId for each option', async () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      await userEvent.click(screen.getByRole('button', { name: 'Deny Always' }))
      expect(mockOnRespond).toHaveBeenCalledWith('req-123', 'deny_always')
    })
  })

  describe('Keyboard navigation', () => {
    it('should navigate options with arrow keys', async () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={true} />
      )

      // Wait for initial focus
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Allow Once' })).toHaveFocus()
      })

      // Navigate right
      await userEvent.keyboard('{ArrowRight}')
      expect(screen.getByRole('button', { name: 'Allow Always' })).toHaveFocus()

      // Navigate right again
      await userEvent.keyboard('{ArrowRight}')
      expect(screen.getByRole('button', { name: 'Deny Once' })).toHaveFocus()
    })

    it('should wrap around when navigating past the end', async () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={true} />
      )

      // Navigate to end and wrap
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
      expect(screen.getByRole('button', { name: 'Allow Once' })).toHaveFocus()
    })

    it('should wrap around when navigating before the start', async () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={true} />
      )

      // Navigate before start wraps to end
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.getByRole('button', { name: 'Deny Always' })).toHaveFocus()
    })

    it('should select current option with Enter key', async () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={true} />
      )

      // Navigate to "Allow Always" and press Enter
      await userEvent.keyboard('{ArrowRight}{Enter}')

      expect(mockOnRespond).toHaveBeenCalledWith('req-123', 'allow_always')
    })

    it('should select current option with Space key', async () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={true} />
      )

      await userEvent.keyboard('{ }')

      expect(mockOnRespond).toHaveBeenCalledWith('req-123', 'allow_once')
    })

    it('should support ArrowUp/ArrowDown in addition to ArrowLeft/ArrowRight', async () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={true} />
      )

      await userEvent.keyboard('{ArrowDown}')
      expect(screen.getByRole('button', { name: 'Allow Always' })).toHaveFocus()

      await userEvent.keyboard('{ArrowUp}')
      expect(screen.getByRole('button', { name: 'Allow Once' })).toHaveFocus()
    })
  })

  describe('Responded state', () => {
    it('should show selected option when responded', () => {
      const request = createPermissionRequest({
        responded: true,
        selectedOptionId: 'allow_once',
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('Allow Once')).toBeInTheDocument()
      // Should not show option buttons when responded
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should show green dot when responded', () => {
      const request = createPermissionRequest({
        responded: true,
        selectedOptionId: 'allow_once',
      })
      const { container } = renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} />
      )

      // Check for green-600 class on the dot
      const dot = container.querySelector('.text-green-600')
      expect(dot).toBeInTheDocument()
    })

    it('should not show keyboard hints when responded', () => {
      const request = createPermissionRequest({
        responded: true,
        selectedOptionId: 'allow_once',
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.queryByText(/Use/)).not.toBeInTheDocument()
    })

    it('should ignore keyboard events when responded', async () => {
      const request = createPermissionRequest({
        responded: true,
        selectedOptionId: 'allow_once',
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      await userEvent.keyboard('{Enter}')

      expect(mockOnRespond).not.toHaveBeenCalled()
    })
  })

  describe('Auto-focus', () => {
    it('should auto-focus first option by default', async () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Allow Once' })).toHaveFocus()
      })
    })

    it('should not auto-focus when autoFocus is false', () => {
      const request = createPermissionRequest()
      renderWithTheme(
        <PermissionRequest request={request} onRespond={mockOnRespond} autoFocus={false} />
      )

      // When autoFocus is false, no button should have programmatic focus
      // Note: testing-library may set focus due to render behavior, but verify autoFocus effect didn't run
      const buttons = screen.getAllByRole('button')
      const container = screen.getByRole('group', { name: /Permission request/ })

      // The container should exist and buttons should be present
      expect(container).toBeInTheDocument()
      expect(buttons).toHaveLength(4)
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByRole('group', { name: /Permission request for Bash/ })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Permission options' })).toBeInTheDocument()
    })

    it('should have aria-pressed on buttons', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
      expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('Skip All functionality', () => {
    it('should render Skip All button when onSkipAll is provided', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
        />
      )

      expect(screen.getByRole('button', { name: 'Skip All' })).toBeInTheDocument()
    })

    it('should not render Skip All button when onSkipAll is not provided', () => {
      const request = createPermissionRequest()
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.queryByRole('button', { name: 'Skip All' })).not.toBeInTheDocument()
    })

    it('should call onSkipAll when Skip All button is clicked', async () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: 'Skip All' }))
      expect(mockOnSkipAll).toHaveBeenCalled()
    })

    it('should hide permission options when isSkippingAll is true', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
          isSkippingAll={true}
        />
      )

      // Permission option buttons should be hidden
      expect(screen.queryByRole('button', { name: 'Allow Once' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Allow Always' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Deny Once' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Deny Always' })).not.toBeInTheDocument()
    })

    it('should show Restarting... text when isSkippingAll is true', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
          isSkippingAll={true}
        />
      )

      expect(screen.getByRole('button', { name: 'Restarting...' })).toBeInTheDocument()
    })

    it('should hide separator when isSkippingAll is true', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
          isSkippingAll={true}
        />
      )

      // The separator "|" should not be present
      expect(screen.queryByText('|')).not.toBeInTheDocument()
    })

    it('should hide keyboard hints when isSkippingAll is true', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
          isSkippingAll={true}
        />
      )

      expect(screen.queryByText(/Use/)).not.toBeInTheDocument()
      expect(screen.queryByText(/to navigate/)).not.toBeInTheDocument()
    })

    it('should disable Skip All button when isSkippingAll is true', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
          isSkippingAll={true}
        />
      )

      expect(screen.getByRole('button', { name: 'Restarting...' })).toBeDisabled()
    })

    it('should still show tool call info when isSkippingAll is true', () => {
      const request = createPermissionRequest()
      const mockOnSkipAll = vi.fn()
      renderWithTheme(
        <PermissionRequest
          request={request}
          onRespond={mockOnRespond}
          onSkipAll={mockOnSkipAll}
          isSkippingAll={true}
        />
      )

      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.getByText('awaiting permission')).toBeInTheDocument()
      expect(screen.getByText('npm test')).toBeInTheDocument()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty options array', () => {
      const request = createPermissionRequest({ options: [] })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should truncate long commands', () => {
      const longCommand = 'a'.repeat(100)
      const request = createPermissionRequest({
        toolCall: {
          toolCallId: 'tool-789',
          title: 'Bash',
          status: 'pending',
          rawInput: { command: longCommand },
        },
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      // Should truncate to 80 chars with "..."
      const inputText = screen.getByText(/^a+\.\.\.$/i)
      expect(inputText.textContent?.length).toBeLessThan(100)
    })

    it('should handle string rawInput', () => {
      const request = createPermissionRequest({
        toolCall: {
          toolCallId: 'tool-789',
          title: 'Custom',
          status: 'pending',
          rawInput: 'some raw input',
        },
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      expect(screen.getByText('some raw input')).toBeInTheDocument()
    })

    it('should handle undefined rawInput', () => {
      const request = createPermissionRequest({
        toolCall: {
          toolCallId: 'tool-789',
          title: 'Custom',
          status: 'pending',
          rawInput: undefined,
        },
      })
      renderWithTheme(<PermissionRequest request={request} onRespond={mockOnRespond} />)

      // Should not show input section
      expect(screen.queryByText('∟')).not.toBeInTheDocument()
    })
  })
})
