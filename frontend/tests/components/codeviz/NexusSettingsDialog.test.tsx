import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  NexusSettingsDialog,
  DEFAULT_NEXUS_SETTINGS,
} from '@/components/codeviz/NexusSettingsDialog'

describe('NexusSettingsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    settings: DEFAULT_NEXUS_SETTINGS,
    onSettingsChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render dialog when open', () => {
      render(<NexusSettingsDialog {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Nexus View Settings')).toBeInTheDocument()
    })

    it('should not render dialog when closed', () => {
      render(<NexusSettingsDialog {...defaultProps} open={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render description text', () => {
      render(<NexusSettingsDialog {...defaultProps} />)

      expect(
        screen.getByText('Configure how the code visualization is displayed.')
      ).toBeInTheDocument()
    })

    it('should render Show Symbols toggle', () => {
      render(<NexusSettingsDialog {...defaultProps} />)

      expect(screen.getByText('Show Symbols')).toBeInTheDocument()
      expect(
        screen.getByText('Display functions, classes, and other code symbols on the map.')
      ).toBeInTheDocument()
    })
  })

  describe('Switch State', () => {
    it('should show switch as checked when includeSymbols is true', () => {
      render(<NexusSettingsDialog {...defaultProps} settings={{ includeSymbols: true }} />)

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('data-state', 'checked')
    })

    it('should show switch as unchecked when includeSymbols is false', () => {
      render(<NexusSettingsDialog {...defaultProps} settings={{ includeSymbols: false }} />)

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('data-state', 'unchecked')
    })
  })

  describe('Interactions', () => {
    it('should call onSettingsChange when switch is toggled on', () => {
      const onSettingsChange = vi.fn()
      render(
        <NexusSettingsDialog
          {...defaultProps}
          settings={{ includeSymbols: false }}
          onSettingsChange={onSettingsChange}
        />
      )

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      expect(onSettingsChange).toHaveBeenCalledWith({ includeSymbols: true })
    })

    it('should call onSettingsChange when switch is toggled off', () => {
      const onSettingsChange = vi.fn()
      render(
        <NexusSettingsDialog
          {...defaultProps}
          settings={{ includeSymbols: true }}
          onSettingsChange={onSettingsChange}
        />
      )

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      expect(onSettingsChange).toHaveBeenCalledWith({ includeSymbols: false })
    })

    it('should call onOpenChange when ESC key is pressed', () => {
      const onOpenChange = vi.fn()
      render(<NexusSettingsDialog {...defaultProps} onOpenChange={onOpenChange} />)

      // Press ESC key to close dialog
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('DEFAULT_NEXUS_SETTINGS', () => {
    it('should have includeSymbols set to true by default', () => {
      expect(DEFAULT_NEXUS_SETTINGS.includeSymbols).toBe(true)
    })
  })
})
