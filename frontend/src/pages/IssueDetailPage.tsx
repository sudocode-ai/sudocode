import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIssue, useIssues } from '@/hooks/useIssues'
import IssuePanel from '@/components/issues/IssuePanel'
import { Button } from '@/components/ui/button'
import { DeleteIssueDialog } from '@/components/issues/DeleteIssueDialog'
import { Archive, ArchiveRestore, Trash2, FileText, Code2 } from 'lucide-react'

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: issue, isLoading, isError } = useIssue(id || '')
  const { updateIssue, deleteIssue, archiveIssue, unarchiveIssue, isUpdating, isDeleting } =
    useIssues()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [viewMode, setViewMode] = useState<'formatted' | 'markdown'>('formatted')

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
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/issues')}>
            ← Back to Issues
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="mr-4 flex gap-1 rounded-md border border-border bg-muted/30 p-1">
            <Button
              variant={viewMode === 'formatted' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('formatted')}
              className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <FileText className="mr-2 h-4 w-4" />
              Formatted
            </Button>
            <Button
              variant={viewMode === 'markdown' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('markdown')}
              className={`h-7 rounded-sm ${viewMode === 'markdown' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Code2 className="mr-2 h-4 w-4" />
              Markdown
            </Button>
          </div>
          {issue.archived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUnarchive(issue.id)}
              disabled={isUpdating}
            >
              <ArchiveRestore className="mr-2 h-4 w-4" />
              Unarchive
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleArchive(issue.id)}
              disabled={isUpdating}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            disabled={isUpdating || isDeleting}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <IssuePanel
          issue={issue}
          onUpdate={handleUpdate}
          isUpdating={isUpdating}
          isDeleting={isDeleting}
          hideTopControls={true}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showViewToggleInline={false}
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
