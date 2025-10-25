import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpecViewer } from '@/components/specs/SpecViewer'

describe('SpecViewer', () => {
  const sampleContent = `# Header\nThis is line 1\nThis is line 2\nThis is line 3`

  it('should render content with line numbers by default', () => {
    render(<SpecViewer content={sampleContent} />)

    // Check that line numbers are rendered
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('should render content without line numbers when disabled', () => {
    const { container } = render(
      <SpecViewer content={sampleContent} showLineNumbers={false} />
    )

    // Line numbers column should not exist
    const lineNumberColumn = container.querySelector('.border-r')
    expect(lineNumberColumn).not.toBeInTheDocument()
  })

  it('should render all content lines', () => {
    render(<SpecViewer content={sampleContent} />)

    expect(screen.getByText('# Header')).toBeInTheDocument()
    expect(screen.getByText('This is line 1')).toBeInTheDocument()
    expect(screen.getByText('This is line 2')).toBeInTheDocument()
    expect(screen.getByText('This is line 3')).toBeInTheDocument()
  })

  it('should highlight specified lines', () => {
    const { container } = render(
      <SpecViewer content={sampleContent} highlightLines={[2, 3]} />
    )

    const highlightedElements = container.querySelectorAll('.bg-primary\\/10')
    expect(highlightedElements.length).toBeGreaterThan(0)
  })

  it('should handle empty content', () => {
    render(<SpecViewer content="" />)

    // Should render at least one line number
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('should handle single line content', () => {
    render(<SpecViewer content="Single line" />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Single line')).toBeInTheDocument()
  })

  it('should preserve whitespace', () => {
    const contentWithSpaces = '    indented line'
    const { container } = render(<SpecViewer content={contentWithSpaces} />)

    const preElement = container.querySelector('pre')
    expect(preElement).toHaveClass('whitespace-pre-wrap')
  })

  it('should use monospace font', () => {
    const { container } = render(<SpecViewer content={sampleContent} />)

    const preElements = container.querySelectorAll('pre')
    preElements.forEach((pre) => {
      expect(pre).toHaveClass('font-mono')
    })
  })

  it('should apply custom className', () => {
    const { container } = render(
      <SpecViewer content={sampleContent} className="custom-class" />
    )

    const card = container.firstChild
    expect(card).toHaveClass('custom-class')
  })

  it('should render multiline content correctly', () => {
    const multilineContent = 'Line 1\n\nLine 3 (with empty line above)'
    render(<SpecViewer content={multilineContent} />)

    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('Line 3 (with empty line above)')).toBeInTheDocument()
  })

  it('should handle long lines with word break', () => {
    const longLine = 'a'.repeat(200)
    const { container } = render(<SpecViewer content={longLine} />)

    const preElement = container.querySelector('pre')
    expect(preElement).toHaveClass('break-words')
  })
})
