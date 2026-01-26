/**
 * Tests for StackCreationPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StackCreationPanel } from '@/components/stacks/StackCreationPanel'
import { useDiffStacks } from '@/hooks/useCheckpointDAG'
import type { DataplaneCheckpoint, DiffStack } from '@/types/checkpoint'

// Mock the hooks
vi.mock('@/hooks/useCheckpointDAG', () => ({
  useDiffStacks: vi.fn(),
}))

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('StackCreationPanel', () => {
  let queryClient: QueryClient
  const mockCreateStack = vi.fn()

  const mockCheckpoints: Record<string, DataplaneCheckpoint> = {
    'cp-1': {
      id: 'cp-1',
      streamId: 'stream-1',
      commitSha: 'abc1234567890',
      parentCommit: null,
      originalCommit: null,
      changeId: 'change-1',
      message: 'First commit message',
      createdAt: Date.now(),
      createdBy: 'user-1',
    },
    'cp-2': {
      id: 'cp-2',
      streamId: 'stream-1',
      commitSha: 'def4567890123',
      parentCommit: 'abc1234567890',
      originalCommit: null,
      changeId: 'change-2',
      message: 'Second commit message',
      createdAt: Date.now(),
      createdBy: 'user-1',
    },
    'cp-3': {
      id: 'cp-3',
      streamId: 'stream-1',
      commitSha: 'ghi7890123456',
      parentCommit: 'def4567890123',
      originalCommit: null,
      changeId: 'change-3',
      message: 'Third commit message',
      createdAt: Date.now(),
      createdBy: 'user-1',
    },
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.clearAllMocks()

    vi.mocked(useDiffStacks).mockReturnValue({
      stacks: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createStack: mockCreateStack,
      updateStack: vi.fn(),
      deleteStack: vi.fn(),
      addCheckpoints: vi.fn(),
      removeCheckpoint: vi.fn(),
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
    })
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  const renderPanel = (props: Partial<React.ComponentProps<typeof StackCreationPanel>> = {}) => {
    const defaultProps = {
      selectedCheckpointIds: ['cp-1', 'cp-2'],
      checkpoints: mockCheckpoints,
      targetBranches: ['main', 'develop'],
    }

    return render(<StackCreationPanel {...defaultProps} {...props} />, { wrapper })
  }

  describe('Empty State', () => {
    it('shows empty state when no checkpoints selected', () => {
      renderPanel({ selectedCheckpointIds: [] })

      expect(screen.getByText(/Select checkpoints/)).toBeInTheDocument()
    })

    it('shows empty state when selected checkpoints are invalid', () => {
      renderPanel({ selectedCheckpointIds: ['invalid-1', 'invalid-2'] })

      expect(screen.getByText(/Select checkpoints/)).toBeInTheDocument()
    })
  })

  describe('Form Fields', () => {
    it('renders name input', () => {
      renderPanel()

      expect(screen.getByLabelText('Name')).toBeInTheDocument()
    })

    it('auto-populates name from first checkpoint message', () => {
      renderPanel()

      const nameInput = screen.getByLabelText('Name') as HTMLInputElement
      expect(nameInput.value).toBe('First commit message')
    })

    it('renders description textarea', () => {
      renderPanel()

      expect(screen.getByLabelText('Description')).toBeInTheDocument()
    })

    it('renders target branch selector', () => {
      renderPanel()

      expect(screen.getByLabelText('Target Branch')).toBeInTheDocument()
    })

    it('shows available target branches in selector', async () => {
      renderPanel()

      const trigger = screen.getByRole('combobox')
      await userEvent.click(trigger)

      // Use getAllByText since 'main' appears in multiple places (selected value + option)
      expect(screen.getAllByText('main').length).toBeGreaterThan(0)
      expect(screen.getByText('develop')).toBeInTheDocument()
    })
  })

  describe('Checkpoint List', () => {
    it('shows checkpoint count in header', () => {
      renderPanel()

      expect(screen.getByText(/2 checkpoints/)).toBeInTheDocument()
    })

    it('shows single checkpoint text correctly', () => {
      renderPanel({ selectedCheckpointIds: ['cp-1'] })

      expect(screen.getByText(/1 checkpoint(?!s)/)).toBeInTheDocument()
    })

    it('renders all selected checkpoints', () => {
      renderPanel()

      expect(screen.getByText('abc1234')).toBeInTheDocument()
      expect(screen.getByText('def4567')).toBeInTheDocument()
    })

    it('shows checkpoint messages', () => {
      renderPanel()

      expect(screen.getByText('First commit message')).toBeInTheDocument()
      expect(screen.getByText('Second commit message')).toBeInTheDocument()
    })

    it('allows removing checkpoints', async () => {
      renderPanel({ selectedCheckpointIds: ['cp-1', 'cp-2', 'cp-3'] })

      // Find and click the first remove button
      const removeButtons = screen.getAllByTitle('Remove from stack')
      expect(removeButtons.length).toBe(3)

      await userEvent.click(removeButtons[0])

      // Should now only have 2 checkpoints
      await waitFor(() => {
        expect(screen.queryByText('abc1234')).not.toBeInTheDocument()
      })
    })
  })

  describe('Actions', () => {
    it('renders Cancel button', () => {
      renderPanel()

      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('renders Create Stack button', () => {
      renderPanel()

      expect(screen.getByRole('button', { name: /Create Stack/i })).toBeInTheDocument()
    })

    it('calls onCancel when Cancel is clicked', async () => {
      const onCancel = vi.fn()
      renderPanel({ onCancel })

      await userEvent.click(screen.getByRole('button', { name: /Cancel/i }))

      expect(onCancel).toHaveBeenCalled()
    })

    it('creates stack when Create Stack is clicked', async () => {
      const mockStack: DiffStack = {
        id: 'stack-1',
        name: 'Test Stack',
        description: null,
        targetBranch: 'main',
        reviewStatus: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        queuePosition: null,
        createdAt: Date.now(),
        createdBy: 'user-1',
      }
      mockCreateStack.mockResolvedValue(mockStack)

      const onStackCreated = vi.fn()
      renderPanel({ onStackCreated })

      await userEvent.click(screen.getByRole('button', { name: /Create Stack/i }))

      await waitFor(() => {
        expect(mockCreateStack).toHaveBeenCalledWith({
          name: 'First commit message',
          description: undefined,
          targetBranch: 'main',
          checkpointIds: ['cp-1', 'cp-2'],
        })
      })
    })

    it('calls onStackCreated after successful creation', async () => {
      const mockStack: DiffStack = {
        id: 'stack-1',
        name: 'Test Stack',
        description: null,
        targetBranch: 'main',
        reviewStatus: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        queuePosition: null,
        createdAt: Date.now(),
        createdBy: 'user-1',
      }
      mockCreateStack.mockResolvedValue(mockStack)

      const onStackCreated = vi.fn()
      renderPanel({ onStackCreated })

      await userEvent.click(screen.getByRole('button', { name: /Create Stack/i }))

      await waitFor(() => {
        expect(onStackCreated).toHaveBeenCalledWith(mockStack)
      })
    })

    it('disables buttons when creating', () => {
      vi.mocked(useDiffStacks).mockReturnValue({
        stacks: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        createStack: mockCreateStack,
        updateStack: vi.fn(),
        deleteStack: vi.fn(),
        addCheckpoints: vi.fn(),
        removeCheckpoint: vi.fn(),
        isCreating: true,
        isUpdating: false,
        isDeleting: false,
      })

      renderPanel()

      expect(screen.getByRole('button', { name: /Creating/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled()
    })

    it('disables Create button when no valid checkpoints', () => {
      renderPanel({ selectedCheckpointIds: [] })

      // Button should not be present in empty state
      expect(screen.queryByRole('button', { name: /Create Stack/i })).not.toBeInTheDocument()
    })
  })

  describe('Form Input', () => {
    it('allows editing name', async () => {
      renderPanel()

      const nameInput = screen.getByLabelText('Name') as HTMLInputElement
      // Verify initial value
      expect(nameInput.value).toBe('First commit message')

      // Change the input value using fireEvent for direct value change
      fireEvent.change(nameInput, { target: { value: 'Custom Stack Name' } })

      expect(nameInput.value).toBe('Custom Stack Name')
    })

    it('allows editing description', async () => {
      renderPanel()

      const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement
      await userEvent.type(descInput, 'A test description')

      expect(descInput.value).toBe('A test description')
    })

    it('allows changing target branch', async () => {
      renderPanel()

      const trigger = screen.getByRole('combobox')
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText('develop'))

      // Trigger should now show develop
      expect(trigger).toHaveTextContent('develop')
    })

    it('sends description when provided', async () => {
      const mockStack: DiffStack = {
        id: 'stack-1',
        name: 'Test Stack',
        description: 'A test description',
        targetBranch: 'main',
        reviewStatus: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        queuePosition: null,
        createdAt: Date.now(),
        createdBy: 'user-1',
      }
      mockCreateStack.mockResolvedValue(mockStack)

      renderPanel()

      const descInput = screen.getByLabelText('Description')
      await userEvent.type(descInput, 'A test description')
      await userEvent.click(screen.getByRole('button', { name: /Create Stack/i }))

      await waitFor(() => {
        expect(mockCreateStack).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'A test description',
          })
        )
      })
    })
  })

  describe('Sync with Selection', () => {
    it('updates when selectedCheckpointIds changes', () => {
      const { rerender } = render(
        <StackCreationPanel
          selectedCheckpointIds={['cp-1']}
          checkpoints={mockCheckpoints}
          targetBranches={['main']}
        />,
        { wrapper }
      )

      expect(screen.getByText(/1 checkpoint(?!s)/)).toBeInTheDocument()

      rerender(
        <StackCreationPanel
          selectedCheckpointIds={['cp-1', 'cp-2', 'cp-3']}
          checkpoints={mockCheckpoints}
          targetBranches={['main']}
        />
      )

      expect(screen.getByText(/3 checkpoints/)).toBeInTheDocument()
    })

    it('preserves order when adding new checkpoints', () => {
      const { rerender, container } = render(
        <StackCreationPanel
          selectedCheckpointIds={['cp-2', 'cp-1']}
          checkpoints={mockCheckpoints}
          targetBranches={['main']}
        />,
        { wrapper }
      )

      // Get the order of SHAs displayed
      const items = container.querySelectorAll('code')
      expect(items[0]).toHaveTextContent('def4567')
      expect(items[1]).toHaveTextContent('abc1234')

      // Add cp-3, it should be added at the end
      rerender(
        <StackCreationPanel
          selectedCheckpointIds={['cp-2', 'cp-1', 'cp-3']}
          checkpoints={mockCheckpoints}
          targetBranches={['main']}
        />
      )

      const newItems = container.querySelectorAll('code')
      expect(newItems[0]).toHaveTextContent('def4567')
      expect(newItems[1]).toHaveTextContent('abc1234')
      expect(newItems[2]).toHaveTextContent('ghi7890')
    })
  })
})
