import { WorktreeCard } from './WorktreeCard'
import { Loader2 } from 'lucide-react'
import type { Execution } from '@/types/execution'

interface WorktreeListProps {
  worktrees: Execution[]
  selectedId?: string
  onSelect: (execution: Execution) => void
  isLoading: boolean
}

export function WorktreeList({ worktrees, selectedId, onSelect, isLoading }: WorktreeListProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading worktrees...</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (worktrees.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md text-center">
          <h3 className="text-lg font-semibold mb-2">No worktrees found</h3>
          <p className="text-sm text-muted-foreground">
            Create an execution with worktree mode to get started.
          </p>
        </div>
      </div>
    )
  }

  // Grid layout
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2 lg:grid-cols-3">
      {worktrees.map((execution) => (
        <WorktreeCard
          key={execution.id}
          execution={execution}
          isSelected={selectedId === execution.id}
          onClick={() => onSelect(execution)}
        />
      ))}
    </div>
  )
}
