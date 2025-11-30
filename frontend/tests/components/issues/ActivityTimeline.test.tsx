import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ActivityTimeline } from '@/components/issues/ActivityTimeline'
import type { IssueFeedback } from '@sudocode-ai/types'
import type { Execution } from '@/types/execution'
import { executionsApi } from '@/lib/api'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock the executionsApi for ExecutionView
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    executionsApi: {
      ...actual.executionsApi,
      getChain: vi.fn(),
      worktreeExists: vi.fn(),
      cancel: vi.fn(),
      delete: vi.fn(),
      createFollowUp: vi.fn(),
      deleteWorktree: vi.fn(),
      list: vi.fn(),
    },
  }
})

const createMockFeedback = (overrides: Partial<IssueFeedback> = {}): IssueFeedback => ({
  id: 'fb-001',
  from_id: 'i-abc1',
  from_uuid: 'from-uuid-1',
  to_id: 's-xyz1',
  to_uuid: 'to-uuid-1',
  feedback_type: 'comment',
  content: 'This is feedback content',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  ...overrides,
})

const createMockExecution = (overrides: Partial<Execution> = {}): Execution => ({
  id: 'exec-001',
  issue_id: 'i-abc1',
  issue_uuid: null,
  mode: null,
  prompt: null,
  config: null,
  agent_type: 'claude-code',
  session_id: null,
  workflow_execution_id: null,
  target_branch: 'main',
  branch_name: 'exec-001',
  before_commit: null,
  after_commit: null,
  worktree_path: null,
  status: 'completed',
  created_at: '2024-01-15T12:00:00Z',
  updated_at: '2024-01-15T12:30:00Z',
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  exit_code: null,
  error_message: null,
  error: null,
  model: null,
  summary: null,
  files_changed: null,
  parent_execution_id: null,
  step_type: null,
  step_index: null,
  step_config: null,
  ...overrides,
})

describe('ActivityTimeline', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    vi.clearAllMocks()

    // Setup default mock responses for ExecutionView
    vi.mocked(executionsApi.getChain).mockResolvedValue({
      rootId: 'exec-001',
      executions: [createMockExecution()],
    })
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: false })
  })

  describe('empty state', () => {
    it('should show "No activity yet" when items array is empty', () => {
      renderWithProviders(<ActivityTimeline items={[]} currentEntityId="i-abc1" />)

      expect(screen.getByText('No activity yet')).toBeInTheDocument()
    })
  })

  describe('feedback rendering', () => {
    it('should render feedback items', () => {
      const feedback = createMockFeedback({ content: 'Test feedback message' })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      expect(screen.getByText('Test feedback message')).toBeInTheDocument()
      expect(screen.getByText('comment')).toBeInTheDocument()
    })

    it('should render feedback type badge with correct color for comment', () => {
      const feedback = createMockFeedback({ feedback_type: 'comment' })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      const badge = screen.getByText('comment')
      expect(badge).toHaveClass('bg-blue-100')
    })

    it('should render feedback type badge with correct color for suggestion', () => {
      const feedback = createMockFeedback({ feedback_type: 'suggestion' })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      const badge = screen.getByText('suggestion')
      expect(badge).toHaveClass('bg-purple-100')
    })

    it('should render feedback type badge with correct color for request', () => {
      const feedback = createMockFeedback({ feedback_type: 'request' })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      const badge = screen.getByText('request')
      expect(badge).toHaveClass('bg-orange-100')
    })

    it('should show dismissed badge when feedback is dismissed', () => {
      const feedback = createMockFeedback({ dismissed: true })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      expect(screen.getByText('dismissed')).toBeInTheDocument()
    })

    it('should show agent name when present', () => {
      const feedback = createMockFeedback({ agent: 'claude-code' })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      expect(screen.getByText(/claude-code/)).toBeInTheDocument()
    })

    it('should render anchor info when present', () => {
      const feedback = createMockFeedback({
        anchor: JSON.stringify({ line_number: 42, text_snippet: 'some code' }),
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      expect(screen.getByText(/Line 42/)).toBeInTheDocument()
      // The component renders with curly quotes (ldquo/rdquo)
      expect(screen.getByText(/some code/)).toBeInTheDocument()
    })
  })

  describe('outbound vs inbound feedback', () => {
    it('should style outbound feedback with purple icon (feedback FROM current entity)', () => {
      // Current entity is i-abc1, feedback is FROM i-abc1 TO s-xyz1
      const feedback = createMockFeedback({
        from_id: 'i-abc1',
        to_id: 's-xyz1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      const { container } = renderWithProviders(
        <ActivityTimeline items={items} currentEntityId="i-abc1" />
      )

      // Outbound should have purple icon
      const icon = container.querySelector('.text-purple-600')
      expect(icon).toBeInTheDocument()
    })

    it('should style inbound feedback with blue icon (feedback TO current entity)', () => {
      // Current entity is i-abc1, feedback is FROM i-xyz1 TO i-abc1
      const feedback = createMockFeedback({
        from_id: 'i-xyz1',
        to_id: 'i-abc1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      const { container } = renderWithProviders(
        <ActivityTimeline items={items} currentEntityId="i-abc1" />
      )

      // Inbound should have blue icon
      const icon = container.querySelector('.text-blue-600')
      expect(icon).toBeInTheDocument()
    })

    it('should show arrow and target entity for outbound feedback', () => {
      const feedback = createMockFeedback({
        from_id: 'i-abc1',
        to_id: 's-xyz1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      // Should show the target spec ID
      expect(screen.getByText('s-xyz1')).toBeInTheDocument()
    })

    it('should show "from" label and source entity for inbound feedback', () => {
      const feedback = createMockFeedback({
        from_id: 'i-xyz1',
        to_id: 'i-abc1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      // Should show "from" text and the source issue ID
      expect(screen.getByText('from')).toBeInTheDocument()
      expect(screen.getByText('i-xyz1')).toBeInTheDocument()
    })

    it('should navigate to spec page when clicking outbound feedback target (spec)', async () => {
      const user = userEvent.setup()
      const feedback = createMockFeedback({
        from_id: 'i-abc1',
        to_id: 's-xyz1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      const targetBadge = screen.getByText('s-xyz1')
      await user.click(targetBadge)

      expect(mockNavigate).toHaveBeenCalledWith('/specs/s-xyz1')
    })

    it('should navigate to issue page when clicking outbound feedback target (issue)', async () => {
      const user = userEvent.setup()
      const feedback = createMockFeedback({
        from_id: 'i-abc1',
        to_id: 'i-def2',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      const targetBadge = screen.getByText('i-def2')
      await user.click(targetBadge)

      expect(mockNavigate).toHaveBeenCalledWith('/issues/i-def2')
    })

    it('should navigate to issue page when clicking inbound feedback source', async () => {
      const user = userEvent.setup()
      const feedback = createMockFeedback({
        from_id: 'i-xyz1',
        to_id: 'i-abc1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      const sourceBadge = screen.getByText('i-xyz1')
      await user.click(sourceBadge)

      expect(mockNavigate).toHaveBeenCalledWith('/issues/i-xyz1')
    })

    it('should use spec badge variant for spec entities', () => {
      const feedback = createMockFeedback({
        from_id: 'i-abc1',
        to_id: 's-xyz1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      const { container } = renderWithProviders(
        <ActivityTimeline items={items} currentEntityId="i-abc1" />
      )

      // Spec badge should have purple styling
      const specBadge = container.querySelector('.bg-purple-500\\/10')
      expect(specBadge).toBeInTheDocument()
    })

    it('should use issue badge variant for issue entities', () => {
      const feedback = createMockFeedback({
        from_id: 'i-xyz1',
        to_id: 'i-abc1',
      })
      const items = [{ ...feedback, itemType: 'feedback' as const }]

      const { container } = renderWithProviders(
        <ActivityTimeline items={items} currentEntityId="i-abc1" />
      )

      // Issue badge should have blue styling
      const issueBadge = container.querySelector('.bg-blue-500\\/10')
      expect(issueBadge).toBeInTheDocument()
    })
  })

  describe('execution rendering', () => {
    it('should render InlineExecutionView component for execution items', () => {
      const execution = createMockExecution({ id: 'exec-001' })
      const items = [{ ...execution, itemType: 'execution' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      // InlineExecutionView will show loading state or error state depending on API mock
      // We just verify that InlineExecutionView is rendered (it will show either loading or error state)
      const loadingOrError =
        screen.queryByText('Loading execution...') || screen.queryByText('Error Loading Execution')
      expect(loadingOrError).toBeInTheDocument()
    })

    it('should call getChain API when rendering execution', () => {
      const execution = createMockExecution({ id: 'exec-001' })
      const items = [{ ...execution, itemType: 'execution' as const }]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      // InlineExecutionView should attempt to load the execution chain
      expect(executionsApi.getChain).toHaveBeenCalledWith('exec-001')
    })
  })

  describe('sorting', () => {
    it('should sort items chronologically (oldest first)', () => {
      const olderFeedback = createMockFeedback({
        id: 'fb-old',
        content: 'Older feedback',
        created_at: '2024-01-10T10:00:00Z',
      })
      const newerFeedback = createMockFeedback({
        id: 'fb-new',
        content: 'Newer feedback',
        created_at: '2024-01-20T10:00:00Z',
      })
      const items = [
        { ...newerFeedback, itemType: 'feedback' as const },
        { ...olderFeedback, itemType: 'feedback' as const },
      ]

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      // Get the actual content elements (not the badges)
      const contents = screen.getAllByText(/Older feedback|Newer feedback/)
      expect(contents[0]).toHaveTextContent('Older feedback')
      expect(contents[1]).toHaveTextContent('Newer feedback')
    })
  })

  describe('mixed items', () => {
    it('should render both feedback and executions together', async () => {
      const feedback = createMockFeedback({ content: 'Feedback message' })
      const execution = createMockExecution({ id: 'exec-001' })
      const items = [
        { ...feedback, itemType: 'feedback' as const },
        { ...execution, itemType: 'execution' as const },
      ]

      vi.mocked(executionsApi.getChain).mockResolvedValue({
        rootId: 'exec-001',
        executions: [execution],
      })

      renderWithProviders(<ActivityTimeline items={items} currentEntityId="i-abc1" />)

      expect(screen.getByText('Feedback message')).toBeInTheDocument()
      // ExecutionView shows loading state initially
      expect(screen.getByText('Loading execution...')).toBeInTheDocument()
    })
  })
})
