/**
 * Unit tests for CursorConfigForm component
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CursorConfigForm,
  type CursorConfig,
} from '../../../src/components/executions/CursorConfigForm'

describe('CursorConfigForm', () => {
  const defaultConfig: CursorConfig = {
    force: true,
    model: 'auto',
  }

  const mockOnChange = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render all configuration options', () => {
      render(<CursorConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(screen.getByLabelText(/Model/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Auto-Approve Actions/i)).toBeInTheDocument()
    })

    it('should render with default values', () => {
      render(<CursorConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const forceSwitch = screen.getByRole('switch', { name: /Auto-Approve Actions/i })
      expect(forceSwitch).toBeChecked()
    })

    it('should display model description', () => {
      render(<CursorConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(
        screen.getByText(/Choose which AI model Cursor should use for code generation/i)
      ).toBeInTheDocument()
    })
  })

  describe('model selection', () => {
    it('should call onChange when model is changed', async () => {
      render(<CursorConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      fireEvent.click(modelSelect)

      const sonnetOption = screen.getByText('Claude Sonnet 4.5')
      fireEvent.click(sonnetOption)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        model: 'sonnet-4.5',
      })
    })

    it('should display default model when not specified', () => {
      render(<CursorConfigForm config={{}} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      expect(modelSelect).toHaveTextContent(/Auto/)
    })

    it('should support all available models', async () => {
      render(<CursorConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      fireEvent.click(modelSelect)

      // Check all models are present (some may appear multiple times in select)
      expect(screen.getAllByText(/Auto \(Recommended\)/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Claude Sonnet 4.5').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Claude Sonnet 4.5 \(Thinking\)/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText('GPT-5').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Claude Opus 4.1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Grok').length).toBeGreaterThan(0)
    })
  })

  describe('force toggle', () => {
    it('should call onChange when force is toggled on', () => {
      render(
        <CursorConfigForm config={{ ...defaultConfig, force: false }} onChange={mockOnChange} />
      )

      const forceSwitch = screen.getByRole('switch', { name: /Auto-Approve Actions/i })
      fireEvent.click(forceSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        force: true,
      })
    })

    it('should call onChange when force is toggled off', () => {
      render(<CursorConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const forceSwitch = screen.getByRole('switch', { name: /Auto-Approve Actions/i })
      fireEvent.click(forceSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        force: false,
      })
    })

    it('should default force to true when not specified', () => {
      render(<CursorConfigForm config={{ model: 'auto' }} onChange={mockOnChange} />)

      const forceSwitch = screen.getByRole('switch', { name: /Auto-Approve Actions/i })
      expect(forceSwitch).toBeChecked()
    })
  })

  describe('config updates', () => {
    it('should preserve other config values when updating model', () => {
      const config: CursorConfig = {
        force: false,
        model: 'auto',
      }

      render(<CursorConfigForm config={config} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      fireEvent.click(modelSelect)

      const gpt5Option = screen.getByText('GPT-5')
      fireEvent.click(gpt5Option)

      expect(mockOnChange).toHaveBeenCalledWith({
        force: false,
        model: 'gpt-5',
      })
    })

    it('should preserve other config values when updating force', () => {
      const config: CursorConfig = {
        force: true,
        model: 'sonnet-4.5',
      }

      render(<CursorConfigForm config={config} onChange={mockOnChange} />)

      const forceSwitch = screen.getByRole('switch', { name: /Auto-Approve Actions/i })
      fireEvent.click(forceSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        force: false,
        model: 'sonnet-4.5',
      })
    })
  })
})
