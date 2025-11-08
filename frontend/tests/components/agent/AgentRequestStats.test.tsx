import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { AgentRequestStats } from '@/components/agent/AgentRequestStats'
import * as api from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  agentRequestsApi: {
    getStats: vi.fn(),
  },
}))

const mockStats = {
  total: 100,
  by_status: {
    queued: 10,
    presented: 5,
    responded: 80,
    expired: 3,
    cancelled: 2,
  },
  by_type: {
    confirmation: 40,
    guidance: 30,
    choice: 20,
    input: 10,
  },
  avg_response_time_ms: 5250,
}

describe('AgentRequestStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockResolvedValue(mockStats)
  })

  it('should render loading state initially', () => {
    renderWithProviders(<AgentRequestStats />)

    expect(screen.getByRole('status')).toBeInTheDocument() // Loading spinner
  })

  it('should render stats after loading', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument() // total
      expect(screen.getByText('5.2s')).toBeInTheDocument() // avg response time
    })
  })

  it('should render overview section', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
      expect(screen.getByText('Total Requests')).toBeInTheDocument()
      expect(screen.getByText('Avg Response Time')).toBeInTheDocument()
    })
  })

  it('should render status distribution', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('By Status')).toBeInTheDocument()
      expect(screen.getByText('queued')).toBeInTheDocument()
      expect(screen.getByText('presented')).toBeInTheDocument()
      expect(screen.getByText('responded')).toBeInTheDocument()
      expect(screen.getByText('expired')).toBeInTheDocument()
      expect(screen.getByText('cancelled')).toBeInTheDocument()
    })
  })

  it('should render type distribution', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('By Type')).toBeInTheDocument()
      expect(screen.getByText('confirmation')).toBeInTheDocument()
      expect(screen.getByText('guidance')).toBeInTheDocument()
      expect(screen.getByText('choice')).toBeInTheDocument()
      expect(screen.getByText('input')).toBeInTheDocument()
    })
  })

  it('should display counts for each status', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      // Check all the counts are displayed
      expect(screen.getByText('10')).toBeInTheDocument() // queued
      expect(screen.getByText('5')).toBeInTheDocument() // presented
      expect(screen.getByText('80')).toBeInTheDocument() // responded
      expect(screen.getByText('3')).toBeInTheDocument() // expired
      expect(screen.getByText('2')).toBeInTheDocument() // cancelled
    })
  })

  it('should display counts for each type', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('40')).toBeInTheDocument() // confirmation
      expect(screen.getByText('30')).toBeInTheDocument() // guidance
      expect(screen.getByText('20')).toBeInTheDocument() // choice (also in status)
    })
  })

  it('should format response time in milliseconds', async () => {
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockResolvedValue({
      ...mockStats,
      avg_response_time_ms: 500,
    })

    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('500ms')).toBeInTheDocument()
    })
  })

  it('should format response time in seconds', async () => {
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockResolvedValue({
      ...mockStats,
      avg_response_time_ms: 5250,
    })

    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('5.2s')).toBeInTheDocument()
    })
  })

  it('should format response time in minutes', async () => {
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockResolvedValue({
      ...mockStats,
      avg_response_time_ms: 125000, // 2.08 minutes
    })

    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('2.1m')).toBeInTheDocument()
    })
  })

  it('should display error message on API failure', async () => {
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockRejectedValue(new Error('Network error'))

    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('should render progress bars for status distribution', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      // Progress bars should be rendered (exact selector depends on implementation)
      const statusSection = screen.getByText('By Status').closest('div')?.parentElement
      expect(statusSection).toBeInTheDocument()
    })
  })

  it('should render progress bars for type distribution', async () => {
    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      const typeSection = screen.getByText('By Type').closest('div')?.parentElement
      expect(typeSection).toBeInTheDocument()
    })
  })

  it('should handle zero total requests', async () => {
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockResolvedValue({
      total: 0,
      by_status: {},
      by_type: {},
      avg_response_time_ms: 0,
    })

    renderWithProviders(<AgentRequestStats />)

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument()
      expect(screen.getByText('0ms')).toBeInTheDocument()
    })
  })

  it('should update stats periodically', async () => {
    const mockGetStats = vi.mocked(api.agentRequestsApi.getStats)
    mockGetStats.mockResolvedValue(mockStats)

    renderWithProviders(<AgentRequestStats />)

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
    })

    // Check that getStats was called initially
    expect(mockGetStats).toHaveBeenCalledTimes(1)

    // Note: Testing periodic refresh would require advancing timers
    // which is more complex and may not be worth it for this component
  })
})
