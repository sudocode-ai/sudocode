import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIssues, useIssueFeedback } from '@/hooks/useIssues'
import { useFeedback } from '@/hooks/useFeedback'
import type { Issue, IssueStatus } from '@/types/api'
import IssueKanbanBoard from '@/components/issues/IssueKanbanBoard'
import IssuePanel from '@/components/issues/IssuePanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Search } from 'lucide-react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

export default function ArchivedIssuesPage() {
  const navigate = useNavigate()
  const {
    issues,
    isLoading,
    isError,
    error,
    updateIssue,
    deleteIssue,
    unarchiveIssue,
    isUpdating,
    isDeleting,
  } = useIssues(true)
  const [selectedIssue, setSelectedIssue] = useState<Issue | undefined>()
  const { feedback } = useIssueFeedback(selectedIssue?.id || '')
  const { updateFeedback, deleteFeedback } = useFeedback(selectedIssue?.id || '')
  const [filterText, setFilterText] = useState('')

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

    filteredIssues.forEach((issue) => {
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
  }, [issues, filterText])

  const handleViewIssueDetails = useCallback((issue: Issue) => {
    setSelectedIssue(issue)
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedIssue(undefined)
  }, [])

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

  const handleUnarchiveIssue = useCallback(
    (id: string) => {
      unarchiveIssue(id)
    },
    [unarchiveIssue]
  )

  const handleFeedbackDismiss = useCallback(
    (feedbackId: string) => {
      const fb = feedback.find((f) => f.id === feedbackId)
      if (fb) {
        updateFeedback({
          id: feedbackId,
          data: { dismissed: !fb.dismissed },
        })
      }
    },
    [feedback, updateFeedback]
  )

  const handleFeedbackDelete = useCallback(
    (feedbackId: string) => {
      deleteFeedback(feedbackId)
    },
    [deleteFeedback]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading archived issues...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-destructive">
          Error loading archived issues: {error?.message || 'Unknown error'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/issues')}
            className="h-8 w-8 p-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Archived Issues</h1>
            <p className="text-sm text-muted-foreground">{issues.length} archived issues</p>
          </div>
        </div>
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
                  localStorage.setItem('archivedIssuesPage.panelSizes', JSON.stringify(layout))
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
                  const saved = localStorage.getItem('archivedIssuesPage.panelSizes')
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
              className="min-w-0 min-h-0 overflow-auto"
            >
              <IssueKanbanBoard
                groupedIssues={groupedIssues}
                onDragEnd={() => {}} // Disable drag-and-drop for archived issues
                onViewIssueDetails={handleViewIssueDetails}
                selectedIssue={selectedIssue}
              />
            </Panel>

            {/* Resize Handle */}
            <PanelResizeHandle className="relative z-30 w-1 bg-border cursor-col-resize group touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border" />
              <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 bg-muted/90 border border-border rounded-full px-1.5 py-3 opacity-70 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-sm">
                <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              </div>
            </PanelResizeHandle>

            {/* Issue Detail Panel */}
            <Panel
              id="details"
              order={2}
              defaultSize={(() => {
                try {
                  const saved = localStorage.getItem('archivedIssuesPage.panelSizes')
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
              className="min-w-0 min-h-0 overflow-hidden border-l bg-background shadow-lg"
            >
              <IssuePanel
                issue={selectedIssue}
                onClose={handleClosePanel}
                onUpdate={handleUpdateIssue}
                onDelete={handleDeleteIssue}
                onUnarchive={handleUnarchiveIssue}
                isUpdating={isUpdating}
                isDeleting={isDeleting}
                feedback={feedback}
                onDismissFeedback={handleFeedbackDismiss}
                onDeleteFeedback={handleFeedbackDelete}
              />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex-1 overflow-auto">
            <IssueKanbanBoard
              groupedIssues={groupedIssues}
              onDragEnd={() => {}} // Disable drag-and-drop for archived issues
              onViewIssueDetails={handleViewIssueDetails}
              selectedIssue={selectedIssue}
            />
          </div>
        )}
      </div>
    </div>
  )
}
