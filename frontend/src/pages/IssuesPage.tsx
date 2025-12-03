import { useMemo, useState, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIssues, useUpdateIssueStatus, useIssueFeedback } from '@/hooks/useIssues'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { useProject } from '@/hooks/useProject'
import { useProjectById } from '@/hooks/useProjects'
import { useWorkflows } from '@/hooks/useWorkflows'
import { executionsApi } from '@/lib/api'
import type { Issue, IssueStatus } from '@/types/api'
import type { Execution } from '@/types/execution'
import type { DragEndEvent } from '@/components/ui/kanban'
import type { WorkflowStepStatus } from '@/types/workflow'
import IssueKanbanBoard from '@/components/issues/IssueKanbanBoard'
import IssuePanel from '@/components/issues/IssuePanel'
import { CreateIssueDialog } from '@/components/issues/CreateIssueDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Archive, Search, GitBranch } from 'lucide-react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

type SortOption = 'priority' | 'newest' | 'last-updated'

const SORT_STORAGE_KEY = 'sudocode:issues:sortOption'

export default function IssuesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    issues,
    isLoading,
    isError,
    error,
    createIssueAsync,
    updateIssue,
    deleteIssue,
    archiveIssue,
    unarchiveIssue,
    isCreating,
    isUpdating,
    isDeleting,
  } = useIssues()
  const updateStatus = useUpdateIssueStatus()
  const { data: repoInfo } = useRepositoryInfo()
  const { currentProjectId } = useProject()
  const { data: currentProject } = useProjectById(currentProjectId)
  const { workflows } = useWorkflows()
  const [selectedIssue, setSelectedIssue] = useState<Issue | undefined>()
  const { feedback } = useIssueFeedback(selectedIssue?.id || '')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createDialogStatus, setCreateDialogStatus] = useState<IssueStatus | undefined>()
  const [showArchiveAllDialog, setShowArchiveAllDialog] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    // Initialize from localStorage if available
    try {
      const stored = localStorage.getItem(SORT_STORAGE_KEY)
      if (stored && ['priority', 'newest', 'last-updated'].includes(stored)) {
        return stored as SortOption
      }
    } catch (error) {
      console.error('Failed to load sort preference from localStorage:', error)
    }
    return 'priority'
  })

  // Collapsed columns state with localStorage persistence
  const [collapsedColumns, setCollapsedColumns] = useState<Set<IssueStatus>>(() => {
    try {
      const saved = localStorage.getItem('issuesPage.collapsedColumns')
      if (saved) {
        const parsed = JSON.parse(saved)
        return new Set(parsed)
      }
    } catch {
      // Ignore errors
    }
    return new Set()
  })

  // Fetch recent executions (last 24h) and running executions for kanban preview
  // Instead of querying by issue IDs, we fetch recent/active executions and map them back
  const queryClient = useQueryClient()
  const { connected, subscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  const since24h = useMemo(() => {
    const date = new Date()
    date.setHours(date.getHours() - 24)
    return date.toISOString()
  }, [])

  // Query key follows pattern ['executions', projectId, ...] for consistent invalidation
  const recentExecutionsQueryKey = ['executions', currentProjectId, 'recent', since24h]

  const { data: recentExecutionsData } = useQuery({
    queryKey: recentExecutionsQueryKey,
    queryFn: () =>
      executionsApi.listAll({
        since: since24h,
        includeRunning: true,
        limit: 500, // Reasonable limit for recent executions
        sortBy: 'created_at',
        order: 'desc',
      }),
    enabled: !!currentProjectId,
    staleTime: 30000, // Consider data fresh for 30 seconds
  })

  // Subscribe to WebSocket execution events and invalidate query on updates
  useEffect(() => {
    const handlerId = 'IssuesPage-executions'

    addMessageHandler(handlerId, (message) => {
      if (
        message.type === 'execution_created' ||
        message.type === 'execution_updated' ||
        message.type === 'execution_status_changed'
      ) {
        // Invalidate recent executions query to refetch
        queryClient.invalidateQueries({ queryKey: ['executions', currentProjectId] })
      }
    })

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
    }
  }, [connected, subscribe, addMessageHandler, removeMessageHandler, queryClient, currentProjectId])

  // Map executions by issue ID, keeping only the latest execution per issue
  const latestExecutions = useMemo(() => {
    if (!recentExecutionsData?.executions) return undefined

    const byIssueId: Record<string, Execution | null> = {}
    for (const execution of recentExecutionsData.executions) {
      if (execution.issue_id && !byIssueId[execution.issue_id]) {
        // Since results are sorted by created_at desc, first one is the latest
        byIssueId[execution.issue_id] = execution
      }
    }
    return byIssueId
  }, [recentExecutionsData?.executions])

  // Map issue IDs to workflow info for issues in active workflows
  const issueWorkflows = useMemo(() => {
    const map = new Map<
      string,
      { workflowId: string; workflowTitle?: string; stepStatus: WorkflowStepStatus }
    >()

    // Only process active workflows (running or paused)
    const activeWorkflows = workflows.filter((w) =>
      ['running', 'paused'].includes(w.status)
    )

    for (const workflow of activeWorkflows) {
      for (const step of workflow.steps) {
        // Map the issue ID to its workflow info
        map.set(step.issueId, {
          workflowId: workflow.id,
          workflowTitle: workflow.title,
          stepStatus: step.status,
        })
      }
    }

    return map
  }, [workflows])

  // Track if we've initialized from URL hash yet
  const [hasInitializedFromUrl, setHasInitializedFromUrl] = useState(false)

  // Initialize selected issue from URL hash on mount
  useEffect(() => {
    if (!issues.length || hasInitializedFromUrl) return

    const hash = location.hash
    if (hash && hash.startsWith('#') && hash.length > 1) {
      const issueId = hash.substring(1) // Remove the '#'
      const issue = issues.find((i) => i.id === issueId)
      if (issue) {
        setSelectedIssue(issue)
      }
    }
    setHasInitializedFromUrl(true)
    // Only run once when issues are loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.length > 0])

  // Update URL hash when selected issue changes (but only after initialization)
  useEffect(() => {
    if (!hasInitializedFromUrl) return

    if (selectedIssue) {
      // Update the hash without adding to history
      if (location.hash !== `#${selectedIssue.id}`) {
        navigate(`#${selectedIssue.id}`, { replace: true })
      }
    } else {
      // Clear the hash when no issue is selected
      if (location.hash && location.hash !== '#') {
        navigate('#', { replace: true })
      }
    }
  }, [selectedIssue, navigate, location.hash, hasInitializedFromUrl])

  // Save sort preference to localStorage when it changes
  const handleSortChange = useCallback((value: string) => {
    const newSortOption = value as SortOption
    setSortOption(newSortOption)
    try {
      localStorage.setItem(SORT_STORAGE_KEY, newSortOption)
    } catch (error) {
      console.error('Failed to save sort preference to localStorage:', error)
    }
  }, [])

  // Group issues by status
  const groupedIssues = useMemo(() => {
    // Filter issues based on search text
    const filteredIssues = filterText
      ? issues.filter((issue) => {
          const searchText = filterText.toLowerCase()
          return (
            issue.title.toLowerCase().includes(searchText) ||
            (issue.content && issue.content.toLowerCase().includes(searchText))
          )
        })
      : issues

    const groups: Record<IssueStatus, Issue[]> = {
      open: [],
      in_progress: [],
      blocked: [],
      needs_review: [],
      closed: [],
    }

    // Trust the issue status from the backend (now automatically managed)
    filteredIssues.forEach((issue) => {
      const status = issue.status.toLowerCase() as IssueStatus
      if (groups[status]) {
        groups[status].push(issue)
      } else {
        // Default to open if status is unknown
        groups.open.push(issue)
      }
    })

    // Sort each group based on the selected sort option
    Object.keys(groups).forEach((status) => {
      const statusKey = status as IssueStatus

      groups[statusKey].sort((a, b) => {
        switch (sortOption) {
          case 'priority':
            // Sort by priority (low to high, 0 is P0) then by created_at descending (newest first)
            if (a.priority !== b.priority) {
              return a.priority - b.priority
            }
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

          case 'newest':
            // Sort by created_at descending
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

          case 'last-updated':
            // Sort by updated_at descending
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()

          default:
            return 0
        }
      })
    })

    return groups
  }, [issues, filterText, sortOption])

  // Handle drag-and-drop to change status
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || !active.data.current) return

      const draggedIssueId = active.id as string
      const newStatus = over.id as IssueStatus
      const issue = issues.find((i) => i.id === draggedIssueId)

      if (!issue || issue.status === newStatus) return

      // Update issue status via API with optimistic update
      updateStatus.mutate({ id: draggedIssueId, status: newStatus })
    },
    [issues, updateStatus]
  )

  const handleViewIssueDetails = useCallback((issue: Issue) => {
    setSelectedIssue(issue)
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedIssue(undefined)
  }, [])

  const handleCreateIssue = useCallback((status?: IssueStatus) => {
    setCreateDialogStatus(status)
    setShowCreateDialog(true)
  }, [])

  const handleCreateSubmit = useCallback(
    async (data: Partial<Issue>) => {
      try {
        await createIssueAsync(data as Omit<Issue, 'id' | 'created_at' | 'updated_at'>)
        setShowCreateDialog(false)
        setCreateDialogStatus(undefined)
      } catch (error) {
        console.error('Failed to create issue:', error)
      }
    },
    [createIssueAsync]
  )

  const handleUpdateIssue = useCallback(
    (data: Partial<Issue>) => {
      if (!selectedIssue) return
      updateIssue({ id: selectedIssue.id, data })
    },
    [selectedIssue, updateIssue]
  )

  const handleDeleteIssue = useCallback(() => {
    if (!selectedIssue) return
    deleteIssue(selectedIssue.id)
    setSelectedIssue(undefined)
  }, [selectedIssue, deleteIssue])

  const handleArchiveIssue = useCallback(
    (id: string) => {
      archiveIssue(id)
    },
    [archiveIssue]
  )

  const handleUnarchiveIssue = useCallback(
    (id: string) => {
      unarchiveIssue(id)
    },
    [unarchiveIssue]
  )

  const handleArchiveAllClosed = useCallback(() => {
    setShowArchiveAllDialog(true)
  }, [])

  const confirmArchiveAllClosed = useCallback(() => {
    const closedIssues = groupedIssues.closed || []
    closedIssues.forEach((issue) => {
      archiveIssue(issue.id)
    })
    setShowArchiveAllDialog(false)
  }, [groupedIssues.closed, archiveIssue])

  const handleToggleColumnCollapse = useCallback((status: IssueStatus) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      // Persist to localStorage
      try {
        localStorage.setItem('issuesPage.collapsedColumns', JSON.stringify(Array.from(next)))
      } catch {
        // Ignore errors
      }
      return next
    })
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading issues...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-destructive">
          Error loading issues: {error?.message || 'Unknown error'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Issues</h1>
            <Badge variant="secondary">{issues.length}</Badge>
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
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Filter issues..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-9 w-64 pl-8"
            />
          </div>
          <Select value={sortOption} onValueChange={handleSortChange}>
            <SelectTrigger className="h-9 w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="last-updated">Updated</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => navigate('/issues/archived')}
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <Archive className="h-4 w-4" />
            Archived
          </Button>
          <Button
            onClick={() => handleCreateIssue()}
            variant="default"
            size="sm"
            className="text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Issue
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {selectedIssue ? (
          <PanelGroup
            direction="horizontal"
            className="h-full min-h-0"
            onLayout={(layout) => {
              if (layout.length === 2) {
                try {
                  localStorage.setItem('issuesPage.panelSizes', JSON.stringify(layout))
                } catch {
                  // Ignore errors
                }
              }
            }}
          >
            {/* Kanban Board Panel */}
            <Panel
              id="kanban"
              order={1}
              defaultSize={(() => {
                try {
                  const saved = localStorage.getItem('issuesPage.panelSizes')
                  if (saved) {
                    const parsed = JSON.parse(saved)
                    if (Array.isArray(parsed) && parsed.length === 2) {
                      return parsed[0]
                    }
                  }
                } catch {
                  // Ignore errors
                }
                return 66
              })()}
              minSize={30}
              className="min-h-0 min-w-0 overflow-auto"
            >
              <IssueKanbanBoard
                groupedIssues={groupedIssues}
                onDragEnd={handleDragEnd}
                onViewIssueDetails={handleViewIssueDetails}
                selectedIssue={selectedIssue}
                onArchiveAllClosed={handleArchiveAllClosed}
                collapsedColumns={collapsedColumns}
                onToggleColumnCollapse={handleToggleColumnCollapse}
                latestExecutions={latestExecutions}
                issueWorkflows={issueWorkflows}
              />
            </Panel>

            {/* Resize Handle */}
            <PanelResizeHandle className="group relative z-30 w-1 cursor-col-resize touch-none bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-full border border-border bg-muted/90 px-1.5 py-3 opacity-70 shadow-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                <span className="h-1 w-1 rounded-full bg-muted-foreground" />
              </div>
            </PanelResizeHandle>

            {/* Issue Detail Panel */}
            <Panel
              id="details"
              order={2}
              defaultSize={(() => {
                try {
                  const saved = localStorage.getItem('issuesPage.panelSizes')
                  if (saved) {
                    const parsed = JSON.parse(saved)
                    if (Array.isArray(parsed) && parsed.length === 2) {
                      return parsed[1]
                    }
                  }
                } catch {
                  // Ignore errors
                }
                return 34
              })()}
              minSize={20}
              className="min-h-0 min-w-0 overflow-hidden border-l bg-background shadow-lg"
            >
              <IssuePanel
                issue={selectedIssue}
                onClose={handleClosePanel}
                onUpdate={handleUpdateIssue}
                onDelete={handleDeleteIssue}
                onArchive={handleArchiveIssue}
                onUnarchive={handleUnarchiveIssue}
                isUpdating={isUpdating}
                isDeleting={isDeleting}
                showOpenDetail={true}
                feedback={feedback}
                autoFocusAgentConfig
              />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex-1 overflow-auto">
            <IssueKanbanBoard
              groupedIssues={groupedIssues}
              onDragEnd={handleDragEnd}
              onViewIssueDetails={handleViewIssueDetails}
              selectedIssue={selectedIssue}
              onArchiveAllClosed={handleArchiveAllClosed}
              collapsedColumns={collapsedColumns}
              onToggleColumnCollapse={handleToggleColumnCollapse}
              latestExecutions={latestExecutions}
              issueWorkflows={issueWorkflows}
            />
          </div>
        )}
      </div>

      <CreateIssueDialog
        isOpen={showCreateDialog}
        onClose={() => {
          setShowCreateDialog(false)
          setCreateDialogStatus(undefined)
        }}
        onCreate={handleCreateSubmit}
        isCreating={isCreating}
        defaultStatus={createDialogStatus}
      />

      <AlertDialog open={showArchiveAllDialog} onOpenChange={setShowArchiveAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive All Closed Issues?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive all {groupedIssues.closed?.length || 0} closed issues. You can view
              archived issues later from the Archived Issues page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchiveAllClosed}>Archive All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
