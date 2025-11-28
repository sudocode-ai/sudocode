/**
 * Tests for DiffViewer component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DiffViewer } from '@/components/executions/DiffViewer'
import { ThemeProvider } from '@/contexts/ThemeContext'

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified, language }: any) => (
    <div data-testid="monaco-diff-editor">
      <div data-testid="monaco-language">{language}</div>
      <div data-testid="monaco-original">{original}</div>
      <div data-testid="monaco-modified">{modified}</div>
    </div>
  ),
}))

// Helper to wrap component with ThemeProvider
const renderWithTheme = (ui: React.ReactElement) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('DiffViewer', () => {
  describe('Rendering', () => {
    it('renders diff with old and new content', () => {
      renderWithTheme(
        <DiffViewer
          oldContent="const foo = 1"
          newContent="const foo = 2"
          filePath="test.ts"
        />
      )

      expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument()
      expect(screen.getByTestId('monaco-language')).toHaveTextContent('typescript')
      expect(screen.getByTestId('monaco-original')).toHaveTextContent('const foo = 1')
      expect(screen.getByTestId('monaco-modified')).toHaveTextContent('const foo = 2')
    })

    it('detects language from file path', () => {
      renderWithTheme(
        <DiffViewer oldContent="print(1)" newContent="print(2)" filePath="script.py" />
      )

      expect(screen.getByTestId('monaco-language')).toHaveTextContent('python')
    })

    it('handles multiline content', () => {
      const oldContent = 'import React\nconst a = 1'
      const newContent = 'import { useState }\nconst a = 2'

      renderWithTheme(
        <DiffViewer oldContent={oldContent} newContent={newContent} filePath="test.ts" />
      )

      const original = screen.getByTestId('monaco-original')
      const modified = screen.getByTestId('monaco-modified')

      expect(original.textContent).toContain('import React')
      expect(original.textContent).toContain('const a = 1')
      expect(modified.textContent).toContain('import { useState }')
      expect(modified.textContent).toContain('const a = 2')
    })
  })

  describe('New file (Write tool equivalent)', () => {
    it('renders new file with empty old content', () => {
      renderWithTheme(
        <DiffViewer
          oldContent=""
          newContent="export const foo = 1\nexport const bar = 2"
          filePath="newFile.ts"
        />
      )

      expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument()
      expect(screen.getByTestId('monaco-original')).toHaveTextContent('')
      expect(screen.getByTestId('monaco-modified')).toHaveTextContent('export const foo = 1')
      expect(screen.getByTestId('monaco-modified')).toHaveTextContent('export const bar = 2')
    })

    it('detects language for new files', () => {
      renderWithTheme(
        <DiffViewer oldContent="" newContent='print("hello")' filePath="script.py" />
      )

      expect(screen.getByTestId('monaco-language')).toHaveTextContent('python')
    })
  })

  describe('Expand/Collapse', () => {
    it('shows expand button for diffs > maxLines', () => {
      const longContent = Array(60)
        .fill(null)
        .map((_, i) => `line ${i}`)
        .join('\n')

      renderWithTheme(
        <DiffViewer
          oldContent={longContent}
          newContent={longContent}
          filePath="test.ts"
          maxLines={50}
        />
      )

      expect(screen.getByText(/Expand full diff/)).toBeInTheDocument()
    })

    it('expands diff when expand button clicked', () => {
      const longContent = Array(60)
        .fill(null)
        .map((_, i) => `line ${i}`)
        .join('\n')

      renderWithTheme(
        <DiffViewer
          oldContent={longContent}
          newContent={longContent}
          filePath="test.ts"
          maxLines={50}
        />
      )

      const expandButton = screen.getByText(/Expand full diff/)
      fireEvent.click(expandButton)

      expect(screen.getByText(/Collapse diff/)).toBeInTheDocument()
    })

    it('expands diff when clicking truncated diff viewer', () => {
      const longContent = Array(60)
        .fill(null)
        .map((_, i) => `line ${i}`)
        .join('\n')

      const { container } = renderWithTheme(
        <DiffViewer
          oldContent={longContent}
          newContent={longContent}
          filePath="test.ts"
          maxLines={50}
        />
      )

      const wrapper = container.querySelector('.diff-collapsed')
      expect(wrapper).toBeInTheDocument()

      fireEvent.click(wrapper!)

      expect(screen.getByText(/Collapse diff/)).toBeInTheDocument()
    })

    it('does not show expand button when under maxLines', () => {
      renderWithTheme(
        <DiffViewer oldContent="foo" newContent="bar" filePath="test.ts" maxLines={50} />
      )

      expect(screen.queryByText(/Expand full diff/)).not.toBeInTheDocument()
    })

    it('uses custom maxLines prop', () => {
      const longContent = Array(30)
        .fill(null)
        .map((_, i) => `line ${i}`)
        .join('\n')

      renderWithTheme(
        <DiffViewer
          oldContent={longContent}
          newContent={longContent}
          filePath="test.ts"
          maxLines={20}
        />
      )

      expect(screen.getByText(/Expand full diff/)).toBeInTheDocument()
    })
  })

  describe('Error handling', () => {
    it('shows error when file path is missing', () => {
      renderWithTheme(<DiffViewer oldContent="foo" newContent="bar" filePath="" />)

      expect(screen.getByText('No file path specified')).toBeInTheDocument()
    })

    it('handles empty content', () => {
      renderWithTheme(<DiffViewer oldContent="" newContent="" filePath="test.ts" />)

      expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument()
      expect(screen.getByTestId('monaco-modified')).toHaveTextContent('')
    })
  })

  describe('Custom className', () => {
    it('applies custom className', () => {
      const { container } = renderWithTheme(
        <DiffViewer
          oldContent="foo"
          newContent="bar"
          filePath="test.ts"
          className="custom-class"
        />
      )

      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })
  })
})
