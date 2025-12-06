import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import SpecsPage from '@/pages/SpecsPage'
import { specsApi } from '@/lib/api'
import type { Spec } from '@/types/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  specsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getById: vi.fn(),
    getFeedback: vi.fn(),
  },
  issuesApi: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getById: vi.fn(),
  },
  repositoryApi: {
    getInfo: vi.fn().mockResolvedValue({
      name: 'test-repo',
      branch: 'main',
      path: '/test/path',
    }),
  },
}))

// Mock WebSocket
vi.mock('@/contexts/WebSocketContext', async () => {
  const actual = await vi.importActual('@/contexts/WebSocketContext')
  return {
    ...actual,
    WebSocketProvider: ({ children }: { children: React.ReactNode }) => children,
    useWebSocketContext: () => ({
      connected: false,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      addMessageHandler: vi.fn(),
      removeMessageHandler: vi.fn(),
      lastMessage: null,
    }),
  }
})

const mockSpecs: Spec[] = [
  {
    id: 'SPEC-001',
    uuid: 'test-uuid-1',
    title: 'Test Spec 1',
    content: 'This is the content of spec 1',
    priority: 1,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    parent_id: undefined,
    file_path: 'specs/test-spec-1.md',
    archived: undefined,
    archived_at: undefined,
  },
  {
    id: 'SPEC-002',
    uuid: 'test-uuid-2',
    title: 'Test Spec 2',
    content: 'This is the content of spec 2',
    priority: 2,
    created_at: '2024-01-02',
    updated_at: '2024-01-02',
    parent_id: undefined,
    file_path: 'specs/test-spec-2.md',
  },
]

describe('SpecsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear localStorage before each test
    localStorage.clear()
  })

  afterEach(() => {
    // Clean up localStorage after each test
    localStorage.clear()
  })

  it('should show loading state initially', () => {
    vi.mocked(specsApi.getAll).mockReturnValue(
      new Promise(() => {}) // Never resolves
    )

    renderWithProviders(<SpecsPage />)
    expect(screen.getByText('Loading specs...')).toBeInTheDocument()
  })

  it('should display specs when loaded', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Spec 1')).toBeInTheDocument()
      expect(screen.getByText('Test Spec 2')).toBeInTheDocument()
    })
  })

  it('should show spec count', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('should display spec IDs', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      expect(screen.getByText('SPEC-002')).toBeInTheDocument()
    })
  })

  it('should display spec priorities', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      expect(screen.getByText('P1')).toBeInTheDocument()
      expect(screen.getByText('P2')).toBeInTheDocument()
    })
  })

  it('should display spec file paths', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      expect(screen.getByText('specs/test-spec-1.md')).toBeInTheDocument()
      expect(screen.getByText('specs/test-spec-2.md')).toBeInTheDocument()
    })
  })

  it('should truncate long content', async () => {
    const longContentSpec: Spec = {
      ...mockSpecs[0],
      content: 'a'.repeat(300),
    }
    vi.mocked(specsApi.getAll).mockResolvedValue([longContentSpec])

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      const content = screen.getByText(/aaa/)
      expect(content.textContent).toContain('...')
    })
  })

  it('should handle empty specs list', async () => {
    vi.mocked(specsApi.getAll).mockResolvedValue([])

    renderWithProviders(<SpecsPage />)

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })

  it('should handle API error gracefully', async () => {
    vi.mocked(specsApi.getAll).mockRejectedValue(new Error('Failed to load specs'))

    renderWithProviders(<SpecsPage />)

    // Should not crash and show empty state
    await waitFor(() => {
      expect(screen.getByText('No specs found')).toBeInTheDocument()
    })
  })

  describe('Sorting functionality', () => {
    const sortableSpecs: Spec[] = [
      {
        id: 'SPEC-001',
        uuid: 'uuid-1',
        title: 'High Priority Spec',
        content: 'Content 1',
        priority: 0, // P0 - highest priority
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T10:00:00Z',
        parent_id: undefined,
        file_path: 'specs/spec-1.md',
        archived: undefined,
        archived_at: undefined,
      },
      {
        id: 'SPEC-002',
        uuid: 'uuid-2',
        title: 'Medium Priority Newest',
        content: 'Content 2',
        priority: 2, // P2
        created_at: '2024-01-20T10:00:00Z', // Newest
        updated_at: '2024-01-21T10:00:00Z', // Most recently updated
        parent_id: undefined,
        file_path: 'specs/spec-2.md',
      },
      {
        id: 'SPEC-003',
        uuid: 'uuid-3',
        title: 'Low Priority Oldest',
        content: 'Content 3',
        priority: 4, // P4 - lowest priority
        created_at: '2024-01-10T10:00:00Z', // Oldest
        updated_at: '2024-01-11T10:00:00Z', // Least recently updated
        parent_id: undefined,
        file_path: 'specs/spec-3.md',
      },
      {
        id: 'SPEC-004',
        uuid: 'uuid-4',
        title: 'High Priority Older',
        content: 'Content 4',
        priority: 0, // P0 - same as SPEC-001
        created_at: '2024-01-12T10:00:00Z', // Older than SPEC-001
        updated_at: '2024-01-19T10:00:00Z',
        parent_id: undefined,
        file_path: 'specs/spec-4.md',
      },
    ]

    it('should sort by priority by default (low to high, then newest)', async () => {
      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      await waitFor(() => {
        const specCards = screen.getAllByText(/SPEC-\d{3}/)
        // P0 specs first (sorted by date within priority), then P2, then P4
        expect(specCards[0]).toHaveTextContent('SPEC-001') // P0, newer
        expect(specCards[1]).toHaveTextContent('SPEC-004') // P0, older
        expect(specCards[2]).toHaveTextContent('SPEC-002') // P2
        expect(specCards[3]).toHaveTextContent('SPEC-003') // P4
      })
    })

    it('should sort by newest when selected', async () => {
      const user = userEvent.setup()
      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      await waitFor(() => {
        expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      })

      // Click the sort dropdown
      const sortTrigger = screen.getByRole('combobox')
      await user.click(sortTrigger)

      // Select "Newest"
      const newestOption = screen.getByRole('option', { name: 'Newest' })
      await user.click(newestOption)

      // Check order by created_at descending
      await waitFor(() => {
        const specCards = screen.getAllByText(/SPEC-\d{3}/)
        expect(specCards[0]).toHaveTextContent('SPEC-002') // 2024-01-20
        expect(specCards[1]).toHaveTextContent('SPEC-001') // 2024-01-15
        expect(specCards[2]).toHaveTextContent('SPEC-004') // 2024-01-12
        expect(specCards[3]).toHaveTextContent('SPEC-003') // 2024-01-10
      })
    })

    it('should sort by last updated when selected', async () => {
      const user = userEvent.setup()
      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      await waitFor(() => {
        expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      })

      // Click the sort dropdown
      const sortTrigger = screen.getByRole('combobox')
      await user.click(sortTrigger)

      // Select "Last Updated"
      const lastUpdatedOption = screen.getByRole('option', { name: 'Last Updated' })
      await user.click(lastUpdatedOption)

      // Check order by updated_at descending
      await waitFor(() => {
        const specCards = screen.getAllByText(/SPEC-\d{3}/)
        expect(specCards[0]).toHaveTextContent('SPEC-002') // 2024-01-21
        expect(specCards[1]).toHaveTextContent('SPEC-001') // 2024-01-20
        expect(specCards[2]).toHaveTextContent('SPEC-004') // 2024-01-19
        expect(specCards[3]).toHaveTextContent('SPEC-003') // 2024-01-11
      })
    })

    it('should persist sort preference to localStorage', async () => {
      const user = userEvent.setup()
      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      await waitFor(() => {
        expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      })

      // Change sort option
      const sortTrigger = screen.getByRole('combobox')
      await user.click(sortTrigger)
      const newestOption = screen.getByRole('option', { name: 'Newest' })
      await user.click(newestOption)

      // Check localStorage was updated
      await waitFor(() => {
        expect(localStorage.getItem('sudocode:specs:sortOption')).toBe('newest')
      })
    })

    it('should load sort preference from localStorage on mount', async () => {
      // Set localStorage before rendering
      localStorage.setItem('sudocode:specs:sortOption', 'last-updated')

      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      // Should be sorted by last updated
      await waitFor(() => {
        const specCards = screen.getAllByText(/SPEC-\d{3}/)
        expect(specCards[0]).toHaveTextContent('SPEC-002') // Most recently updated
      })
    })

    it('should fall back to default when localStorage has invalid value', async () => {
      // Set invalid value in localStorage
      localStorage.setItem('sudocode:specs:sortOption', 'invalid-sort-option')

      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      // Should use default priority sort
      await waitFor(() => {
        const specCards = screen.getAllByText(/SPEC-\d{3}/)
        expect(specCards[0]).toHaveTextContent('SPEC-001') // P0 priority
      })
    })

    it('should handle localStorage errors gracefully', async () => {
      // Mock localStorage to throw an error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const originalGetItem = localStorage.getItem.bind(localStorage)
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
        if (key === 'sudocode:specs:sortOption') {
          throw new Error('localStorage error')
        }
        return originalGetItem(key)
      })

      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      // Should still render and use default sort
      await waitFor(() => {
        expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load sort preference from localStorage:',
        expect.any(Error)
      )

      getItemSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should maintain sort order when filtering specs', async () => {
      const user = userEvent.setup()
      vi.mocked(specsApi.getAll).mockResolvedValue(sortableSpecs)

      renderWithProviders(<SpecsPage />)

      await waitFor(() => {
        expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      })

      // Change to newest sort
      const sortTrigger = screen.getByRole('combobox')
      await user.click(sortTrigger)
      const newestOption = screen.getByRole('option', { name: 'Newest' })
      await user.click(newestOption)

      // Filter for "High" in title to get only SPEC-001 and SPEC-004
      const searchInput = screen.getByPlaceholderText('Filter specs...')
      await user.type(searchInput, 'High')

      // Should show filtered results in newest order
      await waitFor(() => {
        const specCards = screen.getAllByText(/SPEC-\d{3}/)
        expect(specCards).toHaveLength(2) // Two specs with "High" in title
        expect(specCards[0]).toHaveTextContent('SPEC-001') // 2024-01-15 (newer)
        expect(specCards[1]).toHaveTextContent('SPEC-004') // 2024-01-12 (older)
      })
    })
  })
})
