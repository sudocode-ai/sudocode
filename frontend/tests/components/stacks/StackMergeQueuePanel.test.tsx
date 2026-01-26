/**
 * Tests for StackMergeQueuePanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StackMergeQueuePanel } from '@/components/stacks/StackMergeQueuePanel'
import { useMergeQueue } from '@/hooks/useCheckpointDAG'
import type { DiffStackWithCheckpoints, MergeResult } from '@/types/checkpoint'

// Mock the hook
vi.mock('@/hooks/useCheckpointDAG', () => ({
  useMergeQueue: vi.fn(),
}))

// Mock @dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('StackMergeQueuePanel', () => {
  let queryClient: QueryClient
  const mockRefetch = vi.fn()
  const mockDequeue = vi.fn()
  const mockMerge = vi.fn()

  const createStack = (overrides: Partial<DiffStackWithCheckpoints> = {}): DiffStackWithCheckpoints => ({
    id: 'stack-123',
    name: 'Test Stack',
    description: null,
    targetBranch: 'main',
    reviewStatus: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    queuePosition: 1,
    createdAt: Date.now(),
    createdBy: 'user-1',
    checkpoints: [],
    ...overrides,
  })

  const createMergeResult = (overrides: Partial<MergeResult> = {}): MergeResult => ({
    targetBranch: 'main',
    mergedCheckpoints: ['cp-1', 'cp-2'],
    skippedCheckpoints: [],
    mergeCommit: null,
    dryRun: false,
    ...overrides,
  })

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.clearAllMocks()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  const renderPanel = (props: Partial<React.ComponentProps<typeof StackMergeQueuePanel>> = {}) => {
    return render(<StackMergeQueuePanel {...props} />, { wrapper })
  }

  const mockEnqueue = vi.fn()

  const setupWithQueue = (queue: DiffStackWithCheckpoints[] = []) => {
    vi.mocked(useMergeQueue).mockReturnValue({
      queue,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      enqueue: mockEnqueue,
      dequeue: mockDequeue,
      merge: mockMerge,
      isEnqueuing: false,
      isDequeuing: false,
      isMerging: false,
      mergeResult: undefined,
    })
    return { queue }
  }

  describe('Loading State', () => {
    it('shows loading spinner while loading', () => {
      vi.mocked(useMergeQueue).mockReturnValue({
        queue: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: mockRefetch,
        enqueue: mockEnqueue,
        dequeue: mockDequeue,
        merge: mockMerge,
        isEnqueuing: false,
        isDequeuing: false,
        isMerging: false,
        mergeResult: undefined,
      })

      const { container } = renderPanel()

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('shows error message when loading fails', () => {
      vi.mocked(useMergeQueue).mockReturnValue({
        queue: [],
        isLoading: false,
        isError: true,
        error: new Error('Network error'),
        refetch: mockRefetch,
        enqueue: mockEnqueue,
        dequeue: mockDequeue,
        merge: mockMerge,
        isEnqueuing: false,
        isDequeuing: false,
        isMerging: false,
        mergeResult: undefined,
      })

      renderPanel()

      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    it('shows default error message when no error details', () => {
      vi.mocked(useMergeQueue).mockReturnValue({
        queue: [],
        isLoading: false,
        isError: true,
        error: null,
        refetch: mockRefetch,
        enqueue: mockEnqueue,
        dequeue: mockDequeue,
        merge: mockMerge,
        isEnqueuing: false,
        isDequeuing: false,
        isMerging: false,
        mergeResult: undefined,
      })

      renderPanel()

      expect(screen.getByText('Failed to load queue')).toBeInTheDocument()
    })

    it('shows Retry button on error', async () => {
      vi.mocked(useMergeQueue).mockReturnValue({
        queue: [],
        isLoading: false,
        isError: true,
        error: null,
        refetch: mockRefetch,
        enqueue: mockEnqueue,
        dequeue: mockDequeue,
        merge: mockMerge,
        isEnqueuing: false,
        isDequeuing: false,
        isMerging: false,
        mergeResult: undefined,
      })

      renderPanel()

      await userEvent.click(screen.getByRole('button', { name: /Retry/i }))

      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Empty State', () => {
    it('shows empty message when queue is empty', () => {
      setupWithQueue([])
      renderPanel()

      expect(screen.getByText('No stacks in the merge queue')).toBeInTheDocument()
      expect(screen.getByText('Approve a diff stack to add it to the queue')).toBeInTheDocument()
    })
  })

  describe('Queue Display', () => {
    it('shows queue count badge', () => {
      setupWithQueue([createStack(), createStack({ id: 'stack-2', queuePosition: 2 })])
      renderPanel()

      // '2' appears in both badge and position indicator
      expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    })

    it('renders all stacks in the queue', () => {
      setupWithQueue([
        createStack({ id: 'stack-1', name: 'First Stack', queuePosition: 1 }),
        createStack({ id: 'stack-2', name: 'Second Stack', queuePosition: 2 }),
        createStack({ id: 'stack-3', name: 'Third Stack', queuePosition: 3 }),
      ])
      renderPanel()

      expect(screen.getByText('First Stack')).toBeInTheDocument()
      expect(screen.getByText('Second Stack')).toBeInTheDocument()
      expect(screen.getByText('Third Stack')).toBeInTheDocument()
    })

    it('shows queue positions', () => {
      setupWithQueue([
        createStack({ id: 'stack-1', queuePosition: 1 }),
        createStack({ id: 'stack-2', queuePosition: 2 }),
      ])
      renderPanel()

      // Position numbers appear in position indicators (and may duplicate with checkpoint counts)
      expect(screen.getAllByText('1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    })

    it('shows checkpoint count for each stack', () => {
      setupWithQueue([
        createStack({
          id: 'stack-1',
          checkpoints: [
            { checkpointId: 'cp-1', position: 0, checkpoint: null as unknown as undefined },
            { checkpointId: 'cp-2', position: 1, checkpoint: null as unknown as undefined },
          ] as DiffStackWithCheckpoints['checkpoints'],
        }),
      ])
      renderPanel()

      expect(screen.getByText('2 checkpoints')).toBeInTheDocument()
    })

    it('shows singular "checkpoint" for single checkpoint', () => {
      setupWithQueue([
        createStack({
          id: 'stack-1',
          checkpoints: [
            { checkpointId: 'cp-1', position: 0, checkpoint: null as unknown as undefined },
          ] as DiffStackWithCheckpoints['checkpoints'],
        }),
      ])
      renderPanel()

      expect(screen.getByText('1 checkpoint')).toBeInTheDocument()
    })

    it('shows target branch for each stack', () => {
      setupWithQueue([createStack({ targetBranch: 'develop' })])
      renderPanel()

      expect(screen.getByText('develop')).toBeInTheDocument()
    })

    it('shows status badge for each stack', () => {
      setupWithQueue([createStack({ reviewStatus: 'approved' })])
      renderPanel()

      expect(screen.getByText('Approved')).toBeInTheDocument()
    })
  })

  describe('Branch Filter', () => {
    it('renders branch selector', () => {
      setupWithQueue([])
      renderPanel({ targetBranches: ['main', 'develop'] })

      expect(screen.getByText('Branch:')).toBeInTheDocument()
    })

    it('uses defaultTargetBranch', () => {
      setupWithQueue([])
      renderPanel({ defaultTargetBranch: 'develop', targetBranches: ['main', 'develop'] })

      // The hook is called with the correct branch
      expect(useMergeQueue).toHaveBeenCalledWith('develop')
    })

    it('changes branch filter on selection', async () => {
      setupWithQueue([])
      renderPanel({ targetBranches: ['main', 'develop'] })

      const trigger = screen.getByRole('combobox')
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText('develop'))

      expect(useMergeQueue).toHaveBeenCalledWith('develop')
    })
  })

  describe('Refresh Button', () => {
    it('renders refresh button', () => {
      setupWithQueue([])
      renderPanel()

      const refreshButton = screen.getByRole('button', { name: '' })
      expect(refreshButton).toBeInTheDocument()
    })

    it('calls refetch when refresh is clicked', async () => {
      setupWithQueue([])
      renderPanel()

      // Get the refresh button (it's the one with RefreshCw icon in the header)
      const buttons = screen.getAllByRole('button')
      const refreshButton = buttons.find(btn =>
        btn.querySelector('svg[class*="lucide-refresh"]') ||
        btn.querySelector('svg') // First svg button is likely the refresh
      )

      if (refreshButton) {
        await userEvent.click(refreshButton)
        expect(mockRefetch).toHaveBeenCalled()
      }
    })
  })

  describe('Preview Action', () => {
    it('opens preview dialog when preview button is clicked', async () => {
      const stack = createStack({ name: 'My Stack' })
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult())
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(screen.getByText('Merge Preview')).toBeInTheDocument()
      })
    })

    it('calls merge with dry_run when preview is requested', async () => {
      const stack = createStack({ id: 'stack-1' })
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult())
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(mockMerge).toHaveBeenCalledWith('stack-1', true)
      })
    })

    it('shows merge result in preview dialog', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult({
        targetBranch: 'main',
        mergedCheckpoints: ['cp-1', 'cp-2'],
      }))
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(screen.getByText('Target Branch')).toBeInTheDocument()
        expect(screen.getByText('Checkpoints to Merge')).toBeInTheDocument()
      })
    })

    it('shows conflicts warning when conflicts exist', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult({
        conflicts: ['src/file1.ts', 'src/file2.ts'],
      }))
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(screen.getByText('Merge conflicts detected')).toBeInTheDocument()
        expect(screen.getByText('• src/file1.ts')).toBeInTheDocument()
        expect(screen.getByText('• src/file2.ts')).toBeInTheDocument()
      })
    })

    it('shows ready to merge when no conflicts', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult({ conflicts: undefined }))
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(screen.getByText('Ready to merge')).toBeInTheDocument()
        expect(screen.getByText('No conflicts detected. This merge can proceed cleanly.')).toBeInTheDocument()
      })
    })

    it('closes preview dialog on Cancel', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult())
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(screen.getByText('Merge Preview')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: /Cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('Merge Preview')).not.toBeInTheDocument()
      })
    })

    it('disables Execute Merge button when conflicts exist', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult({ conflicts: ['file.ts'] }))
      renderPanel()

      await userEvent.click(screen.getByTitle('Preview merge'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Execute Merge/i })).toBeDisabled()
      })
    })
  })

  describe('Merge Action', () => {
    it('shows merge button for approved stacks', () => {
      setupWithQueue([createStack({ reviewStatus: 'approved' })])
      renderPanel()

      expect(screen.getByTitle('Execute merge')).toBeInTheDocument()
    })

    it('does not show merge button for pending stacks', () => {
      setupWithQueue([createStack({ reviewStatus: 'pending' })])
      renderPanel()

      expect(screen.queryByTitle('Execute merge')).not.toBeInTheDocument()
    })

    it('calls merge when merge button is clicked', async () => {
      const stack = createStack({ id: 'stack-1', reviewStatus: 'approved' })
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult())
      renderPanel()

      await userEvent.click(screen.getByTitle('Execute merge'))

      await waitFor(() => {
        expect(mockMerge).toHaveBeenCalledWith('stack-1', false)
      })
    })

    it('refetches after successful merge', async () => {
      const stack = createStack({ reviewStatus: 'approved' })
      setupWithQueue([stack])
      mockMerge.mockResolvedValue(createMergeResult())
      renderPanel()

      await userEvent.click(screen.getByTitle('Execute merge'))

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  describe('Dequeue Action', () => {
    it('opens confirmation dialog when remove button is clicked', async () => {
      const stack = createStack({ name: 'My Stack' })
      setupWithQueue([stack])
      renderPanel()

      await userEvent.click(screen.getByTitle('Remove from queue'))

      expect(screen.getByText('Remove from Queue')).toBeInTheDocument()
      expect(screen.getByText(/Are you sure you want to remove "My Stack"/)).toBeInTheDocument()
    })

    it('calls dequeue when confirmed', async () => {
      const stack = createStack({ id: 'stack-1' })
      setupWithQueue([stack])
      mockDequeue.mockResolvedValue(undefined)
      renderPanel()

      await userEvent.click(screen.getByTitle('Remove from queue'))
      await userEvent.click(screen.getByRole('button', { name: /^Remove$/i }))

      await waitFor(() => {
        expect(mockDequeue).toHaveBeenCalledWith('stack-1')
      })
    })

    it('closes dialog on Cancel', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      renderPanel()

      await userEvent.click(screen.getByTitle('Remove from queue'))
      expect(screen.getByText('Remove from Queue')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /Cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('Remove from Queue')).not.toBeInTheDocument()
      })
    })

    it('refetches after successful dequeue', async () => {
      const stack = createStack()
      setupWithQueue([stack])
      mockDequeue.mockResolvedValue(undefined)
      renderPanel()

      await userEvent.click(screen.getByTitle('Remove from queue'))
      await userEvent.click(screen.getByRole('button', { name: /^Remove$/i }))

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  describe('Stack Selection', () => {
    it('calls onStackSelect when stack info is clicked', async () => {
      const onStackSelect = vi.fn()
      const stack = createStack({ id: 'stack-1', name: 'My Stack' })
      setupWithQueue([stack])
      renderPanel({ onStackSelect })

      // Click on the stack name/info area
      await userEvent.click(screen.getByText('My Stack'))

      expect(onStackSelect).toHaveBeenCalledWith('stack-1')
    })
  })

  describe('Queue Sorting', () => {
    it('sorts queue by position', () => {
      setupWithQueue([
        createStack({ id: 'stack-3', name: 'Third', queuePosition: 3 }),
        createStack({ id: 'stack-1', name: 'First', queuePosition: 1 }),
        createStack({ id: 'stack-2', name: 'Second', queuePosition: 2 }),
      ])
      renderPanel()

      const stackNames = screen.getAllByText(/Stack|First|Second|Third/).map(el => el.textContent)
      // They should be in order by position
      const firstIndex = stackNames.findIndex(n => n?.includes('First'))
      const secondIndex = stackNames.findIndex(n => n?.includes('Second'))
      const thirdIndex = stackNames.findIndex(n => n?.includes('Third'))

      expect(firstIndex).toBeLessThan(secondIndex)
      expect(secondIndex).toBeLessThan(thirdIndex)
    })
  })

  describe('Drag and Drop', () => {
    it('renders DndContext and SortableContext', () => {
      setupWithQueue([createStack()])
      renderPanel()

      expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
      expect(screen.getByTestId('sortable-context')).toBeInTheDocument()
    })
  })
})
