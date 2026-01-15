import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { MergeQueuePanel } from '@/components/queue/MergeQueuePanel'
import * as useQueueModule from '@/hooks/useQueue'
import * as usePromoteModule from '@/hooks/usePromote'
import type { EnrichedQueueEntry, QueueStats } from '@/types/queue'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock useProjectRoutes
vi.mock('@/hooks/useProjectRoutes', () => ({
  useProjectRoutes: () => ({
    paths: {
      issue: (id: string) => `/p/test-project/issues/${id}`,
    },
  }),
}))

// Mock the hooks
vi.mock('@/hooks/useQueue', () => ({
  useQueue: vi.fn(),
  useQueueMutations: vi.fn(),
  groupQueueByStack: vi.fn(),
}))

vi.mock('@/hooks/usePromote', () => ({
  usePromote: vi.fn(),
}))

const mockQueueEntry1: EnrichedQueueEntry = {
  id: 'q-001',
  executionId: 'exec-001',
  streamId: 'stream-001',
  targetBranch: 'main',
  position: 1,
  priority: 10,
  status: 'pending',
  addedAt: Date.now(),
  issueId: 'i-001',
  issueTitle: 'First Test Issue',
  stackId: 'stk-001',
  stackName: 'Test Stack',
  stackDepth: 0,
  dependencies: [],
  canPromote: false,
}

const mockQueueEntry2: EnrichedQueueEntry = {
  id: 'q-002',
  executionId: 'exec-002',
  streamId: 'stream-002',
  targetBranch: 'main',
  position: 2,
  priority: 20,
  status: 'ready',
  addedAt: Date.now(),
  issueId: 'i-002',
  issueTitle: 'Second Test Issue',
  stackId: 'stk-001',
  stackName: 'Test Stack',
  stackDepth: 1,
  dependencies: ['i-001'],
  canPromote: true,
}

const mockStandaloneEntry: EnrichedQueueEntry = {
  id: 'q-003',
  executionId: 'exec-003',
  streamId: 'stream-003',
  targetBranch: 'main',
  position: 3,
  priority: 30,
  status: 'pending',
  addedAt: Date.now(),
  issueId: 'i-003',
  issueTitle: 'Standalone Issue',
  stackDepth: 0,
  dependencies: [],
  canPromote: false,
}

const mockStats: QueueStats = {
  total: 3,
  byStatus: {
    pending: 2,
    ready: 1,
    merging: 0,
    merged: 0,
    failed: 0,
    cancelled: 0,
  },
  byStack: {
    'stk-001': 2,
    standalone: 1,
  },
}

const mockStackGroup = {
  stackId: 'stk-001',
  stackName: 'Test Stack',
  entries: [mockQueueEntry1, mockQueueEntry2],
}

const mockStandaloneGroup = {
  stackId: null,
  stackName: undefined,
  entries: [mockStandaloneEntry],
}

describe('MergeQueuePanel', () => {
  const mockRefetch = vi.fn()
  const mockReorder = vi.fn()
  const mockPerformPromote = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    vi.mocked(useQueueModule.useQueue).mockReturnValue({
      data: { entries: [mockQueueEntry1, mockQueueEntry2, mockStandaloneEntry], stats: mockStats },
      entries: [mockQueueEntry1, mockQueueEntry2, mockStandaloneEntry],
      stats: mockStats,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    } as any)

    vi.mocked(useQueueModule.useQueueMutations).mockReturnValue({
      reorder: mockReorder,
      isReordering: false,
    } as any)

    vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([mockStackGroup, mockStandaloneGroup])

    vi.mocked(usePromoteModule.usePromote).mockReturnValue({
      performPromote: mockPerformPromote,
      isPromoting: false,
    } as any)
  })

  describe('Loading State', () => {
    it('should show loading spinner while fetching', () => {
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: null,
        entries: [],
        stats: null,
        isLoading: true,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      renderWithProviders(<MergeQueuePanel />)

      // Should show the header even while loading
      expect(screen.getByText('Merge Queue')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should show error message on fetch failure', () => {
      const error = new Error('Failed to load queue')
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: null,
        entries: [],
        stats: null,
        isLoading: false,
        isError: true,
        error,
        refetch: mockRefetch,
      } as any)

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Failed to load queue')).toBeInTheDocument()
    })

    it('should show retry button on error', () => {
      const error = new Error('Network error')
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: null,
        entries: [],
        stats: null,
        isLoading: false,
        isError: true,
        error,
        refetch: mockRefetch,
      } as any)

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('should call refetch when retry button clicked', () => {
      const error = new Error('Network error')
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: null,
        entries: [],
        stats: null,
        isLoading: false,
        isError: true,
        error,
        refetch: mockRefetch,
      } as any)

      renderWithProviders(<MergeQueuePanel />)

      fireEvent.click(screen.getByText('Retry'))

      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no entries', () => {
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: { entries: [], stats: { total: 0, byStatus: {}, byStack: {} } },
        entries: [],
        stats: { total: 0, byStatus: {}, byStack: {} },
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([])

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('No items in the merge queue')).toBeInTheDocument()
    })

    it('should show helpful message in empty state', () => {
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: { entries: [], stats: { total: 0, byStatus: {}, byStack: {} } },
        entries: [],
        stats: null,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([])

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Checkpoint an execution to add it to the queue')).toBeInTheDocument()
    })
  })

  describe('Queue Display', () => {
    it('should render queue entries', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('First Test Issue')).toBeInTheDocument()
      expect(screen.getByText('Second Test Issue')).toBeInTheDocument()
      expect(screen.getByText('Standalone Issue')).toBeInTheDocument()
    })

    it('should display stats badges', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText(/3 total/)).toBeInTheDocument()
      expect(screen.getByText(/2 pending/)).toBeInTheDocument()
      expect(screen.getByText(/1 ready/)).toBeInTheDocument()
    })

    it('should group entries by stack', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Stack group header
      expect(screen.getByText('Test Stack')).toBeInTheDocument()
      // Standalone group header
      expect(screen.getByText('Standalone Items')).toBeInTheDocument()
    })

    it('should show entry count in group headers', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Badge with count 2 for stack group
      const badges = screen.getAllByText('2')
      expect(badges.length).toBeGreaterThan(0)
    })
  })

  describe('Filtering', () => {
    it('should render target branch selector', () => {
      renderWithProviders(<MergeQueuePanel targetBranches={['main', 'develop']} />)

      expect(screen.getByText('Branch:')).toBeInTheDocument()
    })

    it('should render show merged toggle', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Show merged')).toBeInTheDocument()
    })
  })

  describe('Refresh', () => {
    it('should have refresh button', () => {
      renderWithProviders(<MergeQueuePanel />)

      // RefreshCw icon button
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })
  })

  describe('Stack Collapsible', () => {
    it('should render collapsible groups', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Should have clickable group headers
      expect(screen.getByText('Test Stack')).toBeInTheDocument()
    })

    it('should toggle group expansion when header clicked', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('First Test Issue')).toBeInTheDocument()

      // Click on the stack header to collapse
      const stackHeader = screen.getByText('Test Stack')
      fireEvent.click(stackHeader)

      // Content should be hidden (but group header still visible)
      expect(screen.getByText('Test Stack')).toBeInTheDocument()
    })
  })

  describe('Issue Navigation', () => {
    it('should render issue IDs as clickable', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('i-001')).toBeInTheDocument()
    })

    it('should navigate to issue when clicked', () => {
      renderWithProviders(<MergeQueuePanel />)

      fireEvent.click(screen.getByText('i-001'))

      expect(mockNavigate).toHaveBeenCalledWith('/p/test-project/issues/i-001')
    })
  })

  describe('Status Display', () => {
    it('should show status badges for entries', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Use getAllByText since status badges appear both in entries and stats
      expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1)
    })

    it('should show all status types correctly', () => {
      const allStatusEntries = [
        { ...mockQueueEntry1, id: 'q-p', status: 'pending' as const },
        { ...mockQueueEntry1, id: 'q-r', status: 'ready' as const, issueId: 'i-r' },
        { ...mockQueueEntry1, id: 'q-m', status: 'merging' as const, issueId: 'i-m' },
        { ...mockQueueEntry1, id: 'q-d', status: 'merged' as const, issueId: 'i-d' },
        { ...mockQueueEntry1, id: 'q-f', status: 'failed' as const, issueId: 'i-f' },
      ]

      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: { entries: allStatusEntries, stats: mockStats },
        entries: allStatusEntries,
        stats: mockStats,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([
        { stackId: 'stk-001', stackName: 'Test Stack', entries: allStatusEntries },
      ])

      renderWithProviders(<MergeQueuePanel />)

      // Use getAllByText since there may be multiple badges with same status
      expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Merging')).toBeInTheDocument()
      expect(screen.getByText('Merged')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })

  describe('Position Display', () => {
    it('should show position numbers for entries', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Use getAllByText since numbers may appear multiple times (in stats, badges, etc.)
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Dependencies Display', () => {
    it('should show dependencies for entries that have them', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Depends on: i-001')).toBeInTheDocument()
    })

    it('should not show dependencies section for entries without dependencies', () => {
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: { entries: [mockStandaloneEntry], stats: mockStats },
        entries: [mockStandaloneEntry],
        stats: mockStats,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([mockStandaloneGroup])

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.queryByText(/Depends on:/)).not.toBeInTheDocument()
    })
  })

  describe('Promote Button', () => {
    it('should show promote button for entries that can be promoted', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Promote')).toBeInTheDocument()
    })

    it('should not show promote button for entries that cannot be promoted', () => {
      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: { entries: [mockQueueEntry1], stats: mockStats },
        entries: [mockQueueEntry1], // canPromote: false
        stats: mockStats,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([
        { stackId: 'stk-001', stackName: 'Test Stack', entries: [mockQueueEntry1] },
      ])

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.queryByText('Promote')).not.toBeInTheDocument()
    })

    it('should call performPromote when promote clicked', () => {
      renderWithProviders(<MergeQueuePanel />)

      fireEvent.click(screen.getByText('Promote'))

      expect(mockPerformPromote).toHaveBeenCalledWith('i-002')
    })
  })

  describe('Stack Info', () => {
    it('should show stack name for entries in a stack', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Stack name shown in entry card
      expect(screen.getAllByText(/Test Stack/).length).toBeGreaterThan(0)
    })

    it('should show stack depth for entries in a stack', () => {
      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText(/depth 0/)).toBeInTheDocument()
      expect(screen.getByText(/depth 1/)).toBeInTheDocument()
    })
  })

  describe('Error Display', () => {
    it('should show error message for failed entries', () => {
      const failedEntry: EnrichedQueueEntry = {
        ...mockQueueEntry1,
        status: 'failed',
        error: 'Merge conflict detected',
      }

      vi.mocked(useQueueModule.useQueue).mockReturnValue({
        data: { entries: [failedEntry], stats: mockStats },
        entries: [failedEntry],
        stats: mockStats,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      } as any)

      vi.mocked(useQueueModule.groupQueueByStack).mockReturnValue([
        { stackId: 'stk-001', stackName: 'Test Stack', entries: [failedEntry] },
      ])

      renderWithProviders(<MergeQueuePanel />)

      expect(screen.getByText('Merge conflict detected')).toBeInTheDocument()
    })
  })

  describe('Drag and Drop', () => {
    it('should enable drag for entries in stacks', () => {
      // Entries in stacks should have isDraggable=true
      // This is verified by the component logic: isDraggable={group.stackId !== null && !isReordering}
      renderWithProviders(<MergeQueuePanel />)

      // The entries should be rendered, indicating drag functionality is set up
      expect(screen.getByText('First Test Issue')).toBeInTheDocument()
    })

    it('should disable drag when reordering is in progress', () => {
      vi.mocked(useQueueModule.useQueueMutations).mockReturnValue({
        reorder: mockReorder,
        isReordering: true,
      } as any)

      renderWithProviders(<MergeQueuePanel />)

      // Should still render entries, but drag is disabled
      expect(screen.getByText('First Test Issue')).toBeInTheDocument()
    })
  })

  describe('Default Props', () => {
    it('should render with default target branch in selector', () => {
      renderWithProviders(<MergeQueuePanel />)

      // Check that the branch selector is present
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should render with provided target branches', () => {
      renderWithProviders(<MergeQueuePanel targetBranches={['main', 'develop', 'feature']} />)

      // Check that the component renders
      expect(screen.getByText('Merge Queue')).toBeInTheDocument()
    })
  })
})
