import { useParams, useNavigate } from 'react-router-dom'
import { useIssue, useIssues } from '@/hooks/useIssues'
import IssuePanel from '@/components/issues/IssuePanel'
import { Button } from '@/components/ui/button'

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: issue, isLoading, isError } = useIssue(id || '')
  const { updateIssue, deleteIssue, archiveIssue, unarchiveIssue, isUpdating, isDeleting } = useIssues()

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
      <div className="flex items-center gap-2 border-b bg-background p-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/issues')}>
          ← Back to Issues
        </Button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <IssuePanel
          issue={issue}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          isUpdating={isUpdating}
          isDeleting={isDeleting}
        />
      </div>
    </div>
  )
}
