import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpecViewer } from '@/components/specs/SpecViewer'

describe('SpecViewer', () => {
  const sampleContent = `# Header

This is paragraph 1.

This is paragraph 2.`

  it('should render content with line numbers by default', () => {
    render(<SpecViewer content={sampleContent} />)

    // Check that all line numbers are rendered sequentially
    // Line 1: # Header
    // Line 2: (empty)
    // Line 3: This is paragraph 1.
    // Line 4: (empty)
    // Line 5: This is paragraph 2.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
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
    expect(screen.getByText('This is paragraph 1.')).toBeInTheDocument()
    expect(screen.getByText('This is paragraph 2.')).toBeInTheDocument()
  })

  it('should highlight specified lines', () => {
    const { container } = render(
      <SpecViewer content={sampleContent} highlightLines={[1, 3]} />
    )

    const highlightedElements = container.querySelectorAll('.bg-primary\\/10')
    expect(highlightedElements.length).toBeGreaterThan(0)
  })

  it('should handle empty content', () => {
    render(<SpecViewer content="" />)

    // Empty content should still show line 1
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

  it('should render as textarea when editable is true', () => {
    render(<SpecViewer content={sampleContent} editable={true} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue(sampleContent)
  })

  it('should call onChange when content is edited in editable mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SpecViewer content={sampleContent} editable={true} onChange={onChange} />)

    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'New content')

    expect(onChange).toHaveBeenCalled()
  })

  it('should not render textarea when editable is false', () => {
    render(<SpecViewer content={sampleContent} editable={false} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
