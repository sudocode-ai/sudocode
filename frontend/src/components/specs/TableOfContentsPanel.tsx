import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ChevronLeft, Plus, Minus, ArrowLeft } from 'lucide-react'
import type { TocItem } from './TiptapEditor'

const TOC_EXPANDED_STORAGE_KEY = 'sudocode:specs:tocExpanded'

interface TableOfContentsPanelProps {
  items: TocItem[]
  onItemClick: (id: string) => void
  onCollapse?: () => void
  className?: string
}

/**
 * Table of Contents panel for navigating spec headings.
 * Displays a hierarchical list of headings with expand/collapse all functionality.
 */
export function TableOfContentsPanel({
  items,
  onItemClick,
  onCollapse,
  className = '',
}: TableOfContentsPanelProps) {
  // Simple boolean: true = show all, false = show only top levels (h1, h2)
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(TOC_EXPANDED_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : true
  })

  // Persist expanded state to localStorage
  useEffect(() => {
    localStorage.setItem(TOC_EXPANDED_STORAGE_KEY, JSON.stringify(isExpanded))
  }, [isExpanded])

  if (!items || items.length === 0) {
    return (
      <div className={cn('p-4', className)}>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Contents</h3>
        <p className="text-xs text-muted-foreground">No headings found in this spec.</p>
      </div>
    )
  }

  // Filter items based on expanded state
  // When collapsed, show top two levels (h1 and h2)
  const visibleItems = isExpanded ? items : items.filter((item) => item.level <= 2)

  // When collapsed, if the active item is hidden, find the nearest visible parent
  // and mark it as active instead
  const getEffectiveActiveId = (): string | null => {
    const activeItem = items.find((item) => item.isActive)
    if (!activeItem) return null

    // If we're expanded or the active item is visible, use it directly
    if (isExpanded || activeItem.level <= 2) {
      return activeItem.id
    }

    // Find the nearest visible ancestor (h1 or h2 that comes before this item)
    const activeIndex = items.indexOf(activeItem)
    for (let i = activeIndex - 1; i >= 0; i--) {
      if (items[i].level <= 2) {
        return items[i].id
      }
    }

    return null
  }

  const effectiveActiveId = getEffectiveActiveId()

  return (
    <div className={cn('p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Contents</h3>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-6 w-6 p-0" onClick={onCollapse}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isExpanded ? 'Top levels only' : 'Expand all'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <nav className="space-y-0">
        {visibleItems.map((item) => {
          const indent = (item.level - 1) * 10

          return (
            <button
              key={item.id}
              onClick={() => onItemClick(item.id)}
              className={cn(
                'w-full truncate rounded-sm px-2 py-1 text-left text-xs transition-colors',
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                item.id === effectiveActiveId && 'bg-accent font-medium text-foreground',
                item.isScrolledOver && item.id !== effectiveActiveId && 'text-muted-foreground/70'
              )}
              style={{ paddingLeft: `${8 + indent}px` }}
            >
              {item.textContent}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
