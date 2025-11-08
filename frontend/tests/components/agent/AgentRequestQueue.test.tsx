import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { AgentRequestQueue } from '@/components/agent/AgentRequestQueue'
import type { AgentRequest } from '@/types/api'
import * as api from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  agentRequestsApi: {
    respond: vi.fn(),
    cancel: vi.fn(),
  },
}))

const mockPendingRequest: AgentRequest = {
  id: 'req-1',
  execution_id: 'exec-1',
  issue_id: 'ISSUE-001',
  type: 'confirmation',
  message: 'Can I proceed with deployment?',
  keywords: ['deploy', 'proceed'],
  issue_priority: 'high',
  urgency: 'blocking',
  status: 'queued',
  created_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
}

const mockChoiceRequest: AgentRequest = {
  id: 'req-2',
  execution_id: 'exec-2',
  issue_id: 'ISSUE-002',
  type: 'choice',
  message: 'Which approach should I use?',
  options: ['Option A', 'Option B', 'Option C'],
  issue_priority: 'medium',
  status: 'queued',
  created_at: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
}

describe('AgentRequestQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state when no requests', () => {
    renderWithProviders(<AgentRequestQueue requests={[]} />)

    expect(screen.getByText('No pending requests')).toBeInTheDocument()
    expect(screen.getByText('All agent requests have been handled')).toBeInTheDocument()
  })

  it('should render pending requests with details', () => {
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    expect(screen.getByText('Can I proceed with deployment?')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('Blocking')).toBeInTheDocument()
    expect(screen.getByText('deploy')).toBeInTheDocument()
    expect(screen.getByText('proceed')).toBeInTheDocument()
  })

  it('should display time since creation', () => {
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    expect(screen.getByText(/ago/)).toBeInTheDocument()
  })

  it('should show respond button', () => {
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    expect(screen.getByRole('button', { name: 'Respond' })).toBeInTheDocument()
  })

  it('should show cancel button', () => {
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    expect(screen.getByRole('button', { name: 'Cancel Request' })).toBeInTheDocument()
  })

  it('should show input field when respond button clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    const respondButton = screen.getByRole('button', { name: 'Respond' })
    await user.click(respondButton)

    expect(screen.getByPlaceholderText('Enter your response...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('should show select dropdown for choice requests', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AgentRequestQueue requests={[mockChoiceRequest]} />)

    const respondButton = screen.getByRole('button', { name: 'Respond' })
    await user.click(respondButton)

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('should submit response when submit button clicked', async () => {
    const user = userEvent.setup()
    const onRequestRespond = vi.fn()
    const mockRespond = vi.mocked(api.agentRequestsApi.respond)
    mockRespond.mockResolvedValue(undefined)

    renderWithProviders(
      <AgentRequestQueue requests={[mockPendingRequest]} onRequestRespond={onRequestRespond} />
    )

    // Click respond
    const respondButton = screen.getByRole('button', { name: 'Respond' })
    await user.click(respondButton)

    // Enter response
    const input = screen.getByPlaceholderText('Enter your response...')
    await user.type(input, 'yes')

    // Submit
    const submitButton = screen.getByRole('button', { name: 'Submit' })
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockRespond).toHaveBeenCalledWith('req-1', { value: 'yes' })
      expect(onRequestRespond).toHaveBeenCalled()
    })
  })

  it('should submit response when Enter key pressed', async () => {
    const user = userEvent.setup()
    const onRequestRespond = vi.fn()
    const mockRespond = vi.mocked(api.agentRequestsApi.respond)
    mockRespond.mockResolvedValue(undefined)

    renderWithProviders(
      <AgentRequestQueue requests={[mockPendingRequest]} onRequestRespond={onRequestRespond} />
    )

    // Click respond
    const respondButton = screen.getByRole('button', { name: 'Respond' })
    await user.click(respondButton)

    // Enter response and press Enter
    const input = screen.getByPlaceholderText('Enter your response...')
    await user.type(input, 'yes{Enter}')

    await waitFor(() => {
      expect(mockRespond).toHaveBeenCalledWith('req-1', { value: 'yes' })
      expect(onRequestRespond).toHaveBeenCalled()
    })
  })

  it('should cancel response form when cancel button clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    // Click respond
    const respondButton = screen.getByRole('button', { name: 'Respond' })
    await user.click(respondButton)

    // Click cancel
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    await user.click(cancelButton)

    // Form should be hidden
    expect(screen.queryByPlaceholderText('Enter your response...')).not.toBeInTheDocument()
  })

  it('should cancel request when cancel request button clicked', async () => {
    const user = userEvent.setup()
    const onRequestRespond = vi.fn()
    const mockCancel = vi.mocked(api.agentRequestsApi.cancel)
    mockCancel.mockResolvedValue(undefined)

    renderWithProviders(
      <AgentRequestQueue requests={[mockPendingRequest]} onRequestRespond={onRequestRespond} />
    )

    const cancelButton = screen.getByRole('button', { name: 'Cancel Request' })
    await user.click(cancelButton)

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith('req-1')
      expect(onRequestRespond).toHaveBeenCalled()
    })
  })

  it('should display error message on API failure', async () => {
    const user = userEvent.setup()
    const mockRespond = vi.mocked(api.agentRequestsApi.respond)
    mockRespond.mockRejectedValue(new Error('Network error'))

    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest]} />)

    // Click respond
    const respondButton = screen.getByRole('button', { name: 'Respond' })
    await user.click(respondButton)

    // Enter response
    const input = screen.getByPlaceholderText('Enter your response...')
    await user.type(input, 'yes')

    // Submit
    const submitButton = screen.getByRole('button', { name: 'Submit' })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('should render multiple requests', () => {
    renderWithProviders(<AgentRequestQueue requests={[mockPendingRequest, mockChoiceRequest]} />)

    expect(screen.getByText('Can I proceed with deployment?')).toBeInTheDocument()
    expect(screen.getByText('Which approach should I use?')).toBeInTheDocument()
  })

  it('should show auto-responded badge for auto responses', () => {
    const autoRequest: AgentRequest = {
      ...mockPendingRequest,
      response_auto: true,
    }

    renderWithProviders(<AgentRequestQueue requests={[autoRequest]} />)

    expect(screen.getByText('Auto-responded')).toBeInTheDocument()
  })

  it('should display context when provided', () => {
    const requestWithContext: AgentRequest = {
      ...mockPendingRequest,
      context: { file: 'src/deploy.ts', line: 42 },
    }

    renderWithProviders(<AgentRequestQueue requests={[requestWithContext]} />)

    expect(screen.getByText(/Context:/)).toBeInTheDocument()
  })

  it('should show priority badges with correct colors', () => {
    const criticalRequest: AgentRequest = {
      ...mockPendingRequest,
      issue_priority: 'critical',
    }

    renderWithProviders(<AgentRequestQueue requests={[criticalRequest]} />)

    const badge = screen.getByText('critical')
    expect(badge).toBeInTheDocument()
  })
})
