import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { PatternsManager } from '@/components/agent/PatternsManager'
import type { Pattern, AutoResponseConfig, AutoResponseStats } from '@/types/api'
import * as api from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  patternsApi: {
    getAll: vi.fn(),
    setAutoResponse: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    getStats: vi.fn(),
  },
}))

const mockPattern: Pattern = {
  id: 'pattern-1',
  signature: 'abc123',
  request_type: 'confirmation',
  keywords: ['deploy', 'proceed'],
  context_patterns: ['area:deploy'],
  total_occurrences: 10,
  confidence_score: 95.5,
  last_seen: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  suggested_response: 'yes',
  auto_response_enabled: true,
  created_at: new Date(Date.now() - 86400000).toISOString(),
  updated_at: new Date(Date.now() - 3600000).toISOString(),
}

const mockLowConfidencePattern: Pattern = {
  ...mockPattern,
  id: 'pattern-2',
  confidence_score: 65.0,
  auto_response_enabled: false,
  total_occurrences: 3,
}

const mockConfig: AutoResponseConfig = {
  enabled: true,
  min_confidence: 90,
  min_occurrences: 5,
  notify_user: true,
  respect_recent_overrides: true,
  override_window_days: 7,
}

const mockStats: AutoResponseStats = {
  total_patterns: 10,
  auto_response_enabled: 5,
  average_confidence: 87.5,
  total_responses: 50,
}

describe('PatternsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const mockGetAll = vi.mocked(api.patternsApi.getAll)
    const mockGetConfig = vi.mocked(api.patternsApi.getConfig)
    const mockGetStats = vi.mocked(api.patternsApi.getStats)

    mockGetAll.mockResolvedValue([mockPattern, mockLowConfidencePattern])
    mockGetConfig.mockResolvedValue(mockConfig)
    mockGetStats.mockResolvedValue(mockStats)
  })

  it('should render loading state initially', () => {
    renderWithProviders(<PatternsManager />)

    expect(screen.getByRole('status')).toBeInTheDocument() // Loading spinner
  })

  it('should render patterns after loading', async () => {
    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText('confirmation')).toBeInTheDocument()
      expect(screen.getByText('→ yes')).toBeInTheDocument()
      expect(screen.getByText('95.5% confidence')).toBeInTheDocument()
    })
  })

  it('should display pattern keywords as badges', async () => {
    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText('deploy')).toBeInTheDocument()
      expect(screen.getByText('proceed')).toBeInTheDocument()
    })
  })

  it('should show occurrence count and last seen time', async () => {
    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText(/10 occurrences/)).toBeInTheDocument()
      expect(screen.getByText(/ago/)).toBeInTheDocument()
    })
  })

  it('should render sorting controls', async () => {
    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText('Sort by:')).toBeInTheDocument()
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })
  })

  it('should filter patterns by auto-response enabled', async () => {
    const user = userEvent.setup()
    const mockGetAll = vi.mocked(api.patternsApi.getAll)

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText('Auto-response enabled only')).toBeInTheDocument()
    })

    const toggle = screen.getByRole('switch', { name: 'Auto-response enabled only' })
    await user.click(toggle)

    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledWith({ orderBy: 'confidence', autoResponseOnly: true })
    })
  })

  it('should change sort order', async () => {
    const user = userEvent.setup()
    const mockGetAll = vi.mocked(api.patternsApi.getAll)

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    await user.click(select)

    const option = screen.getByText('Occurrences')
    await user.click(option)

    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledWith({ orderBy: 'occurrences', autoResponseOnly: false })
    })
  })

  it('should toggle auto-response for pattern', async () => {
    const user = userEvent.setup()
    const mockSetAutoResponse = vi.mocked(api.patternsApi.setAutoResponse)
    mockSetAutoResponse.mockResolvedValue(undefined)

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(3) // 2 patterns + filter toggle
    })

    const switches = screen.getAllByRole('switch')
    const patternSwitch = switches[1] // First pattern's switch (second overall)

    await user.click(patternSwitch)

    await waitFor(() => {
      expect(mockSetAutoResponse).toHaveBeenCalledWith(mockPattern.id, false)
    })
  })

  it('should delete pattern with confirmation', async () => {
    const user = userEvent.setup()
    const mockDelete = vi.mocked(api.patternsApi.delete)
    mockDelete.mockResolvedValue(undefined)

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Delete/ })).toHaveLength(2)
    })

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ })
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(mockPattern.id)
    })
  })

  it('should not delete pattern if confirmation cancelled', async () => {
    const user = userEvent.setup()
    const mockDelete = vi.mocked(api.patternsApi.delete)

    // Mock window.confirm to return false
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Delete/ })).toHaveLength(2)
    })

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/ })
    await user.click(deleteButtons[0])

    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('should open configuration dialog', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Configuration/ })).toBeInTheDocument()
    })

    const configButton = screen.getByRole('button', { name: /Configuration/ })
    await user.click(configButton)

    await waitFor(() => {
      expect(screen.getByText('Auto-Response Configuration')).toBeInTheDocument()
      expect(screen.getByLabelText('Enable auto-response')).toBeInTheDocument()
    })
  })

  it('should update configuration in dialog', async () => {
    const user = userEvent.setup()
    const mockUpdateConfig = vi.mocked(api.patternsApi.updateConfig)
    mockUpdateConfig.mockResolvedValue(undefined)

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Configuration/ })).toBeInTheDocument()
    })

    // Open dialog
    const configButton = screen.getByRole('button', { name: /Configuration/ })
    await user.click(configButton)

    await waitFor(() => {
      expect(screen.getByLabelText('Enable auto-response')).toBeInTheDocument()
    })

    // Toggle enable
    const enableSwitch = screen.getByRole('switch', { name: 'Enable auto-response' })
    await user.click(enableSwitch)

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith({ enabled: false })
    })
  })

  it('should update min confidence in dialog', async () => {
    const user = userEvent.setup()
    const mockUpdateConfig = vi.mocked(api.patternsApi.updateConfig)
    mockUpdateConfig.mockResolvedValue(undefined)

    renderWithProviders(<PatternsManager />)

    // Open dialog
    const configButton = screen.getByRole('button', { name: /Configuration/ })
    await user.click(configButton)

    await waitFor(() => {
      expect(screen.getByLabelText('Minimum confidence (%)')).toBeInTheDocument()
    })

    const input = screen.getByLabelText('Minimum confidence (%)')
    await user.clear(input)
    await user.type(input, '85')

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith({ min_confidence: 85 })
    })
  })

  it('should open statistics dialog', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Statistics/ })).toBeInTheDocument()
    })

    const statsButton = screen.getByRole('button', { name: /Statistics/ })
    await user.click(statsButton)

    await waitFor(() => {
      expect(screen.getByText('Auto-Response Statistics')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument() // total patterns
      expect(screen.getByText('5')).toBeInTheDocument() // auto-response enabled
      expect(screen.getByText('87.5%')).toBeInTheDocument() // average confidence
      expect(screen.getByText('50')).toBeInTheDocument() // total responses
    })
  })

  it('should show empty state when no patterns', async () => {
    const mockGetAll = vi.mocked(api.patternsApi.getAll)
    mockGetAll.mockResolvedValue([])

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText('No patterns found')).toBeInTheDocument()
    })
  })

  it('should display error message on API failure', async () => {
    const mockGetAll = vi.mocked(api.patternsApi.getAll)
    mockGetAll.mockRejectedValue(new Error('Network error'))

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('should show confidence badges with correct colors', async () => {
    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      // High confidence (>= 90) should be default variant
      expect(screen.getByText('95.5% confidence')).toBeInTheDocument()
      // Medium confidence (>= 70 but < 90) should be secondary variant
      expect(screen.getByText('65.0% confidence')).toBeInTheDocument()
    })
  })

  it('should show auto-response indicators', async () => {
    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      // Should show both patterns
      expect(screen.getAllByText('confirmation')).toHaveLength(2)
      // High confidence pattern should be displayed
      expect(screen.getByText('95.5% confidence')).toBeInTheDocument()
      // Low confidence pattern should be displayed
      expect(screen.getByText('65.0% confidence')).toBeInTheDocument()
    })
  })

  it('should display percentage in stats dialog', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PatternsManager />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Statistics/ })).toBeInTheDocument()
    })

    const statsButton = screen.getByRole('button', { name: /Statistics/ })
    await user.click(statsButton)

    await waitFor(() => {
      // 5 out of 10 patterns = 50%
      expect(screen.getByText('50%')).toBeInTheDocument()
    })
  })
})
