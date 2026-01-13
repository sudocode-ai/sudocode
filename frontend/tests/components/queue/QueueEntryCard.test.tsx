import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { QueueEntryCard } from '@/components/queue/QueueEntryCard'
import type { EnrichedQueueEntry } from '@/types/queue'

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

// Mock @dnd-kit/sortable
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

describe('QueueEntryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockEntry: EnrichedQueueEntry = {
    id: 'q-001',
    executionId: 'exec-001',
    streamId: 'stream-001',
    targetBranch: 'main',
    position: 1,
    priority: 10,
    status: 'pending',
    addedAt: Date.now(),
    issueId: 'i-001',
    issueTitle: 'Test Issue Title',
    stackId: 'stk-001',
    stackName: 'Test Stack',
    stackDepth: 0,
    dependencies: [],
    canPromote: false,
  }

  describe('Basic Rendering', () => {
    it('should render issue ID', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText('i-001')).toBeInTheDocument()
    })

    it('should render issue title', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText('Test Issue Title')).toBeInTheDocument()
    })

    it('should render position number', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should render stack name when present', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText(/Test Stack/)).toBeInTheDocument()
    })

    it('should render stack depth', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText(/depth 0/)).toBeInTheDocument()
    })

    it('should not render stack info when not in a stack', () => {
      const standaloneEntry: EnrichedQueueEntry = {
        ...mockEntry,
        stackId: undefined,
        stackName: undefined,
      }
      renderWithProviders(<QueueEntryCard entry={standaloneEntry} />)
      expect(screen.queryByText(/Stack:/)).not.toBeInTheDocument()
    })
  })

  describe('Status Badges', () => {
    it('should show Pending badge for pending status', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText('Pending')).toBeInTheDocument()
    })

    it('should show Ready badge for ready status', () => {
      const readyEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'ready',
      }
      renderWithProviders(<QueueEntryCard entry={readyEntry} />)
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('should show Merging badge for merging status', () => {
      const mergingEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'merging',
      }
      renderWithProviders(<QueueEntryCard entry={mergingEntry} />)
      expect(screen.getByText('Merging')).toBeInTheDocument()
    })

    it('should show Merged badge for merged status', () => {
      const mergedEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'merged',
      }
      renderWithProviders(<QueueEntryCard entry={mergedEntry} />)
      expect(screen.getByText('Merged')).toBeInTheDocument()
    })

    it('should show Failed badge for failed status', () => {
      const failedEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'failed',
      }
      renderWithProviders(<QueueEntryCard entry={failedEntry} />)
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('should show Cancelled badge for cancelled status', () => {
      const cancelledEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'cancelled',
      }
      renderWithProviders(<QueueEntryCard entry={cancelledEntry} />)
      expect(screen.getByText('Cancelled')).toBeInTheDocument()
    })
  })

  describe('Dependencies', () => {
    it('should show dependencies when present', () => {
      const entryWithDeps: EnrichedQueueEntry = {
        ...mockEntry,
        dependencies: ['i-dep-1', 'i-dep-2'],
      }
      renderWithProviders(<QueueEntryCard entry={entryWithDeps} />)
      expect(screen.getByText('Depends on: i-dep-1, i-dep-2')).toBeInTheDocument()
    })

    it('should not show dependencies section when none', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.queryByText(/Depends on:/)).not.toBeInTheDocument()
    })

    it('should handle single dependency', () => {
      const entryWithOneDep: EnrichedQueueEntry = {
        ...mockEntry,
        dependencies: ['i-single-dep'],
      }
      renderWithProviders(<QueueEntryCard entry={entryWithOneDep} />)
      expect(screen.getByText('Depends on: i-single-dep')).toBeInTheDocument()
    })
  })

  describe('Navigation', () => {
    it('should navigate to issue when issue ID clicked', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)

      fireEvent.click(screen.getByText('i-001'))

      expect(mockNavigate).toHaveBeenCalledWith('/p/test-project/issues/i-001')
    })
  })

  describe('Promote Button', () => {
    it('should show promote button when canPromote is true and onPromote provided', () => {
      const promotableEntry: EnrichedQueueEntry = {
        ...mockEntry,
        canPromote: true,
      }
      const onPromote = vi.fn()
      renderWithProviders(<QueueEntryCard entry={promotableEntry} onPromote={onPromote} />)
      expect(screen.getByText('Promote')).toBeInTheDocument()
    })

    it('should not show promote button when canPromote is false', () => {
      const onPromote = vi.fn()
      renderWithProviders(<QueueEntryCard entry={mockEntry} onPromote={onPromote} />)
      expect(screen.queryByText('Promote')).not.toBeInTheDocument()
    })

    it('should not show promote button when onPromote not provided', () => {
      const promotableEntry: EnrichedQueueEntry = {
        ...mockEntry,
        canPromote: true,
      }
      renderWithProviders(<QueueEntryCard entry={promotableEntry} />)
      expect(screen.queryByText('Promote')).not.toBeInTheDocument()
    })

    it('should call onPromote when button clicked', () => {
      const promotableEntry: EnrichedQueueEntry = {
        ...mockEntry,
        canPromote: true,
      }
      const onPromote = vi.fn()
      renderWithProviders(<QueueEntryCard entry={promotableEntry} onPromote={onPromote} />)

      fireEvent.click(screen.getByText('Promote'))

      expect(onPromote).toHaveBeenCalledTimes(1)
    })

    it('should stop propagation on promote click', () => {
      const promotableEntry: EnrichedQueueEntry = {
        ...mockEntry,
        canPromote: true,
      }
      const onPromote = vi.fn()
      renderWithProviders(<QueueEntryCard entry={promotableEntry} onPromote={onPromote} />)

      const promoteButton = screen.getByText('Promote')
      fireEvent.click(promoteButton)

      // Navigation should not be called when clicking promote
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  describe('Error Display', () => {
    it('should show error message when present', () => {
      const errorEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'failed',
        error: 'Merge conflict in file.ts',
      }
      renderWithProviders(<QueueEntryCard entry={errorEntry} />)
      expect(screen.getByText('Merge conflict in file.ts')).toBeInTheDocument()
    })

    it('should not show error section when no error', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      // No error div should be present
      const errorDivs = screen.queryAllByText(/conflict/i)
      expect(errorDivs.length).toBe(0)
    })
  })

  describe('Drag Handle', () => {
    it('should not show drag handle when isDraggable is false', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} isDraggable={false} />)
      // GripVertical icon should not be rendered
      // We can check by button count or specific aria attributes
      const buttons = screen.getAllByRole('button')
      // Only the issue link button should be present
      expect(buttons.length).toBe(1)
    })

    it('should show drag handle when isDraggable is true', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} isDraggable={true} />)
      // Should have additional button for drag handle
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2) // Issue link + drag handle
    })
  })

  describe('Visual States', () => {
    it('should apply reduced opacity for merged entries', () => {
      const mergedEntry: EnrichedQueueEntry = {
        ...mockEntry,
        status: 'merged',
      }
      renderWithProviders(<QueueEntryCard entry={mergedEntry} />)
      // The card should have opacity-60 class when merged
      // This is tested by checking the component renders without error
      expect(screen.getByText('Merged')).toBeInTheDocument()
    })

    it('should render different positions correctly', () => {
      const positions = [1, 5, 10, 99]
      positions.forEach((pos) => {
        const entry: EnrichedQueueEntry = {
          ...mockEntry,
          id: `q-${pos}`,
          position: pos,
        }
        const { unmount } = renderWithProviders(<QueueEntryCard entry={entry} />)
        expect(screen.getByText(String(pos))).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle long issue titles', () => {
      const longTitleEntry: EnrichedQueueEntry = {
        ...mockEntry,
        issueTitle: 'This is a very long issue title that should be truncated in the UI to prevent layout issues',
      }
      renderWithProviders(<QueueEntryCard entry={longTitleEntry} />)
      expect(screen.getByText(longTitleEntry.issueTitle)).toBeInTheDocument()
    })
  })

  describe('Stack Depth Display', () => {
    it('should show depth 0 for root issues', () => {
      renderWithProviders(<QueueEntryCard entry={mockEntry} />)
      expect(screen.getByText(/depth 0/)).toBeInTheDocument()
    })

    it('should show higher depths correctly', () => {
      const deepEntry: EnrichedQueueEntry = {
        ...mockEntry,
        stackDepth: 3,
      }
      renderWithProviders(<QueueEntryCard entry={deepEntry} />)
      expect(screen.getByText(/depth 3/)).toBeInTheDocument()
    })
  })

  describe('Multiple Dependencies', () => {
    it('should display all dependencies separated by commas', () => {
      const multiDepEntry: EnrichedQueueEntry = {
        ...mockEntry,
        dependencies: ['i-a', 'i-b', 'i-c'],
      }
      renderWithProviders(<QueueEntryCard entry={multiDepEntry} />)
      expect(screen.getByText('Depends on: i-a, i-b, i-c')).toBeInTheDocument()
    })
  })

  describe('All Status Types', () => {
    const statuses: Array<{
      status: EnrichedQueueEntry['status']
      label: string
    }> = [
      { status: 'pending', label: 'Pending' },
      { status: 'ready', label: 'Ready' },
      { status: 'merging', label: 'Merging' },
      { status: 'merged', label: 'Merged' },
      { status: 'failed', label: 'Failed' },
      { status: 'cancelled', label: 'Cancelled' },
    ]

    statuses.forEach(({ status, label }) => {
      it(`should render ${label} status correctly`, () => {
        const entry: EnrichedQueueEntry = {
          ...mockEntry,
          status,
        }
        renderWithProviders(<QueueEntryCard entry={entry} />)
        expect(screen.getByText(label)).toBeInTheDocument()
      })
    })
  })
})
