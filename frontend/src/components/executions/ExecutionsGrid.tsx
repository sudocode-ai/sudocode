import { ExecutionChainTile } from './ExecutionChainTile'
import type { Execution } from '@/types/execution'
import { Grid2x2 } from 'lucide-react'

export interface ExecutionsGridProps {
  /**
   * Root executions to display in the grid (will load full chains)
   */
  executions: Execution[]

  /**
   * Number of columns (1-5)
   */
  columns?: number

  /**
   * Number of rows (1-3)
   */
  rows?: number

  /**
   * Callback when user wants to hide an execution chain from the grid
   */
  onToggleVisibility: (executionId: string) => void

  /**
   * Optional callback when user wants to delete an execution chain
   */
  onDeleteExecution?: (executionId: string) => void
}

/**
 * ExecutionsGrid Component
 *
 * Displays multiple execution chains in a fixed CSS Grid layout that fills the viewport.
 * No scrolling - use pagination to navigate between chains.
 * All tiles have uniform width and height.
 */
export function ExecutionsGrid({
  executions,
  columns,
  rows,
  onToggleVisibility,
  onDeleteExecution,
}: ExecutionsGridProps) {
  // Empty state when no execution chains are visible
  if (executions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <Grid2x2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-lg font-medium text-muted-foreground">No execution chains visible</p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Check executions in the sidebar to display them here
          </p>
        </div>
      </div>
    )
  }

  // Use explicit columns/rows if provided, otherwise fall back to defaults
  const actualColumns = columns || 3
  const actualRows = rows || 2

  // Create grid template strings for uniform sizing
  const gridTemplateColumns = `repeat(${actualColumns}, 1fr)`
  const gridTemplateRows = `repeat(${actualRows}, 1fr)`

  return (
    <div className="h-full p-4">
      <div
        className="grid h-full w-full gap-4"
        style={{
          gridTemplateColumns,
          gridTemplateRows,
        }}
      >
        {executions.map((execution) => (
          <div key={execution.id} className="h-full min-h-0 w-full min-w-0">
            <ExecutionChainTile
              executionId={execution.id}
              onToggleVisibility={onToggleVisibility}
              onDelete={onDeleteExecution}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
