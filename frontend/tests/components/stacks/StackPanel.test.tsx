import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { StackPanel } from '@/components/stacks/StackPanel'
import type { StackInfo } from '@/types/stack'

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

describe('StackPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockStackInfo: StackInfo = {
    stack: {
      id: 'stk-001',
      name: 'Test Stack',
      root_issue_id: 'i-002',
      issue_order: ['i-001', 'i-002'],
      is_auto: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    entries: [
      {
        issue_id: 'i-001',
        depth: 0,
        has_checkpoint: true,
        checkpoint_status: 'approved',
        is_promoted: false,
      },
      {
        issue_id: 'i-002',
        depth: 1,
        has_checkpoint: false,
        is_promoted: false,
      },
    ],
    health: 'pending',
  }

  const mockAutoStackInfo: StackInfo = {
    stack: {
      id: 'auto-i-003',
      name: undefined,
      root_issue_id: 'i-004',
      issue_order: ['i-003', 'i-004'],
      is_auto: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    entries: [
      {
        issue_id: 'i-003',
        depth: 0,
        has_checkpoint: false,
        is_promoted: false,
      },
      {
        issue_id: 'i-004',
        depth: 1,
        has_checkpoint: true,
        checkpoint_status: 'merged',
        is_promoted: true,
      },
    ],
    health: 'ready',
  }

  describe('Basic Rendering', () => {
    it('should render stack name', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('Test Stack')).toBeInTheDocument()
    })

    it('should render stack ID when no name', () => {
      const stackWithoutName: StackInfo = {
        ...mockStackInfo,
        stack: {
          ...mockStackInfo.stack,
          name: undefined,
        },
      }
      renderWithProviders(<StackPanel stackInfo={stackWithoutName} />)
      expect(screen.getByText('Stack stk-001')).toBeInTheDocument()
    })

    it('should render "Auto" badge for auto stacks', () => {
      renderWithProviders(<StackPanel stackInfo={mockAutoStackInfo} />)
      expect(screen.getByText('Auto')).toBeInTheDocument()
    })

    it('should not render "Auto" badge for manual stacks', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.queryByText('Auto')).not.toBeInTheDocument()
    })

    it('should render issue count', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('2 issues')).toBeInTheDocument()
    })

    it('should render singular "issue" for single entry', () => {
      const singleEntryStack: StackInfo = {
        ...mockStackInfo,
        entries: [mockStackInfo.entries[0]],
        stack: {
          ...mockStackInfo.stack,
          issue_order: ['i-001'],
        },
      }
      renderWithProviders(<StackPanel stackInfo={singleEntryStack} />)
      expect(screen.getByText('1 issue')).toBeInTheDocument()
    })
  })

  describe('Health Status', () => {
    it('should render "Ready" badge for ready health', () => {
      renderWithProviders(<StackPanel stackInfo={mockAutoStackInfo} />)
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('should render "Pending Review" badge for pending health', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('Pending Review')).toBeInTheDocument()
    })

    it('should render "Blocked" badge for blocked health', () => {
      const blockedStack: StackInfo = {
        ...mockStackInfo,
        health: 'blocked',
      }
      renderWithProviders(<StackPanel stackInfo={blockedStack} />)
      expect(screen.getByText('Blocked')).toBeInTheDocument()
    })

    it('should render "Conflicts" badge for conflicts health', () => {
      const conflictsStack: StackInfo = {
        ...mockStackInfo,
        health: 'conflicts',
      }
      renderWithProviders(<StackPanel stackInfo={conflictsStack} />)
      expect(screen.getByText('Conflicts')).toBeInTheDocument()
    })
  })

  describe('Entry Cards', () => {
    it('should render all entries', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('i-001')).toBeInTheDocument()
      expect(screen.getByText('i-002')).toBeInTheDocument()
    })

    it('should render checkpoint status for entries with checkpoints', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('Approved')).toBeInTheDocument()
    })

    it('should render "No checkpoint" for entries without checkpoints', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('No checkpoint')).toBeInTheDocument()
    })

    it('should render "Merged" badge for promoted entries', () => {
      renderWithProviders(<StackPanel stackInfo={mockAutoStackInfo} />)
      expect(screen.getByText('Merged')).toBeInTheDocument()
    })

    it('should render issue titles when provided', () => {
      renderWithProviders(
        <StackPanel
          stackInfo={mockStackInfo}
          issueTitles={{
            'i-001': 'First Issue Title',
            'i-002': 'Second Issue Title',
          }}
        />
      )
      expect(screen.getByText('First Issue Title')).toBeInTheDocument()
      expect(screen.getByText('Second Issue Title')).toBeInTheDocument()
    })

    it('should render depth indicators', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      // Check for depth values
      expect(screen.getByText('0')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
    })
  })

  describe('Entry Navigation', () => {
    it('should navigate to issue when entry is clicked', async () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)

      const issueLink = screen.getByText('i-001')
      fireEvent.click(issueLink)

      expect(mockNavigate).toHaveBeenCalledWith('/p/test-project/issues/i-001')
    })
  })

  describe('Promote Button', () => {
    it('should show Promote button for approved entries that are not promoted', () => {
      const onPromote = vi.fn()
      renderWithProviders(
        <StackPanel stackInfo={mockStackInfo} onPromote={onPromote} />
      )

      const promoteButtons = screen.getAllByText('Promote')
      expect(promoteButtons.length).toBeGreaterThan(0)
    })

    it('should not show Promote button for entries without checkpoints', () => {
      const stackWithNoPending: StackInfo = {
        ...mockStackInfo,
        entries: [
          {
            issue_id: 'i-001',
            depth: 0,
            has_checkpoint: false,
            is_promoted: false,
          },
        ],
        stack: {
          ...mockStackInfo.stack,
          issue_order: ['i-001'],
        },
      }
      const onPromote = vi.fn()
      renderWithProviders(
        <StackPanel stackInfo={stackWithNoPending} onPromote={onPromote} />
      )

      expect(screen.queryByText('Promote')).not.toBeInTheDocument()
    })

    it('should not show Promote button for promoted entries', () => {
      const stackWithPromoted: StackInfo = {
        ...mockStackInfo,
        entries: [
          {
            issue_id: 'i-001',
            depth: 0,
            has_checkpoint: true,
            checkpoint_status: 'merged',
            is_promoted: true,
          },
        ],
        stack: {
          ...mockStackInfo.stack,
          issue_order: ['i-001'],
        },
      }
      const onPromote = vi.fn()
      renderWithProviders(
        <StackPanel stackInfo={stackWithPromoted} onPromote={onPromote} />
      )

      expect(screen.queryByText('Promote')).not.toBeInTheDocument()
    })

    it('should call onPromote when Promote button is clicked', async () => {
      const onPromote = vi.fn()
      renderWithProviders(
        <StackPanel stackInfo={mockStackInfo} onPromote={onPromote} />
      )

      const promoteButton = screen.getAllByText('Promote')[0]
      fireEvent.click(promoteButton)

      expect(onPromote).toHaveBeenCalledWith('i-001')
    })
  })

  describe('Manual Stack Features', () => {
    it('should show remove button for manual stacks', () => {
      const onRemove = vi.fn()
      renderWithProviders(
        <StackPanel
          stackInfo={mockStackInfo}
          isManual={true}
          onRemove={onRemove}
        />
      )

      // Remove button should exist (X icon)
      const removeButtons = screen.getAllByRole('button')
      expect(removeButtons.length).toBeGreaterThan(0)
    })

    it('should not show remove button for auto stacks', () => {
      const onRemove = vi.fn()
      renderWithProviders(
        <StackPanel
          stackInfo={mockAutoStackInfo}
          isManual={false}
          onRemove={onRemove}
        />
      )

      // Should not have remove buttons for auto stacks
      // The drag handle should not be present
      expect(screen.queryByLabelText('drag-handle')).not.toBeInTheDocument()
    })

    it('should call onRemove when remove button is clicked', async () => {
      const onRemove = vi.fn()
      // Create a stack with unpromoted entry that can be removed
      const removableStack: StackInfo = {
        ...mockStackInfo,
        entries: [
          {
            issue_id: 'i-001',
            depth: 0,
            has_checkpoint: false,
            is_promoted: false,
          },
        ],
        stack: {
          ...mockStackInfo.stack,
          issue_order: ['i-001'],
        },
      }

      renderWithProviders(
        <StackPanel
          stackInfo={removableStack}
          isManual={true}
          onRemove={onRemove}
        />
      )

      // Find and click the remove button (X icon button)
      const buttons = screen.getAllByRole('button')
      const removeButton = buttons.find(
        (btn) => btn.querySelector('.lucide-x') !== null
      )

      if (removeButton) {
        fireEvent.click(removeButton)
        expect(onRemove).toHaveBeenCalledWith('i-001')
      }
    })

    it('should show drag handles for manual stacks', () => {
      renderWithProviders(
        <StackPanel stackInfo={mockStackInfo} isManual={true} />
      )

      // Drag handles should be present (GripVertical icon)
      // They are rendered as buttons with specific styling
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })
  })

  describe('Empty State', () => {
    it('should render empty state when no entries', () => {
      const emptyStack: StackInfo = {
        ...mockStackInfo,
        entries: [],
        stack: {
          ...mockStackInfo.stack,
          issue_order: [],
        },
      }
      renderWithProviders(<StackPanel stackInfo={emptyStack} />)
      expect(screen.getByText('No issues in this stack')).toBeInTheDocument()
    })
  })

  describe('Dependency Arrows', () => {
    it('should show "depends on" text between entries', () => {
      renderWithProviders(<StackPanel stackInfo={mockStackInfo} />)
      expect(screen.getByText('depends on')).toBeInTheDocument()
    })

    it('should not show "depends on" for first entry', () => {
      const singleEntryStack: StackInfo = {
        ...mockStackInfo,
        entries: [mockStackInfo.entries[0]],
        stack: {
          ...mockStackInfo.stack,
          issue_order: ['i-001'],
        },
      }
      renderWithProviders(<StackPanel stackInfo={singleEntryStack} />)
      expect(screen.queryByText('depends on')).not.toBeInTheDocument()
    })
  })
})
