/**
 * Tests for FeedbackMark Tiptap extension
 */

import { describe, it, expect } from 'vitest'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { render, screen } from '@testing-library/react'
import { FeedbackMark } from '@/components/specs/extensions/FeedbackMark'

function TestEditor({ content, onUpdate }: { content: string; onUpdate?: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      FeedbackMark,
    ],
    content,
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML())
    },
  })

  return <EditorContent editor={editor} />
}

describe('FeedbackMark Extension', () => {
  it('should be registered as an extension', () => {
    const TestComponent = () => {
      const editor = useEditor({
        extensions: [StarterKit, FeedbackMark],
      })

      if (!editor) return <div>Loading...</div>

      const hasExtension = editor.extensionManager.extensions.find(ext => ext.name === 'feedbackHighlight')
      return <div data-testid="has-extension">{hasExtension ? 'yes' : 'no'}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('has-extension')).toHaveTextContent('yes')
  })

  it('should render mark with data-feedback-id attribute', () => {
    const content = '<p>This is <mark data-feedback-id="FB-001">highlighted text</mark></p>'

    render(<TestEditor content={content} />)

    const mark = document.querySelector('mark[data-feedback-id="FB-001"]')
    expect(mark).toBeInTheDocument()
    expect(mark?.textContent).toBe('highlighted text')
  })

  it('should apply correct CSS classes', () => {
    const content = '<p>This is <mark data-feedback-id="FB-001">highlighted text</mark></p>'

    render(<TestEditor content={content} />)

    const mark = document.querySelector('mark[data-feedback-id="FB-001"]')
    expect(mark).toHaveClass('feedback-highlight')
    expect(mark).toHaveClass('bg-yellow-100')
    expect(mark).toHaveClass('cursor-pointer')
    expect(mark).toHaveClass('hover:bg-yellow-200')
    expect(mark).toHaveClass('transition-colors')
  })

  it('should parse HTML with feedback attributes correctly', () => {
    const content = '<p><mark data-feedback-id="FB-123">Feedback here</mark></p>'

    render(<TestEditor content={content} />)

    const mark = document.querySelector('mark[data-feedback-id="FB-123"]')
    expect(mark).toBeInTheDocument()
    expect(mark?.textContent).toBe('Feedback here')
  })

  it('should support multiple marks in same document', () => {
    const content = `
      <p>First <mark data-feedback-id="FB-001">highlight</mark></p>
      <p>Second <mark data-feedback-id="FB-002">highlight</mark></p>
    `

    render(<TestEditor content={content} />)

    const marks = document.querySelectorAll('mark[data-feedback-id]')
    expect(marks).toHaveLength(2)
    expect(marks[0]).toHaveAttribute('data-feedback-id', 'FB-001')
    expect(marks[1]).toHaveAttribute('data-feedback-id', 'FB-002')
  })

  it('should allow setting mark programmatically via commands', () => {
    const TestComponent = () => {
      const editor = useEditor({
        extensions: [StarterKit, FeedbackMark],
        content: '<p>Test content</p>',
      })

      if (!editor) return <div>Loading...</div>

      // Apply mark programmatically
      editor.chain().selectAll().setFeedbackHighlight({ feedbackId: 'FB-999' }).run()

      return <EditorContent editor={editor} />
    }

    render(<TestComponent />)

    const mark = document.querySelector('mark[data-feedback-id="FB-999"]')
    expect(mark).toBeInTheDocument()
    expect(mark?.textContent).toBe('Test content')
  })

  it('should allow toggling mark via commands', () => {
    const TestComponent = () => {
      const editor = useEditor({
        extensions: [StarterKit, FeedbackMark],
        content: '<p>Test content</p>',
      })

      if (!editor) return <div>Loading...</div>

      // Apply mark, then toggle it off
      editor.chain().selectAll().toggleFeedbackHighlight({ feedbackId: 'FB-001' }).run()
      editor.chain().selectAll().toggleFeedbackHighlight().run()

      return <EditorContent editor={editor} />
    }

    render(<TestComponent />)

    // After toggling off, mark should not exist
    const mark = document.querySelector('mark[data-feedback-id]')
    expect(mark).not.toBeInTheDocument()
  })

  it('should allow unsetting mark via commands', () => {
    const TestComponent = () => {
      const editor = useEditor({
        extensions: [StarterKit, FeedbackMark],
        content: '<p><mark data-feedback-id="FB-001">Highlighted</mark></p>',
      })

      if (!editor) return <div>Loading...</div>

      // Remove mark
      editor.chain().selectAll().unsetFeedbackHighlight().run()

      return <EditorContent editor={editor} />
    }

    render(<TestComponent />)

    const mark = document.querySelector('mark')
    expect(mark).not.toBeInTheDocument()
    expect(document.body.textContent).toContain('Highlighted')
  })

  it('should handle mark without feedbackId attribute', () => {
    const TestComponent = () => {
      const editor = useEditor({
        extensions: [StarterKit, FeedbackMark],
        content: '<p>Test</p>',
      })

      if (!editor) return <div>Loading...</div>

      // Apply mark without feedbackId
      editor.chain().selectAll().setFeedbackHighlight().run()

      return <EditorContent editor={editor} />
    }

    render(<TestComponent />)

    // Should still render a mark element, just without data-feedback-id
    const mark = document.querySelector('mark')
    expect(mark).toBeInTheDocument()
  })

  it('should preserve mark when editing adjacent text', () => {
    const TestComponent = () => {
      const editor = useEditor({
        extensions: [StarterKit, FeedbackMark],
        content: '<p>Before <mark data-feedback-id="FB-001">highlight</mark> after</p>',
      })

      if (!editor) return <div>Loading...</div>

      // Insert text after the mark
      editor.chain().focus('end').insertContent(' more text').run()

      return <EditorContent editor={editor} />
    }

    render(<TestComponent />)

    const mark = document.querySelector('mark[data-feedback-id="FB-001"]')
    expect(mark).toBeInTheDocument()
    expect(mark?.textContent).toBe('highlight')
    expect(document.body.textContent).toContain('more text')
  })
})
