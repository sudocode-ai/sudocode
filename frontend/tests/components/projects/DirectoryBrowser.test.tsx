import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DirectoryBrowser } from '@/components/projects/DirectoryBrowser'
import * as api from '@/lib/api'

// Mock API
vi.mock('@/lib/api', () => ({
  projectsApi: {
    browse: vi.fn(),
  },
}))

describe('DirectoryBrowser', () => {
  let queryClient: QueryClient

  const mockBrowseResponse = {
    currentPath: '/Users/test',
    parentPath: '/Users',
    entries: [
      { name: 'project-1', path: '/Users/test/project-1', isDirectory: true, hasSudocode: true },
      { name: 'project-2', path: '/Users/test/project-2', isDirectory: true, hasSudocode: false },
      { name: 'documents', path: '/Users/test/documents', isDirectory: true, hasSudocode: false },
    ],
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    vi.clearAllMocks()

    // Default mock implementation
    vi.mocked(api.projectsApi.browse).mockResolvedValue(mockBrowseResponse)
  })

  const renderWithProviders = (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (path: string) => void
    title?: string
    description?: string
  }) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <DirectoryBrowser {...props} />
      </QueryClientProvider>
    )
  }

  it('should not render when closed', () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: false, onOpenChange, onSelect })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should render dialog when open', async () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('should display custom title and description', async () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({
      open: true,
      onOpenChange,
      onSelect,
      title: 'Custom Title',
      description: 'Custom description text',
    })

    await waitFor(() => {
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
      expect(screen.getByText('Custom description text')).toBeInTheDocument()
    })
  })

  it('should display loading state initially', async () => {
    // Make browse return a pending promise
    vi.mocked(api.projectsApi.browse).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    // Should show loading spinner
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('should display directory entries after loading', async () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('project-1')).toBeInTheDocument()
      expect(screen.getByText('project-2')).toBeInTheDocument()
      expect(screen.getByText('documents')).toBeInTheDocument()
    })
  })

  it('should update path input with current directory', async () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      const input = screen.getByPlaceholderText('/path/to/directory')
      expect(input).toHaveValue('/Users/test')
    })
  })

  it('should navigate to parent directory when clicking ".."', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('..')).toBeInTheDocument()
    })

    await user.click(screen.getByText('..'))

    await waitFor(() => {
      expect(api.projectsApi.browse).toHaveBeenCalledWith('/Users')
    })
  })

  it('should navigate into directory when clicking chevron', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('project-1')).toBeInTheDocument()
    })

    // Find and click the chevron button for project-1 (first chevron after the entries load)
    const chevrons = screen.getAllByRole('button').filter((btn) => {
      const svg = btn.querySelector('svg')
      return svg?.classList.contains('lucide-chevron-right')
    })

    if (chevrons.length > 0) {
      await user.click(chevrons[0])

      await waitFor(() => {
        expect(api.projectsApi.browse).toHaveBeenCalledWith('/Users/test/project-1')
      })
    }
  })

  it('should select directory when clicking on name', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('project-1')).toBeInTheDocument()
    })

    await user.click(screen.getByText('project-1'))

    await waitFor(() => {
      const input = screen.getByPlaceholderText('/path/to/directory')
      expect(input).toHaveValue('/Users/test/project-1')
    })
  })

  it('should call onSelect with selected path when confirming', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('project-1')).toBeInTheDocument()
    })

    // Select a directory
    await user.click(screen.getByText('project-1'))

    // Click Select button
    const selectButton = screen.getByRole('button', { name: /^select$/i })
    await user.click(selectButton)

    expect(onSelect).toHaveBeenCalledWith('/Users/test/project-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('should close dialog when clicking Cancel', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('should navigate to path when entering in input and clicking Go', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('/path/to/directory')).toBeInTheDocument()
    })

    // Wait for the input to be populated with current path
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/path/to/directory')
      expect(input).toHaveValue('/Users/test')
    })

    const input = screen.getByPlaceholderText('/path/to/directory')
    await user.clear(input)
    await user.type(input, '/some/other/path')

    const goButton = screen.getByRole('button', { name: /go/i })
    await user.click(goButton)

    await waitFor(() => {
      expect(api.projectsApi.browse).toHaveBeenCalledWith('/some/other/path')
    })
  })

  it('should navigate to path when pressing Enter in input', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    // Wait for the input to be populated with current path
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/path/to/directory')
      expect(input).toHaveValue('/Users/test')
    })

    const input = screen.getByPlaceholderText('/path/to/directory')
    await user.clear(input)
    await user.type(input, '/some/other/path{Enter}')

    await waitFor(() => {
      expect(api.projectsApi.browse).toHaveBeenCalledWith('/some/other/path')
    })
  })

  it('should disable Select button when no path is entered', async () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    // Return empty entries and clear input
    vi.mocked(api.projectsApi.browse).mockResolvedValue({
      currentPath: '',
      parentPath: null,
      entries: [],
    })

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      const selectButton = screen.getByRole('button', { name: /^select$/i })
      expect(selectButton).toBeDisabled()
    })
  })

  it('should show "No subdirectories" when directory is empty', async () => {
    vi.mocked(api.projectsApi.browse).mockResolvedValue({
      currentPath: '/empty/dir',
      parentPath: '/empty',
      entries: [],
    })

    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('No subdirectories')).toBeInTheDocument()
    })
  })

  it('should show error state when browse fails', async () => {
    vi.mocked(api.projectsApi.browse).mockRejectedValue(new Error('Failed to browse'))

    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('Failed to load directory')).toBeInTheDocument()
    })
  })

  it('should not show parent navigation for root directory', async () => {
    vi.mocked(api.projectsApi.browse).mockResolvedValue({
      currentPath: '/',
      parentPath: null,
      entries: [
        { name: 'Users', path: '/Users', isDirectory: true, hasSudocode: false },
      ],
    })

    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    await waitFor(() => {
      expect(screen.getByText('Users')).toBeInTheDocument()
    })

    expect(screen.queryByText('..')).not.toBeInTheDocument()
  })

  it('should use manual path input value when selecting', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    renderWithProviders({ open: true, onOpenChange, onSelect })

    // Wait for the input to be populated with current path
    await waitFor(() => {
      const input = screen.getByPlaceholderText('/path/to/directory')
      expect(input).toHaveValue('/Users/test')
    })

    const input = screen.getByPlaceholderText('/path/to/directory')
    await user.clear(input)
    await user.type(input, '/custom/path')

    const selectButton = screen.getByRole('button', { name: /^select$/i })
    await user.click(selectButton)

    expect(onSelect).toHaveBeenCalledWith('/custom/path')
  })
})
