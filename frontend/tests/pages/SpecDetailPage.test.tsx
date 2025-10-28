import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SpecDetailPage from '@/pages/SpecDetailPage'
import * as useSpecsHook from '@/hooks/useSpecs'
import * as useIssuesHook from '@/hooks/useIssues'

// Mock the hooks
vi.mock('@/hooks/useSpecs')
vi.mock('@/hooks/useIssues')

const mockSpec = {
  id: 'SPEC-001',
  title: 'Test Spec',
  content: '# Test Content\n\nThis is a test spec.',
  priority: 1,
  file_path: 'test.md',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mockUpdateSpec = vi.fn()

const renderSpecDetailPage = (specId = 'SPEC-001') => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/specs/${specId}`]}>
        <Routes>
          <Route path="/specs/:id" element={<SpecDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('SpecDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(useSpecsHook.useSpec).mockReturnValue({
      spec: mockSpec,
      isLoading: false,
      isError: false,
    } as any)

    vi.mocked(useSpecsHook.useSpecFeedback).mockReturnValue({
      feedback: [],
    } as any)

    vi.mocked(useSpecsHook.useSpecs).mockReturnValue({
      updateSpec: mockUpdateSpec,
      isUpdating: false,
    } as any)

    vi.mocked(useIssuesHook.useIssues).mockReturnValue({
      issues: [],
    } as any)
  })

  it('should render spec with editable title and priority', async () => {
    renderSpecDetailPage()

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Spec')).toBeInTheDocument()
      expect(screen.getByText(/High \(P1\)/)).toBeInTheDocument()
    })
  })

  it('should show save status indicator', async () => {
    renderSpecDetailPage()

    await waitFor(() => {
      expect(screen.getByText('All changes saved')).toBeInTheDocument()
    })
  })

  it('should update title and trigger auto-save', async () => {
    const user = userEvent.setup()
    renderSpecDetailPage()

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Spec')).toBeInTheDocument()
    })

    // Modify the title
    const titleInput = screen.getByDisplayValue('Test Spec')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Spec Title')

    // Should show unsaved changes
    expect(screen.getByText('Unsaved changes...')).toBeInTheDocument()

    // Wait for auto-save (1 second debounce)
    await waitFor(
      () => {
        expect(mockUpdateSpec).toHaveBeenCalledWith({
          id: 'SPEC-001',
          data: expect.objectContaining({
            title: 'Updated Spec Title',
          }),
        })
      },
      { timeout: 2000 }
    )
  })

  it('should update priority and trigger auto-save', async () => {
    const user = userEvent.setup()
    renderSpecDetailPage()

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText(/High \(P1\)/)).toBeInTheDocument()
    })

    // Click priority dropdown - get all comboboxes and find the priority one
    const comboboxes = screen.getAllByRole('combobox')
    const priorityTrigger = comboboxes.find((box) =>
      box.textContent?.includes('High (P1)')
    )
    expect(priorityTrigger).toBeDefined()
    await user.click(priorityTrigger!)

    // Select new priority
    await waitFor(() => {
      const criticalOption = screen.getByText(/Critical \(P0\)/)
      return user.click(criticalOption)
    })

    // Wait for auto-save
    await waitFor(
      () => {
        expect(mockUpdateSpec).toHaveBeenCalledWith({
          id: 'SPEC-001',
          data: expect.objectContaining({
            priority: 0,
          }),
        })
      },
      { timeout: 2000 }
    )
  })

  it('should show loading state', () => {
    vi.mocked(useSpecsHook.useSpec).mockReturnValue({
      spec: null,
      isLoading: true,
      isError: false,
    } as any)

    renderSpecDetailPage()

    expect(screen.getByText('Loading spec...')).toBeInTheDocument()
  })

  it('should show error state when spec not found', () => {
    vi.mocked(useSpecsHook.useSpec).mockReturnValue({
      spec: null,
      isLoading: false,
      isError: true,
    } as any)

    renderSpecDetailPage()

    expect(screen.getByText('Spec not found')).toBeInTheDocument()
    expect(screen.getByText(/doesn't exist or has been deleted/)).toBeInTheDocument()
  })

  it('should show feedback panel toggle button', async () => {
    renderSpecDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Feedback/ })).toBeInTheDocument()
    })
  })

  it('should display spec metadata', async () => {
    renderSpecDetailPage()

    await waitFor(() => {
      expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      expect(screen.getByText('test.md')).toBeInTheDocument()
    })
  })

  it('should render back button', async () => {
    renderSpecDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
    })
  })

  it('should show updating status when saving', async () => {
    vi.mocked(useSpecsHook.useSpecs).mockReturnValue({
      updateSpec: mockUpdateSpec,
      isUpdating: true,
    } as any)

    renderSpecDetailPage()

    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })
  })

  it('should not trigger auto-save when navigating to a different spec', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    // Setup mocks for two different specs
    const spec1 = {
      ...mockSpec,
      id: 'SPEC-001',
      title: 'Spec One',
      content: 'Content for spec one',
    }

    const spec2 = {
      ...mockSpec,
      id: 'SPEC-002',
      title: 'Spec Two',
      content: 'Content for spec two',
    }

    // Initially show spec1
    vi.mocked(useSpecsHook.useSpec).mockReturnValue({
      spec: spec1,
      isLoading: false,
      isError: false,
    } as any)

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/specs/SPEC-001']}>
          <Routes>
            <Route path="/specs/:id" element={<SpecDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    // Wait for spec1 to render
    await waitFor(() => {
      expect(screen.getByDisplayValue('Spec One')).toBeInTheDocument()
    })

    // Make changes to spec1
    const titleInput = screen.getByDisplayValue('Spec One')
    await user.clear(titleInput)
    await user.type(titleInput, 'Modified Spec One')

    // Should show unsaved changes
    expect(screen.getByText('Unsaved changes...')).toBeInTheDocument()

    // Clear the mock before navigation
    mockUpdateSpec.mockClear()

    // Navigate to spec2 (before auto-save triggers)
    vi.mocked(useSpecsHook.useSpec).mockReturnValue({
      spec: spec2,
      isLoading: false,
      isError: false,
    } as any)

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/specs/SPEC-002']}>
          <Routes>
            <Route path="/specs/:id" element={<SpecDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    // Wait for spec2 to render
    await waitFor(() => {
      expect(screen.getByDisplayValue('Spec Two')).toBeInTheDocument()
    })

    // Wait for any delayed auto-save attempts
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // updateSpec should NOT have been called with spec2's ID and spec1's content
    // If the bug exists, we'd see a call with id: 'SPEC-002' and content from spec1
    const badCalls = mockUpdateSpec.mock.calls.filter((call) => {
      const { id, data } = call[0]
      return id === 'SPEC-002' && data.content?.includes('Modified Spec One')
    })

    expect(badCalls.length).toBe(0)
  })

  it('should not call updateSpec with empty content when opening a spec', async () => {
    vi.mocked(useSpecsHook.useSpec).mockReturnValue({
      spec: mockSpec,
      isLoading: false,
      isError: false,
    } as any)

    renderSpecDetailPage()

    // Wait for spec to render
    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Spec')).toBeInTheDocument()
    })

    // Wait to ensure no spurious update calls
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // updateSpec should NOT have been called with empty content
    const emptyContentCalls = mockUpdateSpec.mock.calls.filter((call) => {
      const { data } = call[0]
      return data.content === '' || data.content === undefined
    })

    expect(emptyContentCalls.length).toBe(0)
  })

  it(
    'should clear auto-save timer when navigating between specs',
    async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      })

      const spec1 = {
        ...mockSpec,
        id: 'SPEC-001',
        title: 'Spec One',
      }

      const spec2 = {
        ...mockSpec,
        id: 'SPEC-002',
        title: 'Spec Two',
      }

      vi.mocked(useSpecsHook.useSpec).mockReturnValue({
        spec: spec1,
        isLoading: false,
        isError: false,
      } as any)

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/specs/SPEC-001']}>
            <Routes>
              <Route path="/specs/:id" element={<SpecDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )

      await waitFor(() => {
        expect(screen.getByDisplayValue('Spec One')).toBeInTheDocument()
      })

      // Make changes
      const titleInput = screen.getByDisplayValue('Spec One')
      await user.clear(titleInput)
      await user.type(titleInput, 'Modified')

      // Navigate to spec2 quickly (before auto-save)
      vi.mocked(useSpecsHook.useSpec).mockReturnValue({
        spec: spec2,
        isLoading: false,
        isError: false,
      } as any)

      rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/specs/SPEC-002']}>
            <Routes>
              <Route path="/specs/:id" element={<SpecDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )

      await waitFor(() => {
        expect(screen.getByDisplayValue('Spec Two')).toBeInTheDocument()
      })

      // Wait past auto-save delay
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // The old timer should have been cleared, so no update should happen
      // If it did happen, it would be caught by other tests checking for wrong ID
      expect(mockUpdateSpec).not.toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'SPEC-001',
        })
      )
    },
    { timeout: 10000 }
  )

  it(
    'should save pending changes on unmount using correct spec ID',
    async () => {
      const user = userEvent.setup()

      vi.mocked(useSpecsHook.useSpec).mockReturnValue({
        spec: mockSpec,
        isLoading: false,
        isError: false,
      } as any)

      const { unmount } = renderSpecDetailPage()

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Spec')).toBeInTheDocument()
      })

      // Make changes
      const titleInput = screen.getByDisplayValue('Test Spec')
      await user.clear(titleInput)
      await user.type(titleInput, 'Changed Title')

      // Should show unsaved changes
      await waitFor(() => {
        expect(screen.getByText('Unsaved changes...')).toBeInTheDocument()
      })

      // Unmount before auto-save triggers
      unmount()

      // Allow a brief moment for the unmount effect to run
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have saved with the correct spec ID
      expect(mockUpdateSpec).toHaveBeenCalledWith({
        id: 'SPEC-001',
        data: expect.objectContaining({
          title: 'Changed Title',
        }),
      })
    },
    { timeout: 10000 }
  )
})
