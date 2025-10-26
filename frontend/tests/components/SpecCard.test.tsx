import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SpecCard } from '@/components/specs/SpecCard'
import type { Spec } from '@/types/api'

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
    parent_id: null,
  }

  it('should render spec title', () => {
    render(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('Test Spec')).toBeInTheDocument()
  })

  it('should render spec ID', () => {
    render(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('SPEC-001')).toBeInTheDocument()
  })

  it('should render priority badge for high priority', () => {
    render(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('should not render priority badge for low priority', () => {
    const lowPrioritySpec = { ...mockSpec, priority: 4 }
    render(<SpecCard spec={lowPrioritySpec} />)
    expect(screen.queryByText('None')).not.toBeInTheDocument()
  })

  it('should render content preview', () => {
    render(<SpecCard spec={mockSpec} />)
    expect(
      screen.getByText(/This is a test spec with some content/)
    ).toBeInTheDocument()
  })

  it('should truncate long content', () => {
    const longContent = 'a'.repeat(300)
    const specWithLongContent = { ...mockSpec, content: longContent }
    render(<SpecCard spec={specWithLongContent} />)

    const preview = screen.getByText(/a+\.\.\./)
    expect(preview.textContent?.length).toBeLessThan(210) // 200 chars + "..."
  })

  it('should render file path', () => {
    render(<SpecCard spec={mockSpec} />)
    expect(screen.getByText('/path/to/spec.md')).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    const onClick = vi.fn()
    render(<SpecCard spec={mockSpec} onClick={onClick} />)

    fireEvent.click(screen.getByText('Test Spec'))
    expect(onClick).toHaveBeenCalledWith(mockSpec)
  })

  it('should render without content', () => {
    const specWithoutContent = { ...mockSpec, content: '' }
    render(<SpecCard spec={specWithoutContent} />)

    expect(screen.getByText('Test Spec')).toBeInTheDocument()
    expect(screen.queryByText(/This is a test/)).not.toBeInTheDocument()
  })

  it('should have correct priority colors', () => {
    const { rerender } = render(<SpecCard spec={{ ...mockSpec, priority: 0 }} />)
    let badge = screen.getByText('Critical')
    expect(badge).toHaveClass('bg-red-600')

    rerender(<SpecCard spec={{ ...mockSpec, priority: 1 }} />)
    badge = screen.getByText('High')
    expect(badge).toHaveClass('bg-orange-600')

    rerender(<SpecCard spec={{ ...mockSpec, priority: 2 }} />)
    badge = screen.getByText('Medium')
    expect(badge).toHaveClass('bg-yellow-600')

    rerender(<SpecCard spec={{ ...mockSpec, priority: 3 }} />)
    badge = screen.getByText('Low')
    expect(badge).toHaveClass('bg-blue-600')
  })
})
