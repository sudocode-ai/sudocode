import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown, GitBranch, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface BranchSelectorProps {
  branches: string[]
  value: string
  onChange: (value: string, isNew?: boolean) => void
  disabled?: boolean
  placeholder?: string
  allowCreate?: boolean
  className?: string
  /** Current branch name - shown when creating a new branch ("from X") */
  currentBranch?: string
}

export function BranchSelector({
  branches,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select branch...',
  allowCreate = true,
  className,
  currentBranch,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Filter branches based on search term
  const filteredBranches = useMemo(() => {
    if (!searchTerm.trim()) {
      return branches
    }
    const search = searchTerm.toLowerCase()
    return branches.filter((branch) => branch.toLowerCase().includes(search))
  }, [branches, searchTerm])

  // Check if search term is a valid new branch name (not existing)
  const canCreateNew = useMemo(() => {
    if (!allowCreate || !searchTerm.trim()) return false
    const trimmed = searchTerm.trim()
    // Check if it doesn't already exist (case-insensitive)
    const exists = branches.some((b) => b.toLowerCase() === trimmed.toLowerCase())
    // Basic validation for branch name (no spaces, doesn't start with -)
    const isValidName = /^[^\s][^\s]*$/.test(trimmed) && !trimmed.startsWith('-')
    return !exists && isValidName
  }, [allowCreate, searchTerm, branches])

  const handleSelect = (branch: string, isNew: boolean = false) => {
    onChange(branch, isNew)
    setOpen(false)
    setSearchTerm('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn('h-8 justify-between text-xs font-normal', className)}
              disabled={disabled}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <GitBranch className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{value || placeholder}</span>
              </div>
              <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-[300px] break-all">{value}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="flex flex-col">
          <div className="border-b p-2">
            <Input
              placeholder="Search or create branch..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-auto">
            {/* Create new branch option */}
            {canCreateNew && (
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelect(searchTerm.trim(), true)}
              >
                <Plus className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                <span className="truncate">
                  Create <span className="font-medium">"{searchTerm.trim()}"</span>
                  {currentBranch && <span> from "{currentBranch}"</span>}
                </span>
              </button>
            )}

            {/* Existing branches */}
            {filteredBranches.length === 0 && !canCreateNew ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No branches found
              </div>
            ) : (
              filteredBranches.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                    value === branch && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => handleSelect(branch)}
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      value === branch ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{branch}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
