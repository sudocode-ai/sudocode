import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIssue, useIssues, useIssueFeedback } from '@/hooks/useIssues'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import IssuePanel from '@/components/issues/IssuePanel'
import { Button } from '@/components/ui/button'
import { DeleteIssueDialog } from '@/components/issues/DeleteIssueDialog'
import { Archive, ArchiveRestore, Trash2, ArrowLeft } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

const VIEW_MODE_STORAGE_KEY = 'sudocode:details:viewMode'

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const { data: issue, isLoading, isError } = useIssue(id || '')
  const { feedback } = useIssueFeedback(id || '')
  const { issues, updateIssue, deleteIssue, archiveIssue, unarchiveIssue, isUpdating, isDeleting } =
    useIssues()

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })
  const [title, setTitle] = useState('')

  // Update title when issue loads
  useEffect(() => {
    if (issue) {
      setTitle(issue.title)
    }
  }, [issue])

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    // Trigger update
    if (id) {
      updateIssue({ id, data: { title: newTitle } })
    }
  }

  const handleUpdate = (data: Parameters<typeof updateIssue>[0]['data']) => {
    if (!id) return
    updateIssue({ id, data })
  }

  const handleDelete = () => {
    if (!id) return
    deleteIssue(id)
    navigate(paths.issues())
  }

  const handleArchive = (issueId: string) => {
    archiveIssue(issueId)
    navigate(paths.issues())
  }

  const handleUnarchive = (issueId: string) => {
    unarchiveIssue(issueId)
    navigate(paths.issues())
  }

  const handleCopyId = async () => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
      toast.success('ID copied to clipboard', {
        duration: 2000,
      })
    } catch (error) {
      console.error('Failed to copy ID:', error)
      toast.error('Failed to copy ID')
    }
  }

  // Save view mode preference to localStorage
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(viewMode))
  }, [viewMode])

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
          <Button onClick={() => navigate(paths.issues())}>Back to Issues</Button>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-background p-2 sm:p-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(-1)}
                  className="h-8 w-8 flex-shrink-0 p-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Go back</TooltipContent>
            </Tooltip>
            {/* Issue ID Badge */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCopyId}
                  className="flex-shrink-0"
                  type="button"
                >
                  <Badge variant="issue" className="cursor-pointer font-mono hover:opacity-80">
                    {issue.id}
                  </Badge>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isCopied ? 'Copied!' : 'Click to copy ID'}</p>
              </TooltipContent>
            </Tooltip>
            {/* Title */}
            <textarea
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              disabled={isUpdating}
              placeholder="Issue title..."
              rows={1}
              className="min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent px-0 text-lg font-semibold leading-tight shadow-none outline-none focus:ring-0"
              style={{ maxHeight: '2.5em' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 40)}px`
              }}
            />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isUpdating || isDeleting}
                >
                  <Trash2 className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete issue</TooltipContent>
            </Tooltip>
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
            showViewToggleInline={true}
            feedback={feedback}
            issues={issues}
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
    </TooltipProvider>
  )
}
