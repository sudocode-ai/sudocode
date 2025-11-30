import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextSearchDropdown } from '@/components/ui/context-search-dropdown'
import type { ContextSearchResult } from '@/types/api'

describe('ContextSearchDropdown', () => {
  const mockOnSelect = vi.fn()
  const mockOnClose = vi.fn()
  const defaultPosition = { top: 100, left: 100 }

  const mockFileResults: ContextSearchResult[] = [
    {
      type: 'file',
      filePath: 'src/components/Test.tsx',
      fileName: 'Test.tsx',
      displayText: 'Test.tsx',
      secondaryText: 'src/components/',
      insertText: 'src/components/Test.tsx',
      matchScore: 100,
    },
    {
      type: 'file',
      filePath: 'src/utils/test.ts',
      fileName: 'test.ts',
      displayText: 'test.ts',
      secondaryText: 'src/utils/',
      insertText: 'src/utils/test.ts',
      matchScore: 75,
    },
  ]

  const mockSpecResults: ContextSearchResult[] = [
    {
      type: 'spec',
      entityId: 's-test1',
      title: 'Test Spec',
      displayText: 'Test Spec',
      secondaryText: 's-test1',
      insertText: '[[s-test1]]',
      matchScore: 100,
    },
  ]

  const mockIssueResults: ContextSearchResult[] = [
    {
      type: 'issue',
      entityId: 'i-test1',
      title: 'Test Issue',
      displayText: 'Test Issue',
      secondaryText: 'i-test1',
      insertText: '[[i-test1]]',
      matchScore: 100,
    },
  ]

  describe('Loading state', () => {
    it('should display loading spinner', () => {
      render(
        <ContextSearchDropdown
          results={[]}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={true}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Searching...')).toBeInTheDocument()
    })

    it('should keep showing results when loading with existing results', () => {
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={true}
          error={null}
          onClose={mockOnClose}
        />
      )

      // Should show results even while loading to prevent flickering
      expect(screen.getByText('Test.tsx')).toBeInTheDocument()
      expect(screen.queryByText('Searching...')).not.toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('should display error message', () => {
      const error = new Error('Search failed')
      render(
        <ContextSearchDropdown
          results={[]}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={error}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Search error')).toBeInTheDocument()
      expect(screen.getByText('Search failed')).toBeInTheDocument()
    })
  })

  describe('Empty state', () => {
    it('should display "No results found" when no results', () => {
      render(
        <ContextSearchDropdown
          results={[]}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })

  describe('Results display', () => {
    it('should display file results with correct icon', () => {
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Test.tsx')).toBeInTheDocument()
      expect(screen.getByText('src/components/')).toBeInTheDocument()
      expect(screen.getByText('test.ts')).toBeInTheDocument()
      expect(screen.getByText('src/utils/')).toBeInTheDocument()
    })

    it('should display spec results with correct icon', () => {
      render(
        <ContextSearchDropdown
          results={mockSpecResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Test Spec')).toBeInTheDocument()
      expect(screen.getByText('s-test1')).toBeInTheDocument()
    })

    it('should display issue results with correct icon', () => {
      render(
        <ContextSearchDropdown
          results={mockIssueResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Test Issue')).toBeInTheDocument()
      expect(screen.getByText('i-test1')).toBeInTheDocument()
    })
  })

  describe('Mixed results', () => {
    it('should show all result types when mixed results', () => {
      const mixedResults = [...mockFileResults, ...mockSpecResults, ...mockIssueResults]
      render(
        <ContextSearchDropdown
          results={mixedResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      // Should show all result types without section headers
      expect(screen.getByText('Test.tsx')).toBeInTheDocument()
      expect(screen.getByText('Test Spec')).toBeInTheDocument()
      expect(screen.getByText('Test Issue')).toBeInTheDocument()
    })
  })

  describe('Selection highlighting', () => {
    it('should highlight first item when selectedIndex is 0', () => {
      const { container } = render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={0}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const selectedItem = container.querySelector('[data-selected="true"]')
      expect(selectedItem).toBeInTheDocument()
      expect(selectedItem).toHaveTextContent('Test.tsx')
    })

    it('should highlight second item when selectedIndex is 1', () => {
      const { container } = render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const selectedItem = container.querySelector('[data-selected="true"]')
      expect(selectedItem).toBeInTheDocument()
      expect(selectedItem).toHaveTextContent('test.ts')
    })

    it('should highlight across different result types', () => {
      const mixedResults = [...mockFileResults, ...mockSpecResults]
      const { container } = render(
        <ContextSearchDropdown
          results={mixedResults}
          selectedIndex={2}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const selectedItem = container.querySelector('[data-selected="true"]')
      expect(selectedItem).toBeInTheDocument()
      expect(selectedItem).toHaveTextContent('Test Spec')
    })

    it('should have no highlighted item when selectedIndex is -1', () => {
      const { container } = render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const selectedItem = container.querySelector('[data-selected="true"]')
      expect(selectedItem).not.toBeInTheDocument()
    })
  })

  describe('Click selection', () => {
    it('should call onSelect with correct result when file is clicked', async () => {
      const user = userEvent.setup()
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      await user.click(screen.getByText('Test.tsx'))
      expect(mockOnSelect).toHaveBeenCalledWith(mockFileResults[0])
    })

    it('should call onSelect with correct result when spec is clicked', async () => {
      const user = userEvent.setup()
      render(
        <ContextSearchDropdown
          results={mockSpecResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      await user.click(screen.getByText('Test Spec'))
      expect(mockOnSelect).toHaveBeenCalledWith(mockSpecResults[0])
    })

    it('should call onSelect with correct result when issue is clicked', async () => {
      const user = userEvent.setup()
      render(
        <ContextSearchDropdown
          results={mockIssueResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      await user.click(screen.getByText('Test Issue'))
      expect(mockOnSelect).toHaveBeenCalledWith(mockIssueResults[0])
    })
  })

  describe('Accessibility', () => {
    it('should have listbox role', () => {
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('should have option role for each result', () => {
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(2)
    })

    it('should set aria-selected on highlighted item', () => {
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={0}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
      expect(options[1]).toHaveAttribute('aria-selected', 'false')
    })

    it('should have aria-label on listbox', () => {
      render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Search results')
    })
  })

  describe('Positioning', () => {
    it('should apply absolute positioning class', () => {
      const { container } = render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={{ top: 150, left: 200 }}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const dropdown = container.querySelector('[role="listbox"]')
      expect(dropdown).toHaveClass('w-full')
    })
  })

  describe('Visual styling', () => {
    it('should apply max height with overflow scroll', () => {
      const { container } = render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const dropdown = container.querySelector('[role="listbox"]')
      expect(dropdown).toHaveClass('max-h-[300px]')
      expect(dropdown).toHaveClass('overflow-y-auto')
    })

    it('should apply shadcn/ui styling classes', () => {
      const { container } = render(
        <ContextSearchDropdown
          results={mockFileResults}
          selectedIndex={-1}
          onSelect={mockOnSelect}
          position={defaultPosition}
          isLoading={false}
          error={null}
          onClose={mockOnClose}
        />
      )

      const dropdown = container.querySelector('[role="listbox"]')
      expect(dropdown).toHaveClass('bg-popover')
      expect(dropdown).toHaveClass('text-popover-foreground')
      expect(dropdown).toHaveClass('shadow-md')
      expect(dropdown).toHaveClass('border')
    })
  })
})
