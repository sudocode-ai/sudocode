import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { SpecList } from '@/components/specs/SpecList'
import type { Spec } from '@/types/api'

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('SpecList', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  const mockSpecs: Spec[] = [
    {
      id: 'SPEC-001',
      uuid: 'uuid-1',
      title: 'Test Spec 1',
      content: 'Content 1',
      file_path: '/path/to/spec1.md',
      priority: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      parent_id: undefined,
    },
    {
      id: 'SPEC-002',
      uuid: 'uuid-2',
      title: 'Test Spec 2',
      content: 'Content 2',
      file_path: '/path/to/spec2.md',
      priority: 2,
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      parent_id: undefined,
    },
  ]

  it('should render all specs', () => {
    render(
      <BrowserRouter>
        <SpecList specs={mockSpecs} />
      </BrowserRouter>
    )

    expect(screen.getByText('Test Spec 1')).toBeInTheDocument()
    expect(screen.getByText('Test Spec 2')).toBeInTheDocument()
  })

  it('should show loading state', () => {
    render(
      <BrowserRouter>
        <SpecList specs={[]} loading={true} />
      </BrowserRouter>
    )

    expect(screen.getByText('Loading specs...')).toBeInTheDocument()
  })

  it('should show empty state when no specs', () => {
    render(
      <BrowserRouter>
        <SpecList specs={[]} loading={false} />
      </BrowserRouter>
    )

    expect(screen.getByText('No specs found')).toBeInTheDocument()
    expect(screen.getByText('Create a new spec to get started')).toBeInTheDocument()
  })

  it('should show custom empty message', () => {
    render(
      <BrowserRouter>
        <SpecList specs={[]} loading={false} emptyMessage="Custom empty message" />
      </BrowserRouter>
    )

    expect(screen.getByText('Custom empty message')).toBeInTheDocument()
  })

  it('should use grid layout', () => {
    const { container } = render(
      <BrowserRouter>
        <SpecList specs={mockSpecs} />
      </BrowserRouter>
    )

    const grid = container.querySelector('.grid')
    expect(grid).toBeInTheDocument()
    expect(grid).toHaveClass('md:grid-cols-2')
    expect(grid).toHaveClass('lg:grid-cols-3')
  })

  it('should have loading spinner animation', () => {
    const { container } = render(
      <BrowserRouter>
        <SpecList specs={[]} loading={true} />
      </BrowserRouter>
    )

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })
})
