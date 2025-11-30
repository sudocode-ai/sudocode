import { useEffect, useRef } from 'react'
import { File, FileText, Loader2, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ContextSearchResult } from '@/types/api'

interface ContextSearchDropdownProps {
  results: ContextSearchResult[]
  selectedIndex: number
  onSelect: (result: ContextSearchResult) => void
  position?: { top: number; left: number }
  isLoading: boolean
  error: Error | null
  onClose: () => void
}

/**
 * Dropdown component for displaying context search results
 * Supports files, specs, and issues with keyboard navigation
 * Results are displayed in score order (already ranked by the hook)
 */
export function ContextSearchDropdown({
  results,
  selectedIndex,
  onSelect,
  isLoading,
  error,
}: ContextSearchDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auto-scroll selected item into view
  useEffect(() => {
    if (dropdownRef.current && selectedIndex >= 0) {
      const selected = dropdownRef.current.querySelector('[data-selected="true"]')
      if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex])

  // Loading state - only show if we have no results at all
  if (isLoading && results.length === 0) {
    return (
      <div
        ref={dropdownRef}
        className="w-full rounded-md border bg-popover p-4 text-popover-foreground shadow-md"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Searching...</span>
        </div>
      </div>
    )
  }

  // Error state - only show if we have no results
  if (error && results.length === 0) {
    return (
      <div
        ref={dropdownRef}
        className="w-full rounded-md border bg-popover p-4 text-popover-foreground shadow-md"
      >
        <div className="text-sm text-destructive">
          <p className="font-medium">Search error</p>
          <p className="text-xs text-muted-foreground">{error.message}</p>
        </div>
      </div>
    )
  }

  // Empty state - only if not loading and no results
  if (results.length === 0 && !isLoading) {
    return (
      <div
        ref={dropdownRef}
        className="w-full rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
      >
        <div className="text-sm text-muted-foreground">No results found</div>
      </div>
    )
  }

  // Helper to get icon for result type
  const getIcon = (type: ContextSearchResult['type']) => {
    switch (type) {
      case 'file':
        return <File className="h-3 w-3" />
      case 'spec':
        return <FileText className="h-3 w-3" />
      case 'issue':
        return <CircleDot className="h-3 w-3" />
    }
  }

  return (
    <div
      ref={dropdownRef}
      className="max-h-[300px] w-full overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
      role="listbox"
      aria-label="Search results"
    >
      <div className="py-1">
        {results.map((result, index) => (
          <SearchResultItem
            key={result.entityId || result.filePath}
            result={result}
            isSelected={index === selectedIndex}
            onClick={() => onSelect(result)}
            icon={getIcon(result.type)}
            data-selected={index === selectedIndex}
            data-index={index}
          />
        ))}
      </div>
    </div>
  )
}

interface SearchResultItemProps {
  result: ContextSearchResult
  isSelected: boolean
  onClick: () => void
  icon: React.ReactNode
  'data-selected'?: boolean
  'data-index'?: number
}

/**
 * Individual search result item
 */
function SearchResultItem({
  result,
  isSelected,
  onClick,
  icon,
  'data-selected': dataSelected,
  'data-index': dataIndex,
}: SearchResultItemProps) {
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
      onClick={onClick}
      role="option"
      aria-selected={isSelected}
      data-selected={dataSelected}
      data-index={dataIndex}
    >
      <div className="flex flex-shrink-0 items-center text-muted-foreground">{icon}</div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm leading-tight">{result.displayText}</span>
        {result.secondaryText && (
          <span className="truncate text-xs leading-tight text-muted-foreground">
            {result.secondaryText}
          </span>
        )}
      </div>
    </div>
  )
}
