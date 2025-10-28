import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIssues, useUpdateIssueStatus } from '@/hooks/useIssues'
import type { Issue, IssueStatus } from '@/types/api'
import type { DragEndEvent } from '@/components/ui/kanban'
import IssueKanbanBoard from '@/components/issues/IssueKanbanBoard'
import IssuePanel from '@/components/issues/IssuePanel'
import { CreateIssueDialog } from '@/components/issues/CreateIssueDialog'
import { Button } from '@/components/ui/button'
import { Plus, Archive } from 'lucide-react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

export default function IssuesPage() {
  const navigate = useNavigate()
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
  const [selectedIssue, setSelectedIssue] = useState<Issue | undefined>()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createDialogStatus, setCreateDialogStatus] = useState<IssueStatus | undefined>()

  // Group issues by status
  const groupedIssues = useMemo(() => {
    const groups: Record<IssueStatus, Issue[]> = {
      open: [],
      in_progress: [],
      blocked: [],
      needs_review: [],
      closed: [],
    }

    issues.forEach((issue) => {
      const status = issue.status.toLowerCase() as IssueStatus
      if (groups[status]) {
        groups[status].push(issue)
      } else {
        // Default to open if status is unknown
        groups.open.push(issue)
      }
    })

    // Sort each group
    Object.keys(groups).forEach((status) => {
      const statusKey = status as IssueStatus
      if (statusKey === 'closed') {
        // Sort closed issues by most recent closed_at date
        groups[statusKey].sort((a, b) => {
          const aDate = a.closed_at ? new Date(a.closed_at).getTime() : 0
          const bDate = b.closed_at ? new Date(b.closed_at).getTime() : 0
          return bDate - aDate // Descending (most recent first)
        })
      } else {
        // Sort other statuses by priority (ascending), then by created_at (ascending)
        groups[statusKey].sort((a, b) => {
          // First compare by priority (0 is highest priority)
          if (a.priority !== b.priority) {
            return a.priority - b.priority
          }
          // If priority is the same, compare by created_at (oldest first)
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
      }
    })

    return groups
  }, [issues])

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
        <div>
          <h1 className="text-2xl font-bold">Issues</h1>
          <p className="text-sm text-muted-foreground">{issues.length} total issues</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/issues/archived')} variant="outline" size="sm">
            <Archive className="mr-2 h-4 w-4" />
            Archived
          </Button>
          <Button onClick={() => handleCreateIssue()} variant="default" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Issue
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
    </div>
  )
}
