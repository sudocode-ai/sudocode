import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ImportDialog } from '@/components/import/ImportDialog'
import { importApi } from '@/lib/api'
import type { ImportPreviewResponse, ImportSearchResponse, BatchImportResponse } from '@/lib/api'

// Mock the API
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    importApi: {
      preview: vi.fn(),
      import: vi.fn(),
      getProviders: vi.fn(),
      search: vi.fn(),
      batchImport: vi.fn(),
    },
  }
})

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock useProjectRoutes hook
vi.mock('@/hooks/useProjectRoutes', () => ({
  useProjectRoutes: () => ({
    paths: {
      spec: (id: string) => `/p/test-project/specs/${id}`,
      specs: () => `/p/test-project/specs`,
    },
    effectiveProjectId: 'test-project',
  }),
}))

// Mock useRepositoryInfo
vi.mock('@/hooks/useRepositoryInfo', () => ({
  useRepositoryInfo: () => ({
    data: {
      name: 'test-repo',
      branch: 'main',
      path: '/test/path',
      ownerRepo: 'owner/repo',
      gitProvider: 'github',
    },
    isLoading: false,
  }),
}))

describe('ImportDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  const mockProviders = [
    {
      name: 'github',
      displayName: 'GitHub Issues',
      configured: true,
      supportsOnDemandImport: true,
      supportsSearch: true,
      urlPatterns: ['https://github.com/*/issues/*'],
      authMethod: 'gh-cli' as const,
    },
  ]

  const mockPreviewResponse: ImportPreviewResponse = {
    provider: 'github',
    entity: {
      id: 'owner/repo#123',
      type: 'spec',
      title: 'Test Issue',
      description: 'Test description',
      url: 'https://github.com/owner/repo/issues/123',
      status: 'open',
    },
    commentsCount: 3,
  }

  const mockSearchResponse: ImportSearchResponse = {
    provider: 'github',
    results: [
      {
        id: 'owner/repo#1',
        type: 'spec',
        title: 'First Issue',
        description: 'First description',
        url: 'https://github.com/owner/repo/issues/1',
        status: 'open',
      },
      {
        id: 'owner/repo#2',
        type: 'spec',
        title: 'Second Issue',
        description: 'Second description',
        url: 'https://github.com/owner/repo/issues/2',
        status: 'closed',
      },
    ],
    pagination: {
      page: 1,
      perPage: 20,
      hasMore: false,
    },
  }

  const mockBatchImportResponse: BatchImportResponse = {
    provider: 'github',
    created: 1,
    updated: 0,
    failed: 0,
    results: [
      {
        externalId: 'owner/repo#123',
        success: true,
        entityId: 's-abc123',
        action: 'created',
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(importApi.getProviders).mockResolvedValue({ providers: mockProviders })
  })

  it('should not render when open is false', () => {
    renderWithProviders(<ImportDialog {...defaultProps} open={false} />)

    expect(screen.queryByText('Import External Source')).not.toBeInTheDocument()
  })

  it('should render when open is true', async () => {
    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Import External Source')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Import issues or documents from an external system/)
    ).toBeInTheDocument()
  })

  it('should display input field with placeholder', async () => {
    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })
  })

  it('should call onClose when Cancel button clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<ImportDialog open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('should detect URL and call preview API', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.preview).mockResolvedValue(mockPreviewResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'https://github.com/owner/repo/issues/123')

    // Click search button (has Search icon)
    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(importApi.preview).toHaveBeenCalledWith('https://github.com/owner/repo/issues/123')
    })
  })

  it('should show preview result after URL lookup', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.preview).mockResolvedValue(mockPreviewResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'https://github.com/owner/repo/issues/123')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('Test Issue')).toBeInTheDocument()
    })
  })

  it('should call search API for non-URL queries', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.search).mockResolvedValue(mockSearchResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'bug fix')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(importApi.search).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'github',
          query: expect.stringContaining('bug fix'),
        })
      )
    })
  })

  it('should display search results', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.search).mockResolvedValue(mockSearchResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'test query')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('First Issue')).toBeInTheDocument()
      expect(screen.getByText('Second Issue')).toBeInTheDocument()
    })
  })

  it('should allow selecting and deselecting items', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.search).mockResolvedValue(mockSearchResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'test')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('First Issue')).toBeInTheDocument()
    })

    // Find checkboxes - there should be one per result plus select-all
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)

    // Click on a result to select it
    await user.click(screen.getByText('First Issue'))

    // Selection count should update
    await waitFor(() => {
      expect(screen.getByText(/1 of 2 selected/)).toBeInTheDocument()
    })
  })

  it('should call batchImport API when Import clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.preview).mockResolvedValue(mockPreviewResponse)
    vi.mocked(importApi.batchImport).mockResolvedValue(mockBatchImportResponse)

    const onClose = vi.fn()
    const onImported = vi.fn()

    renderWithProviders(<ImportDialog open={true} onClose={onClose} onImported={onImported} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    // Enter a URL (which auto-selects the result)
    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'https://github.com/owner/repo/issues/123')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('Test Issue')).toBeInTheDocument()
    })

    // Click Import button
    const importButton = screen.getByRole('button', { name: /Import/ })
    await user.click(importButton)

    await waitFor(() => {
      expect(importApi.batchImport).toHaveBeenCalledWith({
        provider: 'github',
        externalIds: ['owner/repo#123'],
      })
    })
  })

  it('should navigate to spec after successful import', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.preview).mockResolvedValue(mockPreviewResponse)
    vi.mocked(importApi.batchImport).mockResolvedValue(mockBatchImportResponse)

    const onClose = vi.fn()
    const onImported = vi.fn()

    renderWithProviders(<ImportDialog open={true} onClose={onClose} onImported={onImported} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'https://github.com/owner/repo/issues/123')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('Test Issue')).toBeInTheDocument()
    })

    const importButton = screen.getByRole('button', { name: /Import/ })
    await user.click(importButton)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
      expect(onImported).toHaveBeenCalledWith(['s-abc123'])
      expect(mockNavigate).toHaveBeenCalledWith('/p/test-project/specs/s-abc123')
    })
  })

  it('should show error when preview fails', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.preview).mockRejectedValue(new Error('Not found'))

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'https://github.com/owner/repo/issues/999')

    const searchButton = screen.getByRole('button', { name: '' })
    await user.click(searchButton)

    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument()
    })
  })

  it('should submit on Enter key', async () => {
    const user = userEvent.setup()
    vi.mocked(importApi.preview).mockResolvedValue(mockPreviewResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste URL or search...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste URL or search...')
    await user.type(input, 'https://github.com/owner/repo/issues/123{Enter}')

    await waitFor(() => {
      expect(importApi.preview).toHaveBeenCalled()
    })
  })

  it('should reset state when dialog reopens', async () => {
    vi.mocked(importApi.search).mockResolvedValue(mockSearchResponse)

    const { rerender } = renderWithProviders(<ImportDialog {...defaultProps} />)

    // Close and reopen
    rerender(<ImportDialog {...defaultProps} open={false} />)
    rerender(<ImportDialog {...defaultProps} open={true} />)

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Paste URL or search...')
      expect(input).toHaveValue('')
    })
  })

  it('should disable Import button when nothing selected', async () => {
    vi.mocked(importApi.search).mockResolvedValue(mockSearchResponse)

    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      const importButton = screen.getByRole('button', { name: /Import/ })
      expect(importButton).toBeDisabled()
    })
  })

  it('should show provider selector when providers available', async () => {
    renderWithProviders(<ImportDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('GitHub Issues')).toBeInTheDocument()
    })
  })
})
