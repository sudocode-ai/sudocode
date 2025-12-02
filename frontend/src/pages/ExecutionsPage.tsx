import { useState, useEffect, useCallback, useRef } from 'react'
import { PanelGroup, Panel, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels'
import {
  Minus,
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ExecutionsSidebar } from '@/components/executions/ExecutionsSidebar'
import { ExecutionsGrid } from '@/components/executions/ExecutionsGrid'
import { useExecutions } from '@/hooks/useExecutions'
import type { ExecutionStatus } from '@/types/execution'

const GRID_COLUMNS_STORAGE_KEY = 'sudocode:executions:gridColumns'
const GRID_ROWS_STORAGE_KEY = 'sudocode:executions:gridRows'

// Column and row limits
const MIN_COLUMNS = 1
const MAX_COLUMNS = 5
const MIN_ROWS = 1
const MAX_ROWS = 3

// All possible execution statuses
const ALL_STATUSES: ExecutionStatus[] = ['running', 'completed', 'failed', 'cancelled', 'stopped']

/**
 * ExecutionsPage Component
 *
 * Multi-execution chain monitoring page with:
 * - Resizable sidebar (ExecutionsSidebar) for execution chain selection and filtering
 * - Grid view (ExecutionsGrid) displaying execution chains (root + follow-ups)
 * - Pagination with keyboard navigation
 * - localStorage persistence for grid configuration
 */
export default function ExecutionsPage() {
  // Fetch all root executions (displayed as chains with follow-ups) using React Query hook
  const { data: executionsData, isLoading, error, refetch } = useExecutions()

  // Sidebar panel ref for programmatic control
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Grid columns (1-5, persisted to localStorage)
  const [columns, setColumns] = useState<number>(() => {
    const saved = localStorage.getItem(GRID_COLUMNS_STORAGE_KEY)
    const parsed = saved ? parseInt(saved, 10) : 3
    return parsed >= MIN_COLUMNS && parsed <= MAX_COLUMNS ? parsed : 3
  })

  // Grid rows (1-3, persisted to localStorage)
  const [rows, setRows] = useState<number>(() => {
    const saved = localStorage.getItem(GRID_ROWS_STORAGE_KEY)
    const parsed = saved ? parseInt(saved, 10) : 2
    return parsed >= MIN_ROWS && parsed <= MAX_ROWS ? parsed : 2
  })

  // Status filters (Set for O(1) lookup)
  const [statusFilters, setStatusFilters] = useState<Set<ExecutionStatus>>(new Set())

  // Visible execution IDs (Set for O(1) lookup)
  // Default: show all executions
  const [visibleExecutionIds, setVisibleExecutionIds] = useState<Set<string>>(() => {
    const executions = executionsData?.executions || []
    return new Set(executions.map((e) => e.id))
  })

  // Pagination state
  const [currentPage, setCurrentPage] = useState(0)

  // Update visible executions when data loads
  useEffect(() => {
    if (executionsData?.executions && visibleExecutionIds.size === 0) {
      setVisibleExecutionIds(new Set(executionsData.executions.map((e) => e.id)))
    }
  }, [executionsData, visibleExecutionIds.size])

  // Persist grid configuration to localStorage
  useEffect(() => {
    localStorage.setItem(GRID_COLUMNS_STORAGE_KEY, columns.toString())
  }, [columns])

  useEffect(() => {
    localStorage.setItem(GRID_ROWS_STORAGE_KEY, rows.toString())
  }, [rows])

  // Toggle execution visibility
  const handleToggleVisibility = useCallback((executionId: string) => {
    setVisibleExecutionIds((prev) => {
      const next = new Set(prev)
      if (next.has(executionId)) {
        next.delete(executionId)
      } else {
        next.add(executionId)
      }
      return next
    })
    // Reset to first page when toggling visibility
    setCurrentPage(0)
  }, [])

  // Delete execution (placeholder - not implemented yet)
  const handleDeleteExecution = useCallback((executionId: string) => {
    console.log('Delete execution:', executionId)
    // TODO: Implement execution deletion via API
  }, [])

  // Handle status filter toggle
  const handleStatusToggle = useCallback(
    (status: ExecutionStatus) => {
      const newFilters = new Set(statusFilters)
      if (newFilters.has(status)) {
        newFilters.delete(status)
      } else {
        newFilters.add(status)
      }
      setStatusFilters(newFilters)
    },
    [statusFilters]
  )

  // Toggle all executions (show/hide all) - respects status filters
  const handleToggleAll = useCallback(() => {
    const executions = executionsData?.executions || []
    // Apply status filter
    const filteredExecutions =
      statusFilters.size === 0 ? executions : executions.filter((e) => statusFilters.has(e.status))

    const allVisible = filteredExecutions.every((e) => visibleExecutionIds.has(e.id))

    if (allVisible) {
      // If all filtered executions are visible, hide them all
      const idsToRemove = new Set(filteredExecutions.map((e) => e.id))
      setVisibleExecutionIds((prev) => {
        const next = new Set(prev)
        idsToRemove.forEach((id) => next.delete(id))
        return next
      })
    } else {
      // If not all filtered executions are visible, show them all
      setVisibleExecutionIds((prev) => {
        const next = new Set(prev)
        filteredExecutions.forEach((e) => next.add(e.id))
        return next
      })
    }
    setCurrentPage(0)
  }, [executionsData, visibleExecutionIds, statusFilters])

  // Calculate pagination
  const executions = executionsData?.executions || []

  // Filter by status if filters are applied
  const filteredExecutions =
    statusFilters.size === 0 ? executions : executions.filter((e) => statusFilters.has(e.status))

  // Filter by visibility
  const visibleExecutions = filteredExecutions.filter((e) => visibleExecutionIds.has(e.id))
  const executionsPerPage = columns * rows
  const totalPages = Math.ceil(visibleExecutions.length / executionsPerPage)
  const startIndex = currentPage * executionsPerPage
  const endIndex = Math.min(startIndex + executionsPerPage, visibleExecutions.length)
  const paginatedExecutions = visibleExecutions.slice(startIndex, endIndex)

  // Check if all filtered executions are visible (for checkbox state)
  const allExecutionsVisible =
    filteredExecutions.length > 0 && filteredExecutions.every((e) => visibleExecutionIds.has(e.id))

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(0)
  }, [statusFilters])

  // Keyboard navigation for pagination
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentPage > 0) {
        e.preventDefault()
        setCurrentPage((prev) => prev - 1)
      } else if (e.key === 'ArrowRight' && currentPage < totalPages - 1) {
        e.preventDefault()
        setCurrentPage((prev) => prev + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPage, totalPages])

  // Toggle sidebar collapse
  const handleToggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current
    if (!panel) return

    if (sidebarCollapsed) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [sidebarCollapsed])

  return (
    <div className="flex h-screen flex-col">
      {/* Header with grid configuration and pagination */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Sidebar toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleSidebar}
                  className="h-8 w-8 p-0"
                >
                  {sidebarCollapsed ? (
                    <PanelLeft className="h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div>
            <h1 className="text-xl font-bold">Agent Executions</h1>
          </div>
          {/* Pagination controls */}
          {totalPages > 1 && (
            <div>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
                        disabled={currentPage === 0}
                        className="h-8 w-8 p-0"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Previous page (←)</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <span className="min-w-[80px] text-center text-sm text-muted-foreground">
                  Page {currentPage + 1} of {totalPages}
                </span>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))}
                        disabled={currentPage >= totalPages - 1}
                        className="h-8 w-8 p-0"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Next page (→)</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          )}
        </div>

        {/* Grid configuration and pagination controls */}
        <div className="flex items-center gap-4">
          {/* Status filter dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1">
                <Filter className="h-3.5 w-3.5" />
                Filter
                {statusFilters.size > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {statusFilters.size}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel className="text-xs">Status Filters</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_STATUSES.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={statusFilters.has(status)}
                  onCheckedChange={() => handleStatusToggle(status)}
                  className="text-xs capitalize"
                >
                  {status}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Columns configuration */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Columns:</span>
            <div className="flex items-center gap-1 rounded-md border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setColumns(Math.max(MIN_COLUMNS, columns - 1))}
                disabled={columns <= MIN_COLUMNS}
                className="h-8 w-8 p-0"
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-6 text-center text-sm font-medium">{columns}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setColumns(Math.min(MAX_COLUMNS, columns + 1))}
                disabled={columns >= MAX_COLUMNS}
                className="h-8 w-8 p-0"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Rows configuration */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows:</span>
            <div className="flex items-center gap-1 rounded-md border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows(Math.max(MIN_ROWS, rows - 1))}
                disabled={rows <= MIN_ROWS}
                className="h-8 w-8 p-0"
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-6 text-center text-sm font-medium">{rows}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows(Math.min(MAX_ROWS, rows + 1))}
                disabled={rows >= MAX_ROWS}
                className="h-8 w-8 p-0"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-lg font-medium text-muted-foreground">Loading executions...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-lg font-medium text-destructive">Failed to load executions</p>
            <p className="mb-4 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
            <Button onClick={() => refetch()}>Retry</Button>
          </div>
        </div>
      )}

      {/* Main content - PanelGroup with sidebar and grid */}
      {!isLoading && !error && (
        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left Panel - ExecutionsSidebar */}
          <Panel
            ref={sidebarPanelRef}
            defaultSize={20}
            minSize={15}
            maxSize={35}
            collapsible={true}
            collapsedSize={0}
            onCollapse={() => setSidebarCollapsed(true)}
            onExpand={() => setSidebarCollapsed(false)}
          >
            <ExecutionsSidebar
              executions={filteredExecutions}
              visibleExecutionIds={visibleExecutionIds}
              onToggleVisibility={handleToggleVisibility}
              allChecked={allExecutionsVisible}
              onToggleAll={handleToggleAll}
              collapsed={sidebarCollapsed}
              onToggleCollapse={handleToggleSidebar}
            />
          </Panel>

          {/* Resize handle */}
          {!sidebarCollapsed && (
            <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary" />
          )}

          {/* Right Panel - ExecutionsGrid */}
          <Panel defaultSize={80} minSize={50}>
            <ExecutionsGrid
              executions={paginatedExecutions}
              columns={columns}
              rows={rows}
              onToggleVisibility={handleToggleVisibility}
              onDeleteExecution={handleDeleteExecution}
            />
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}
