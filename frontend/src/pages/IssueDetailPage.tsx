import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIssue, useIssues, useIssueFeedback } from '@/hooks/useIssues'
import { useFeedback } from '@/hooks/useFeedback'
import IssuePanel from '@/components/issues/IssuePanel'
import { Button } from '@/components/ui/button'
import { DeleteIssueDialog } from '@/components/issues/DeleteIssueDialog'
import { Archive, ArchiveRestore, Trash2, FileText, Code2 } from 'lucide-react'

const VIEW_MODE_STORAGE_KEY = 'sudocode:details:viewMode'

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: issue, isLoading, isError } = useIssue(id || '')
  const { feedback } = useIssueFeedback(id || '')
  const { updateIssue, deleteIssue, archiveIssue, unarchiveIssue, isUpdating, isDeleting } =
    useIssues()
  const { updateFeedback, deleteFeedback } = useFeedback(id || '')

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [viewMode, setViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })

  const handleUpdate = (data: Parameters<typeof updateIssue>[0]['data']) => {
    if (!id) return
    updateIssue({ id, data })
  }

  const handleDelete = () => {
    if (!id) return
    deleteIssue(id)
    navigate('/issues')
  }

  const handleArchive = (issueId: string) => {
    archiveIssue(issueId)
    navigate('/issues')
  }

  const handleUnarchive = (issueId: string) => {
    unarchiveIssue(issueId)
    navigate('/issues')
  }

  // Save view mode preference to localStorage
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(viewMode))
  }, [viewMode])

  const handleFeedbackDismiss = (feedbackId: string) => {
    const fb = feedback.find((f) => f.id === feedbackId)
    if (fb) {
      updateFeedback({
        id: feedbackId,
        data: { dismissed: !fb.dismissed },
      })
    }
  }

  const handleFeedbackDelete = (feedbackId: string) => {
    deleteFeedback(feedbackId)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-muted-foreground">Loading issue...</p>
        </div>
      </div>
    )
  }

  if (isError || !issue) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <h2 className="mb-2 text-2xl font-bold">Issue not found</h2>
          <p className="mb-4 text-muted-foreground">
            The issue you're looking for doesn't exist or has been deleted.
          </p>
          <Button onClick={() => navigate('/issues')}>Back to Issues</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-2 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/issues')}>
            ← <span className="ml-1 hidden sm:inline">Back to Issues</span>
          </Button>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {/* View mode toggle */}
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-1">
            <Button
              variant={viewMode === 'formatted' ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('formatted')}
              className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <FileText className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Formatted</span>
            </Button>
            <Button
              variant={viewMode === 'markdown' ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('markdown')}
              className={`h-7 rounded-sm ${viewMode === 'markdown' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Code2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Markdown</span>
            </Button>
          </div>

          {issue.archived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUnarchive(issue.id)}
              disabled={isUpdating}
            >
              <ArchiveRestore className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Unarchive</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleArchive(issue.id)}
              disabled={isUpdating}
            >
              <Archive className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Archive</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            disabled={isUpdating || isDeleting}
          >
            <Trash2 className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <IssuePanel
            issue={issue}
            onUpdate={handleUpdate}
            isUpdating={isUpdating}
            isDeleting={isDeleting}
            hideTopControls={true}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showViewToggleInline={false}
            feedback={feedback}
            onDismissFeedback={handleFeedbackDismiss}
            onDeleteFeedback={handleFeedbackDelete}
          />
      </div>

      {/* Delete Dialog */}
      <DeleteIssueDialog
        issue={issue}
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  )
}
