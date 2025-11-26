/**
 * Unit tests for CopilotConfigForm component
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CopilotConfigForm,
  type CopilotConfig,
} from '../../../src/components/executions/CopilotConfigForm'

describe('CopilotConfigForm', () => {
  const defaultConfig: CopilotConfig = {
    allowAllTools: true,
    model: 'claude-sonnet-4.5',
  }

  const mockOnChange = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render all configuration options', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(screen.getByLabelText(/Model/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Allow All Tools/i)).toBeInTheDocument()
    })

    it('should render with default values', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const allowAllToolsSwitch = screen.getByRole('switch', { name: /Allow All Tools/i })
      expect(allowAllToolsSwitch).toBeChecked()
    })

    it('should display model description', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(
        screen.getByText(/Choose which AI model Copilot should use/i)
      ).toBeInTheDocument()
    })
  })

  describe('model selection', () => {
    it('should call onChange when model is changed', async () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      fireEvent.click(modelSelect)

      const gpt5Option = screen.getByText('GPT-5')
      fireEvent.click(gpt5Option)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        model: 'gpt-5',
      })
    })

    it('should display default model when not specified', () => {
      render(<CopilotConfigForm config={{}} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      expect(modelSelect).toHaveTextContent(/Claude Sonnet 4.5/)
    })

    it('should support all available models', async () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      fireEvent.click(modelSelect)

      // Check all models are present with updated valid model names
      expect(screen.getAllByText(/Claude Sonnet 4.5 \(Default\)/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Claude Sonnet 4').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Claude Haiku 4.5').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/^GPT-5$/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText('GPT-5.1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('GPT-5.1 Codex').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Gemini 3 Pro Preview').length).toBeGreaterThan(0)
    })
  })

  describe('allow all tools toggle', () => {
    it('should call onChange when allowAllTools is toggled on', () => {
      render(
        <CopilotConfigForm
          config={{ ...defaultConfig, allowAllTools: false }}
          onChange={mockOnChange}
        />
      )

      const allowAllToolsSwitch = screen.getByRole('switch', { name: /Allow All Tools/i })
      fireEvent.click(allowAllToolsSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        allowAllTools: true,
      })
    })

    it('should call onChange when allowAllTools is toggled off', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const allowAllToolsSwitch = screen.getByRole('switch', { name: /Allow All Tools/i })
      fireEvent.click(allowAllToolsSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        allowAllTools: false,
      })
    })

    it('should default allowAllTools to true when not specified', () => {
      render(<CopilotConfigForm config={{ model: 'claude-sonnet-4.5' }} onChange={mockOnChange} />)

      const allowAllToolsSwitch = screen.getByRole('switch', { name: /Allow All Tools/i })
      expect(allowAllToolsSwitch).toBeChecked()
    })
  })

  describe('advanced settings', () => {
    it('should hide advanced settings by default', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(screen.queryByLabelText(/Allow Specific Tools/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Deny Specific Tools/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Custom Copilot CLI Path/i)).not.toBeInTheDocument()
    })

    it('should show advanced settings when collapsed section is clicked', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      expect(screen.getByLabelText(/Allow Specific Tools/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Deny Specific Tools/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Custom Copilot CLI Path/i)).toBeInTheDocument()
    })

    it('should update allowTool when input changes', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      const allowToolInput = screen.getByLabelText(/Allow Specific Tools/i)
      fireEvent.change(allowToolInput, { target: { value: 'bash,read_file' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        allowTool: 'bash,read_file',
      })
    })

    it('should update denyTool when input changes', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      const denyToolInput = screen.getByLabelText(/Deny Specific Tools/i)
      fireEvent.change(denyToolInput, { target: { value: 'web_search' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        denyTool: 'web_search',
      })
    })

    it('should update copilotPath when input changes', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      const pathInput = screen.getByLabelText(/Custom Copilot CLI Path/i)
      fireEvent.change(pathInput, { target: { value: '/custom/path/copilot' } })

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        copilotPath: '/custom/path/copilot',
      })
    })

    it('should disable allowTool input when allowAllTools is enabled', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      const allowToolInput = screen.getByLabelText(/Allow Specific Tools/i)
      expect(allowToolInput).toBeDisabled()
    })

    it('should enable allowTool input when allowAllTools is disabled', () => {
      render(
        <CopilotConfigForm
          config={{ ...defaultConfig, allowAllTools: false }}
          onChange={mockOnChange}
        />
      )

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      const allowToolInput = screen.getByLabelText(/Allow Specific Tools/i)
      expect(allowToolInput).not.toBeDisabled()
    })
  })

  describe('validation', () => {
    it('should validate and show error when allowTool conflicts with allowAllTools', () => {
      const { rerender } = render(
        <CopilotConfigForm
          config={{ ...defaultConfig, allowAllTools: true }}
          onChange={mockOnChange}
        />
      )

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      // Try to set allowTool - this should trigger validation error
      const allowToolInput = screen.getByLabelText(/Allow Specific Tools/i)
      fireEvent.change(allowToolInput, { target: { value: 'bash' } })

      // The onChange should be called with the new config
      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        allowAllTools: true,
        allowTool: 'bash',
      })

      // Rerender with the conflicting config to show the error
      rerender(
        <CopilotConfigForm
          config={{ ...defaultConfig, allowAllTools: true, allowTool: 'bash' }}
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText(/allowTool is ignored when allowAllTools is enabled/i)).toBeInTheDocument()
    })

    it('should validate and show error when denyTool is set with allowAllTools', () => {
      const { rerender } = render(
        <CopilotConfigForm
          config={{ ...defaultConfig, allowAllTools: true }}
          onChange={mockOnChange}
        />
      )

      // Open advanced settings
      const advancedTrigger = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedTrigger)

      // Try to set denyTool - this should trigger validation warning
      const denyToolInput = screen.getByLabelText(/Deny Specific Tools/i)
      fireEvent.change(denyToolInput, { target: { value: 'bash' } })

      // Rerender with the conflicting config to show the warning
      rerender(
        <CopilotConfigForm
          config={{ ...defaultConfig, allowAllTools: true, denyTool: 'bash' }}
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText(/denyTool takes precedence over allowAllTools/i)).toBeInTheDocument()
    })

    it('should not show errors for valid config', () => {
      render(<CopilotConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(screen.queryByText(/allowTool is ignored/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/denyTool takes precedence/i)).not.toBeInTheDocument()
    })
  })

  describe('config updates', () => {
    it('should preserve other config values when updating model', () => {
      const config: CopilotConfig = {
        allowAllTools: false,
        model: 'claude-sonnet-4.5',
        allowTool: 'bash',
      }

      render(<CopilotConfigForm config={config} onChange={mockOnChange} />)

      const modelSelect = screen.getByLabelText(/Model/i)
      fireEvent.click(modelSelect)

      const claudeSonnet4Option = screen.getByText('Claude Sonnet 4')
      fireEvent.click(claudeSonnet4Option)

      expect(mockOnChange).toHaveBeenCalledWith({
        allowAllTools: false,
        model: 'claude-sonnet-4',
        allowTool: 'bash',
      })
    })

    it('should preserve other config values when updating allowAllTools', () => {
      const config: CopilotConfig = {
        allowAllTools: true,
        model: 'gpt-5.1',
      }

      render(<CopilotConfigForm config={config} onChange={mockOnChange} />)

      const allowAllToolsSwitch = screen.getByRole('switch', { name: /Allow All Tools/i })
      fireEvent.click(allowAllToolsSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        allowAllTools: false,
        model: 'gpt-5.1',
      })
    })
  })
})
