import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import SpecsPage from '@/pages/SpecsPage'
import { specsApi } from '@/lib/api'
import type { Spec } from '@/types/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  specsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getById: vi.fn(),
    getFeedback: vi.fn(),
  },
}))

const mockSpecs: Spec[] = [
  {
    id: 'SPEC-001',
    uuid: 'test-uuid-1',
    title: 'Test Spec 1',
    content: 'This is the content of spec 1',
    priority: 1,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    parent_id: null,
    file_path: 'specs/test-spec-1.md',
  },
  {
    id: 'SPEC-002',
    uuid: 'test-uuid-2',
    title: 'Test Spec 2',
    content: 'This is the content of spec 2',
    priority: 2,
    created_at: '2024-01-02',
    updated_at: '2024-01-02',
    parent_id: null,
    file_path: 'specs/test-spec-2.md',
  },
]

describe('SpecsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(screen.getByText(/2 specs/)).toBeInTheDocument()
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
      expect(screen.getByText('High')).toBeInTheDocument()
      expect(screen.getByText('Medium')).toBeInTheDocument()
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
      expect(screen.getByText(/0 specs/)).toBeInTheDocument()
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
})
