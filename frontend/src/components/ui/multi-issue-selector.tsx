import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Issue } from '@/types/api'

interface MultiIssueSelectorProps {
  issues: Issue[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** Set to true when used inside a Dialog/Modal to enable proper scrolling */
  inModal?: boolean
}

export function MultiIssueSelector({
  issues,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select issues...',
  className,
  inModal = false,
}: MultiIssueSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredIssues = useMemo(() => {
    if (!searchTerm.trim()) {
      return issues
    }
    const search = searchTerm.toLowerCase()
    return issues.filter(
      (issue) =>
        issue.id.toLowerCase().includes(search) ||
        issue.title.toLowerCase().includes(search)
    )
  }, [issues, searchTerm])

  const selectedIssues = issues.filter((i) => value.includes(i.id))

  const toggleIssue = (issueId: string) => {
    if (value.includes(issueId)) {
      onChange(value.filter((id) => id !== issueId))
    } else {
      onChange([...value, issueId])
    }
  }

  const removeIssue = (issueId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(value.filter((id) => id !== issueId))
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen} modal={inModal}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal min-h-[40px] h-auto"
            disabled={disabled}
          >
            {selectedIssues.length > 0 ? (
              <span className="text-sm">
                {selectedIssues.length} issue{selectedIssues.length !== 1 ? 's' : ''} selected
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="flex flex-col">
            <div className="border-b p-2">
              <Input
                placeholder="Search issues..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8"
                autoFocus
              />
            </div>
            <div className="max-h-60 overflow-auto">
              {filteredIssues.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No issues found
                </div>
              ) : (
                filteredIssues.map((issue) => {
                  const isSelected = value.includes(issue.id)
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                        isSelected && 'bg-accent/50'
                      )}
                      onClick={() => toggleIssue(issue.id)}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          isSelected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex-1 overflow-hidden">
                        <div className="font-medium">{issue.id}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {issue.title}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Selected issues as badges */}
      {selectedIssues.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIssues.map((issue) => (
            <Badge
              key={issue.id}
              variant="secondary"
              className="gap-1 pr-1"
            >
              <span className="font-medium">{issue.id}</span>
              <button
                type="button"
                onClick={(e) => removeIssue(issue.id, e)}
                className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
