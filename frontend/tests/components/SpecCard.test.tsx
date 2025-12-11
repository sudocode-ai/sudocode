import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SpecCard } from '@/components/specs/SpecCard'
import type { Spec } from '@/types/api'

// Helper to render with Router context
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('SpecCard', () => {
  const mockSpec: Spec = {
    id: 'SPEC-001',
    uuid: 'uuid-1',
    title: 'Test Spec',
    content: 'This is a test spec with some content that should be previewed',
    file_path: '/path/to/spec.md',
    priority: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    parent_id: undefined,
  }

  it('should render spec title', () => {
    renderWithRouter(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('Test Spec')).toBeInTheDocument()
  })

  it('should render spec ID', () => {
    renderWithRouter(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('SPEC-001')).toBeInTheDocument()
  })

  it('should render priority badge for high priority', () => {
    renderWithRouter(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
  })

  it('should not render priority badge for low priority', () => {
    const lowPrioritySpec = { ...mockSpec, priority: 4 }
    renderWithRouter(<SpecCard spec={lowPrioritySpec} />)
    expect(screen.queryByText('P4')).not.toBeInTheDocument()
  })

  it('should render content preview', () => {
    renderWithRouter(<SpecCard spec={mockSpec} />)
    expect(screen.getByText(/This is a test spec with some content/)).toBeInTheDocument()
  })

  it('should truncate long content', () => {
    const longContent = 'a'.repeat(300)
    const specWithLongContent = { ...mockSpec, content: longContent }
    renderWithRouter(<SpecCard spec={specWithLongContent} />)

    const preview = screen.getByText(/a+\.\.\./)
    expect(preview.textContent?.length).toBeLessThan(210) // 200 chars + "..."
  })

  it('should call onClick when clicked', () => {
    const onClick = vi.fn()
    renderWithRouter(<SpecCard spec={mockSpec} onClick={onClick} />)

    fireEvent.click(screen.getByText('Test Spec'))
    expect(onClick).toHaveBeenCalledWith(mockSpec)
  })

  it('should render without content', () => {
    const specWithoutContent = { ...mockSpec, content: '' }
    renderWithRouter(<SpecCard spec={specWithoutContent} />)

    expect(screen.getByText('Test Spec')).toBeInTheDocument()
    expect(screen.queryByText(/This is a test/)).not.toBeInTheDocument()
  })

  it('should have correct priority colors', () => {
    const { rerender } = renderWithRouter(<SpecCard spec={{ ...mockSpec, priority: 0 }} />)
    let badge = screen.getByText('P0')
    expect(badge).toHaveClass('bg-red-600')

    rerender(
      <MemoryRouter>
        <SpecCard spec={{ ...mockSpec, priority: 1 }} />
      </MemoryRouter>
    )
    badge = screen.getByText('P1')
    expect(badge).toHaveClass('bg-orange-600')

    rerender(
      <MemoryRouter>
        <SpecCard spec={{ ...mockSpec, priority: 2 }} />
      </MemoryRouter>
    )
    badge = screen.getByText('P2')
    expect(badge).toHaveClass('bg-yellow-600')

    rerender(
      <MemoryRouter>
        <SpecCard spec={{ ...mockSpec, priority: 3 }} />
      </MemoryRouter>
    )
    badge = screen.getByText('P3')
    expect(badge).toHaveClass('bg-blue-600')
  })
})
