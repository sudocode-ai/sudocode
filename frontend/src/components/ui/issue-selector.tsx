import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Issue } from '@/types/api'

interface IssueSelectorProps {
  issues: Issue[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** Set to true when used inside a Dialog/Modal to enable proper scrolling */
  inModal?: boolean
}

export function IssueSelector({
  issues,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select issue...',
  className,
  inModal = false,
}: IssueSelectorProps) {
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

  const selectedIssue = issues.find((i) => i.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen} modal={inModal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
          disabled={disabled}
        >
          {selectedIssue ? (
            <span className="truncate">
              <span className="font-medium">{selectedIssue.id}</span>
              <span className="text-muted-foreground"> - {selectedIssue.title}</span>
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
              filteredIssues.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    value === issue.id && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => {
                    onChange(issue.id)
                    setOpen(false)
                    setSearchTerm('')
                  }}
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      value === issue.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="flex-1 overflow-hidden">
                    <div className="font-medium">{issue.id}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {issue.title}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
