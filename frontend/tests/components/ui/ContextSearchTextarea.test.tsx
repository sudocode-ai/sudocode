import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextSearchTextarea } from '@/components/ui/context-search-textarea'
import { filesApi, specsApi, issuesApi } from '@/lib/api'
import type { FileSearchResult, Spec, Issue } from '@/types/api'
import { useState } from 'react'

// Mock the API modules
vi.mock('@/lib/api', () => ({
  filesApi: {
    search: vi.fn(),
  },
  specsApi: {
    getAll: vi.fn(),
  },
  issuesApi: {
    getAll: vi.fn(),
  },
}))

// Mock caret position utility
vi.mock('@/lib/caret-position', () => ({
  getCaretClientRect: vi.fn(() => ({
    top: 100,
    left: 100,
    bottom: 120,
    right: 200,
    width: 100,
    height: 20,
  })),
}))

// Helper component for controlled textarea
function ControlledTextarea(props: Omit<React.ComponentProps<typeof ContextSearchTextarea>, 'value' | 'onChange'>) {
  const [value, setValue] = useState('')
  return <ContextSearchTextarea {...props} value={value} onChange={setValue} />
}

describe('ContextSearchTextarea', () => {
  const mockFileResults: FileSearchResult[] = [
    { path: 'src/components/Test.tsx', name: 'Test.tsx', isFile: true, matchType: 'prefix' },
  ]

  const mockSpecs: Spec[] = [
    {
      id: 's-test1',
      uuid: 'uuid-1',
      title: 'Test Spec',
      content: 'Test content',
      priority: 1,
      archived: false,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
      file_path: 'specs/test.md',
    } as Spec,
  ]

  const mockIssues: Issue[] = [
    {
      id: 'i-test1',
      uuid: 'uuid-3',
      title: 'Test Issue',
      content: 'Issue content',
      status: 'open',
      priority: 1,
      archived: false,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    } as Issue,
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    // Default mock implementations
    vi.mocked(filesApi.search).mockResolvedValue(mockFileResults)
    vi.mocked(specsApi.getAll).mockResolvedValue(mockSpecs)
    vi.mocked(issuesApi.getAll).mockResolvedValue(mockIssues)
  })

  describe('Basic rendering', () => {
    it('should render textarea', () => {
      render(
        <ControlledTextarea
          projectId="test-project"
          placeholder="Enter text..."
        />
      )

      expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(
        <ControlledTextarea
          projectId="test-project"
          disabled
        />
      )

      expect(screen.getByRole('textbox')).toBeDisabled()
    })
  })

  describe('@ detection and search', () => {
    it('should trigger search when typing @query', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')

      // Simulate typing @ followed by query
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      // Search should be triggered
      await waitFor(() => {
        expect(specsApi.getAll).toHaveBeenCalled()
        expect(issuesApi.getAll).toHaveBeenCalled()
      }, { timeout: 2000 })
    })

    it('should show dropdown with results', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      // Dropdown should appear
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Should show results
      expect(screen.getByText('Test.tsx')).toBeInTheDocument()
      expect(screen.getByText('Test Spec')).toBeInTheDocument()
      expect(screen.getByText('Test Issue')).toBeInTheDocument()
    })

    it('should hide dropdown when space after @', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')

      // Type @ and query
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      // Wait for dropdown
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Add space - dropdown should close
      fireEvent.change(textarea, { target: { value: '@test ', selectionStart: 6 } })

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })
  })

  describe('Keyboard navigation', () => {
    it('should navigate results with ArrowDown', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      }, { timeout: 2000 })

      // First item should already be auto-selected
      await waitFor(() => {
        const options = screen.getAllByRole('option')
        expect(options[0]).toHaveAttribute('aria-selected', 'true')
      })

      // Press arrow down - should move to second item
      fireEvent.keyDown(textarea, { key: 'ArrowDown' })

      await waitFor(() => {
        const options = screen.getAllByRole('option')
        expect(options[1]).toHaveAttribute('aria-selected', 'true')
      })
    })

    it('should close dropdown with Escape', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Press Escape
      fireEvent.keyDown(textarea, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })
  })

  describe('Result selection', () => {
    it('should insert file path when clicking file result', async () => {
      const user = userEvent.setup()
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      await waitFor(() => {
        expect(screen.getByText('Test.tsx')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click file
      await user.click(screen.getByText('Test.tsx'))

      // Value should be updated (@ is preserved for parsing)
      await waitFor(() => {
        expect(textarea).toHaveValue('@src/components/Test.tsx')
      })
    })

    it('should insert [[spec-id]] when clicking spec result', async () => {
      const user = userEvent.setup()
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      await waitFor(() => {
        expect(screen.getByText('Test Spec')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click spec
      await user.click(screen.getByText('Test Spec'))

      // Value should be updated (@ removed, only [[spec-id]] remains)
      await waitFor(() => {
        expect(textarea).toHaveValue('[[s-test1]]')
      })
    })

    it('should insert [[issue-id]] when clicking issue result', async () => {
      const user = userEvent.setup()
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      await waitFor(() => {
        expect(screen.getByText('Test Issue')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click issue
      await user.click(screen.getByText('Test Issue'))

      // Value should be updated (@ removed, only [[issue-id]] remains)
      await waitFor(() => {
        expect(textarea).toHaveValue('[[i-test1]]')
      })
    })

    it('should insert result with Enter key', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      }, { timeout: 2000 })

      // First result should already be auto-selected
      await waitFor(() => {
        const options = screen.getAllByRole('option')
        expect(options[0]).toHaveAttribute('aria-selected', 'true')
      })

      // Press Enter to select the first result
      fireEvent.keyDown(textarea, { key: 'Enter' })

      // Dropdown should close and value updated
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(textarea).not.toHaveValue('@test')
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle @ at beginning of text', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } })

      // Should trigger search with empty query (shows "No results found")
      await waitFor(() => {
        expect(screen.getByText('No results found')).toBeInTheDocument()
      }, { timeout: 2000 })
    })

    it('should not show dropdown when disabled', () => {
      render(<ControlledTextarea projectId="test-project" disabled />)

      const textarea = screen.getByRole('textbox')

      // Try to change value (will be blocked by disabled)
      fireEvent.change(textarea, { target: { value: '@test', selectionStart: 5 } })

      // No dropdown should appear
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('should not trigger dropdown for email addresses', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      // Type an email address
      fireEvent.change(textarea, { target: { value: 'test@gmail.com', selectionStart: 14 } })

      // Wait a bit to ensure no dropdown appears
      await new Promise(resolve => setTimeout(resolve, 400))

      // No dropdown should appear because @ is not preceded by whitespace
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('should trigger dropdown after whitespace before @', async () => {
      render(<ControlledTextarea projectId="test-project" />)

      const textarea = screen.getByRole('textbox')
      // Type with space before @
      fireEvent.change(textarea, { target: { value: 'hello @test', selectionStart: 11 } })

      // Should show dropdown
      await waitFor(() => {
        expect(screen.getByText('Test.tsx')).toBeInTheDocument()
      }, { timeout: 2000 })
    })
  })
})
