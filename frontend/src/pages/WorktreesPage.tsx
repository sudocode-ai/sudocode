import { useMemo, useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWorktrees } from '@/hooks/useWorktrees'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { useProject } from '@/hooks/useProject'
import { useProjectById } from '@/hooks/useProjects'
import { useExecutionSync } from '@/hooks/useExecutionSync'
import type { Execution } from '@/types/execution'
import { WorktreeList } from '@/components/worktrees/WorktreeList'
import { WorktreeDetailPanel } from '@/components/worktrees/WorktreeDetailPanel'
import { SyncPreviewDialog } from '@/components/executions/SyncPreviewDialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GitBranch, Search } from 'lucide-react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

type SortOption = 'newest' | 'last-updated' | 'status'
type StatusFilter = 'all' | 'active' | 'completed'

const SORT_STORAGE_KEY = 'sudocode:worktrees:sortOption'

export default function WorktreesPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { worktrees, isLoading, isError } = useWorktrees()
  const { data: repoInfo } = useRepositoryInfo()
  const { currentProjectId } = useProject()
  const { data: currentProject } = useProjectById(currentProjectId)
  const [selectedWorktree, setSelectedWorktree] = useState<Execution | undefined>()
  const [filterText, setFilterText] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    // Initialize from localStorage if available
    try {
      const stored = localStorage.getItem(SORT_STORAGE_KEY)
      if (stored && ['newest', 'last-updated', 'status'].includes(stored)) {
        return stored as SortOption
      }
    } catch (error) {
      console.error('Failed to load sort preference from localStorage:', error)
    }
    return 'newest'
  })

  // Track if we've initialized from URL hash yet
  const [hasInitializedFromUrl, setHasInitializedFromUrl] = useState(false)

  // Sync state management for dialogs
  const {
    syncPreview,
    isSyncPreviewOpen,
    performSync,
    setIsSyncPreviewOpen,
    fetchSyncPreview,
    isPreviewing,
  } = useExecutionSync()

  // Handle refresh sync preview
  const handleRefreshSyncPreview = useCallback(() => {
    if (!selectedWorktree) return
    fetchSyncPreview(selectedWorktree.id)
  }, [selectedWorktree, fetchSyncPreview])

  // Initialize selected worktree from URL hash on mount
  useEffect(() => {
    if (!worktrees.length || hasInitializedFromUrl) return

    const hash = location.hash.replace('#', '')
    if (hash) {
      const worktree = worktrees.find((w) => w.id === hash)
      if (worktree) {
        setSelectedWorktree(worktree)
      }
    }
    setHasInitializedFromUrl(true)
  }, [worktrees, location.hash, hasInitializedFromUrl])

  // Update URL hash when selection changes
  useEffect(() => {
    if (!hasInitializedFromUrl) return

    if (selectedWorktree) {
      navigate(`#${selectedWorktree.id}`, { replace: true })
    } else {
      navigate('#', { replace: true })
    }
  }, [selectedWorktree, hasInitializedFromUrl, navigate])

  // Save sort option to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sortOption)
    } catch (error) {
      console.error('Failed to save sort preference to localStorage:', error)
    }
  }, [sortOption])

  // Filter worktrees by search text and status
  const filteredWorktrees = useMemo(() => {
    return worktrees.filter((worktree) => {
      // Filter by search text
      const searchLower = filterText.toLowerCase()
      const matchesSearch =
        filterText === '' ||
        worktree.id.toLowerCase().includes(searchLower) ||
        worktree.branch_name.toLowerCase().includes(searchLower) ||
        worktree.issue_id?.toLowerCase().includes(searchLower)

      // Filter by status
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && ['running', 'paused'].includes(worktree.status)) ||
        (statusFilter === 'completed' && worktree.status === 'completed')

      return matchesSearch && matchesStatus
    })
  }, [worktrees, filterText, statusFilter])

  // Sort filtered worktrees
  const sortedWorktrees = useMemo(() => {
    const items = [...filteredWorktrees]
    switch (sortOption) {
      case 'newest':
        return items.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      case 'last-updated':
        return items.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      case 'status': {
        const statusOrder: Record<string, number> = {
          running: 0,
          paused: 1,
          completed: 2,
          failed: 3,
          cancelled: 4,
          stopped: 5,
        }
        return items.sort((a, b) => {
          const orderA = statusOrder[a.status] ?? 999
          const orderB = statusOrder[b.status] ?? 999
          return orderA - orderB
        })
      }
      default:
        return items
    }
  }, [filteredWorktrees, sortOption])

  const handleSelectWorktree = useCallback((worktree: Execution) => {
    setSelectedWorktree(worktree)
  }, [])

  // Error state
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md text-center">
          <h3 className="mb-2 text-lg font-semibold">Failed to load worktrees</h3>
          <p className="text-sm text-muted-foreground">
            There was an error loading the worktrees. Please try again.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Worktrees</h1>
            <Badge variant="secondary">{sortedWorktrees.length}</Badge>
          </div>
          {(currentProject || repoInfo) && (
            <div className="flex flex-col gap-0.5 pl-3 text-sm">
              {currentProject && (
                <div className="font-medium text-foreground">{currentProject.name}</div>
              )}
              {repoInfo && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">{repoInfo.name}</span>
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>{repoInfo.branch}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search worktrees..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-[200px] pl-8"
            />
          </div>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="last-updated">Last Updated</SelectItem>
              <SelectItem value="status">By Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Content: Resizable Panels */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Left Panel: Worktree List */}
          <Panel defaultSize={66} minSize={30}>
            <div className="h-full overflow-y-auto">
              <WorktreeList
                worktrees={sortedWorktrees}
                selectedId={selectedWorktree?.id}
                onSelect={handleSelectWorktree}
                isLoading={isLoading}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-primary/20" />

          {/* Right Panel: Detail Panel */}
          <Panel defaultSize={34} minSize={25}>
            <div className="h-full border-l">
              <WorktreeDetailPanel execution={selectedWorktree ?? null} />
            </div>
          </Panel>
        </PanelGroup>
      </div>

      {/* Sync Dialogs */}
      {syncPreview && selectedWorktree && (
        <SyncPreviewDialog
          preview={syncPreview}
          isOpen={isSyncPreviewOpen}
          onClose={() => setIsSyncPreviewOpen(false)}
          onConfirmSync={(mode, options) => performSync(selectedWorktree.id, mode, options)}
          onOpenIDE={() => {}}
          isPreviewing={isPreviewing}
          targetBranch={selectedWorktree.target_branch ?? undefined}
          onRefresh={handleRefreshSyncPreview}
        />
      )}
    </div>
  )
}
