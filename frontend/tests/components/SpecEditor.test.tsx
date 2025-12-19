import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { SpecEditor } from '@/components/specs/SpecEditor'
import type { Spec } from '@/types/api'
import React from 'react'

// Mock the useSpecs hook
const mockCreateSpecAsync = vi.fn()
const mockUpdateSpecAsync = vi.fn()
vi.mock('@/hooks/useSpecs', () => ({
  useSpecs: () => ({
    createSpecAsync: mockCreateSpecAsync,
    updateSpecAsync: mockUpdateSpecAsync,
    isCreating: false,
  }),
}))

// Mock useProjectRoutes hook
vi.mock('@/hooks/useProjectRoutes', () => ({
  useProjectRoutes: () => ({
    paths: {
      execution: (id: string) => `/p/test-project/executions/${id}`,
      spec: (id: string) => `/p/test-project/specs/${id}`,
    },
    effectiveProjectId: 'test-project',
  }),
}))

describe('SpecEditor', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    vi.clearAllMocks()
    // Mock localStorage to default to markdown mode for tests
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'sudocode:specEditor:viewMode') {
        return JSON.stringify('markdown')
      }
      return null
    })
    Storage.prototype.setItem = vi.fn()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )

  it('should render create form when no spec is provided', () => {
    render(<SpecEditor />, { wrapper })

    expect(screen.getByText('New Spec')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('should render edit form when spec is provided', () => {
    const spec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Existing Spec',
      content: 'Existing content',
      file_path: '/path/to/spec.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: undefined,
    }

    render(<SpecEditor spec={spec} />, { wrapper })

    expect(screen.getByText('Edit Spec')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing Spec')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing content')).toBeInTheDocument()
  })

  it('should validate required title field', async () => {
    const user = userEvent.setup()
    render(<SpecEditor />, { wrapper })

    const submitButton = screen.getByRole('button', { name: /create/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument()
    })

    expect(mockCreateSpecAsync).not.toHaveBeenCalled()
  })

  it('should create a new spec with valid data', async () => {
    const newSpec: Spec = {
      id: 'SPEC-002',
      uuid: 'uuid-2',
      title: 'New Spec',
      content: 'New content',
      file_path: '/path/to/new-spec.md',
      priority: 2,
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      parent_id: undefined,
    }

    mockCreateSpecAsync.mockResolvedValue(newSpec)
    const onSave = vi.fn()

    render(<SpecEditor onSave={onSave} />, { wrapper })

    // Fill in the form
    const titleInput = screen.getByLabelText(/title/i)
    const contentInput = screen.getByLabelText(/content/i)
    const prioritySelect = screen.getByLabelText(/priority/i)

    fireEvent.change(titleInput, { target: { value: 'New Spec' } })
    fireEvent.change(contentInput, { target: { value: 'New content' } })
    fireEvent.change(prioritySelect, { target: { value: '2' } })

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockCreateSpecAsync).toHaveBeenCalledWith({
        title: 'New Spec',
        content: 'New content',
        priority: 2,
      })
      expect(onSave).toHaveBeenCalledWith(newSpec)
    })
  })

  it('should update an existing spec', async () => {
    const existingSpec: Spec = {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Existing Spec',
      content: 'Existing content',
      file_path: '/path/to/spec.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: undefined,
    }

    const updatedSpec: Spec = {
      ...existingSpec,
      title: 'Updated Spec',
      updated_at: '2024-01-01T12:00:00Z',
    }

    mockUpdateSpecAsync.mockResolvedValue(updatedSpec)
    const onSave = vi.fn()

    render(<SpecEditor spec={existingSpec} onSave={onSave} />, { wrapper })

    // Update the title
    const titleInput = screen.getByDisplayValue('Existing Spec')
    fireEvent.change(titleInput, { target: { value: 'Updated Spec' } })

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /update/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockUpdateSpecAsync).toHaveBeenCalledWith({
        id: 'SPEC-001',
        data: {
          title: 'Updated Spec',
          content: 'Existing content',
          priority: 1,
        },
      })
      expect(onSave).toHaveBeenCalledWith(updatedSpec)
    })
  })

  it('should call onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<SpecEditor onCancel={onCancel} />, { wrapper })

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should not show cancel button when onCancel is not provided', () => {
    render(<SpecEditor />, { wrapper })

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('should display error message on submission failure', async () => {
    const error = new Error('Failed to create spec')
    mockCreateSpecAsync.mockRejectedValue(error)

    render(<SpecEditor />, { wrapper })

    // Fill in the form
    const titleInput = screen.getByLabelText(/title/i)
    fireEvent.change(titleInput, { target: { value: 'Test Spec' } })

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Failed to create spec')).toBeInTheDocument()
    })
  })

  it('should have correct priority options', () => {
    render(<SpecEditor />, { wrapper })

    const prioritySelect = screen.getByLabelText(/priority/i)
    const options = prioritySelect.querySelectorAll('option')

    expect(options).toHaveLength(5)
    expect(options[0]).toHaveTextContent('Critical (0)')
    expect(options[1]).toHaveTextContent('High (1)')
    expect(options[2]).toHaveTextContent('Medium (2)')
    expect(options[3]).toHaveTextContent('Low (3)')
    expect(options[4]).toHaveTextContent('None (4)')
  })

  it('should default to priority 3 (Low) for new specs', () => {
    render(<SpecEditor />, { wrapper })

    const prioritySelect = screen.getByLabelText(/priority/i) as HTMLSelectElement
    expect(prioritySelect.value).toBe('3')
  })

  it('should trim whitespace from title and content', async () => {
    mockCreateSpecAsync.mockResolvedValue({} as Spec)

    render(<SpecEditor />, { wrapper })

    const titleInput = screen.getByLabelText(/title/i)
    const contentInput = screen.getByLabelText(/content/i)

    fireEvent.change(titleInput, { target: { value: '  Trimmed Title  ' } })
    fireEvent.change(contentInput, { target: { value: '  Trimmed Content  ' } })

    const submitButton = screen.getByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockCreateSpecAsync).toHaveBeenCalledWith({
        title: 'Trimmed Title',
        content: 'Trimmed Content',
        priority: 3,
      })
    })
  })

  it('should handle empty content gracefully', async () => {
    mockCreateSpecAsync.mockResolvedValue({} as Spec)

    render(<SpecEditor />, { wrapper })

    const titleInput = screen.getByLabelText(/title/i)
    fireEvent.change(titleInput, { target: { value: 'Title Only' } })

    const submitButton = screen.getByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockCreateSpecAsync).toHaveBeenCalledWith({
        title: 'Title Only',
        content: undefined,
        priority: 3,
      })
    })
  })
})
