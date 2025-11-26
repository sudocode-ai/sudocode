/**
 * Unit tests for CodexConfigForm component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CodexConfigForm,
  type CodexConfig,
} from '../../../src/components/executions/CodexConfigForm'

describe('CodexConfigForm', () => {
  const defaultConfig: CodexConfig = {
    fullAuto: true,
    search: true,
    json: true,
  }

  const mockOnChange = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render all basic configuration options', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(screen.getByLabelText(/Model/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Full Auto Mode/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Web Search/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/JSON Output/i)).toBeInTheDocument()
    })

    it('should show advanced settings when expanded', async () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      expect(screen.getByLabelText(/Sandbox Policy/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Approval Policy/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Color Output/i)).toBeInTheDocument()
    })

    it('should render with default values', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const fullAutoSwitch = screen.getByRole('switch', { name: /Full Auto Mode/i })
      const searchSwitch = screen.getByRole('switch', { name: /Web Search/i })
      const jsonSwitch = screen.getByRole('switch', { name: /JSON Output/i })

      expect(fullAutoSwitch).toBeChecked()
      expect(searchSwitch).toBeChecked()
      expect(jsonSwitch).toBeChecked()
    })
  })

  describe('model selection', () => {
    it('should call onChange when model is changed', async () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

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
      render(<CodexConfigForm config={{}} onChange={mockOnChange} />)

      // Default model should be gpt-5-codex
      const modelSelect = screen.getByLabelText(/Model/i)
      expect(modelSelect).toHaveTextContent(/GPT-5 Codex/)
    })
  })

  describe('switch interactions', () => {
    it('should toggle Full Auto mode', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const fullAutoSwitch = screen.getByRole('switch', { name: /Full Auto Mode/i })
      fireEvent.click(fullAutoSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        fullAuto: false,
      })
    })

    it('should toggle Web Search', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const searchSwitch = screen.getByRole('switch', { name: /Web Search/i })
      fireEvent.click(searchSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        search: false,
      })
    })

    it('should toggle JSON Output', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      const jsonSwitch = screen.getByRole('switch', { name: /JSON Output/i })
      fireEvent.click(jsonSwitch)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        json: false,
      })
    })
  })

  describe('advanced settings', () => {
    it('should disable sandbox and approval when fullAuto is enabled', () => {
      const configWithFullAuto = { ...defaultConfig, fullAuto: true }
      render(<CodexConfigForm config={configWithFullAuto} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      const sandboxSelect = screen.getByLabelText(/Sandbox Policy/i)
      const approvalSelect = screen.getByLabelText(/Approval Policy/i)

      expect(sandboxSelect).toBeDisabled()
      expect(approvalSelect).toBeDisabled()
    })

    it('should enable sandbox and approval when fullAuto is disabled', () => {
      const configWithoutFullAuto = { ...defaultConfig, fullAuto: false }
      render(<CodexConfigForm config={configWithoutFullAuto} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      const sandboxSelect = screen.getByLabelText(/Sandbox Policy/i)
      const approvalSelect = screen.getByLabelText(/Approval Policy/i)

      expect(sandboxSelect).not.toBeDisabled()
      expect(approvalSelect).not.toBeDisabled()
    })

    it('should change sandbox policy', () => {
      const config = { ...defaultConfig, fullAuto: false }
      render(<CodexConfigForm config={config} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      const sandboxSelect = screen.getByLabelText(/Sandbox Policy/i)
      fireEvent.click(sandboxSelect)

      const readOnlyOption = screen.getByRole('option', { name: /Read Only/i })
      fireEvent.click(readOnlyOption)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        sandbox: 'read-only',
      })
    })

    it('should change approval policy', () => {
      const config = { ...defaultConfig, fullAuto: false }
      render(<CodexConfigForm config={config} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      const approvalSelect = screen.getByLabelText(/Approval Policy/i)
      fireEvent.click(approvalSelect)

      const neverOption = screen.getByRole('option', { name: /Never/i })
      fireEvent.click(neverOption)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        askForApproval: 'never',
      })
    })

    it('should change color output mode', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      const colorSelect = screen.getByLabelText(/Color Output/i)
      fireEvent.click(colorSelect)

      const alwaysOption = screen.getByRole('option', { name: /^Always$/i })
      fireEvent.click(alwaysOption)

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultConfig,
        color: 'always',
      })
    })
  })

  describe('validation', () => {
    it('should disable sandbox and approval controls when fullAuto is true', () => {
      const config: CodexConfig = {
        fullAuto: true,
      }
      render(<CodexConfigForm config={config} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      // Verify sandbox and approval are disabled when fullAuto is enabled
      const sandboxSelect = screen.getByLabelText(/Sandbox Policy/i)
      const approvalSelect = screen.getByLabelText(/Approval Policy/i)

      expect(sandboxSelect).toBeDisabled()
      expect(approvalSelect).toBeDisabled()
    })

    it('should enable sandbox and approval controls when fullAuto is false', () => {
      const config: CodexConfig = {
        fullAuto: false,
      }
      render(<CodexConfigForm config={config} onChange={mockOnChange} />)

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      // Verify sandbox and approval are enabled when fullAuto is disabled
      const sandboxSelect = screen.getByLabelText(/Sandbox Policy/i)
      const approvalSelect = screen.getByLabelText(/Approval Policy/i)

      expect(sandboxSelect).not.toBeDisabled()
      expect(approvalSelect).not.toBeDisabled()
    })
  })

  describe('default values', () => {
    it('should use default values when config is empty', () => {
      render(<CodexConfigForm config={{}} onChange={mockOnChange} />)

      const fullAutoSwitch = screen.getByRole('switch', { name: /Full Auto Mode/i })
      const searchSwitch = screen.getByRole('switch', { name: /Web Search/i })
      const jsonSwitch = screen.getByRole('switch', { name: /JSON Output/i })

      // Default values from the adapter
      expect(fullAutoSwitch).toBeChecked()
      expect(searchSwitch).toBeChecked()
      expect(jsonSwitch).toBeChecked()
    })
  })

  describe('accessibility', () => {
    it('should have proper labels for all form controls', () => {
      render(<CodexConfigForm config={defaultConfig} onChange={mockOnChange} />)

      expect(screen.getByLabelText(/Model/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Full Auto Mode/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Web Search/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/JSON Output/i)).toBeInTheDocument()

      // Expand advanced settings
      const advancedButton = screen.getByText(/Advanced Settings/i)
      fireEvent.click(advancedButton)

      expect(screen.getByLabelText(/Sandbox Policy/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Approval Policy/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Color Output/i)).toBeInTheDocument()
    })
  })
})
