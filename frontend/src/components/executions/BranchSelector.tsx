import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown, GitBranch, Plus, FolderGit2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import type { Execution } from '@/types/execution'

interface BranchSelectorProps {
  branches: string[]
  value: string
  onChange: (value: string, isNew?: boolean, worktreeId?: string) => void
  disabled?: boolean
  placeholder?: string
  allowCreate?: boolean
  className?: string
  /** Current branch name - shown when creating a new branch ("from X") */
  currentBranch?: string
  /** Optional worktrees to show alongside branches */
  worktrees?: Execution[]
  /** Callback when the selector is opened - use to refresh branch list */
  onOpen?: () => void
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
  worktrees = [],
  onOpen,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showBranches, setShowBranches] = useState(true)
  const [showWorktrees, setShowWorktrees] = useState(true)

  // Filter worktrees to only show .sudocode/worktrees
  const sudocodeWorktrees = useMemo(() => {
    return worktrees.filter((wt) => wt.worktree_path?.includes('.sudocode/worktrees'))
  }, [worktrees])

  // Combine branches with worktree branches
  const allBranches = useMemo(() => {
    const worktreeBranches = sudocodeWorktrees
      .map((wt) => wt.branch_name)
      .filter((branch): branch is string => !!branch)

    // Add worktree branches to the list, removing duplicates
    const combined = [...branches]
    for (const wtBranch of worktreeBranches) {
      if (!combined.includes(wtBranch)) {
        combined.push(wtBranch)
      }
    }
    return combined
  }, [branches, sudocodeWorktrees])

  // Filter branches based on search term
  const filteredBranches = useMemo(() => {
    if (!searchTerm.trim()) {
      return allBranches
    }
    const search = searchTerm.toLowerCase()
    return allBranches.filter((branch) => branch.toLowerCase().includes(search))
  }, [allBranches, searchTerm])

  // Filter worktrees based on search term
  const filteredWorktrees = useMemo(() => {
    if (!searchTerm.trim()) {
      return sudocodeWorktrees
    }
    const search = searchTerm.toLowerCase()
    return sudocodeWorktrees.filter(
      (wt) =>
        wt.branch_name?.toLowerCase().includes(search) || wt.id?.toLowerCase().includes(search)
    )
  }, [sudocodeWorktrees, searchTerm])

  // Check if search term is a valid new branch name (not existing)
  const canCreateNew = useMemo(() => {
    if (!allowCreate || !searchTerm.trim()) return false
    const trimmed = searchTerm.trim()
    // Check if it doesn't already exist (case-insensitive)
    const exists = allBranches.some((b) => b.toLowerCase() === trimmed.toLowerCase())
    // Basic validation for branch name (no spaces, doesn't start with -)
    const isValidName = /^[^\s][^\s]*$/.test(trimmed) && !trimmed.startsWith('-')
    return !exists && isValidName
  }, [allowCreate, searchTerm, allBranches])

  const handleSelect = (branch: string, isNew: boolean = false) => {
    onChange(branch, isNew)
    setOpen(false)
    setSearchTerm('')
  }

  const handleWorktreeSelect = (worktree: Execution) => {
    if (!worktree.branch_name) {
      console.error('Selected worktree has no branch name')
      return
    }
    // Pass worktree ID to indicate we want to reuse this worktree
    onChange(worktree.branch_name, false, worktree.id)
    setOpen(false)
    setSearchTerm('')
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen && onOpen) {
      onOpen()
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
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
          {/* Visibility toggles */}
          {sudocodeWorktrees.length > 0 && (
            <div className="flex items-center gap-3 border-b px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={showBranches}
                  onCheckedChange={(checked) => setShowBranches(checked === true)}
                  className="h-4 w-4"
                />
                <span className="font-medium">branches</span>
              </label>
              {sudocodeWorktrees.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={showWorktrees}
                    onCheckedChange={(checked) => setShowWorktrees(checked === true)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">worktrees</span>
                </label>
              )}
            </div>
          )}
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

            {/* No results */}
            {(showBranches ? filteredBranches.length : 0) === 0 &&
            (showWorktrees ? filteredWorktrees.length : 0) === 0 &&
            !canCreateNew ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {!showBranches && !showWorktrees
                  ? 'Enable branches or worktrees to see results'
                  : 'No branches or worktrees found'}
              </div>
            ) : (
              <>
                {/* Existing branches */}
                {showBranches && filteredBranches.length > 0 && (
                  <>
                    <div className="bg-muted/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Branches
                    </div>
                    {filteredBranches.map((branch) => (
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
                        <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{branch}</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Worktrees */}
                {showWorktrees && filteredWorktrees.length > 0 && (
                  <>
                    <div className="bg-muted/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Worktrees
                    </div>
                    {filteredWorktrees.map((worktree) => (
                      <button
                        key={worktree.id}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                          value === worktree.branch_name && 'bg-accent text-accent-foreground'
                        )}
                        onClick={() => handleWorktreeSelect(worktree)}
                      >
                        <Check
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            value === worktree.branch_name ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <FolderGit2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium">{worktree.branch_name}</span>
                          {worktree.issue_id && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {worktree.issue_id}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
