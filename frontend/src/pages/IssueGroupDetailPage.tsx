import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIssueGroup } from '@/hooks/useIssueGroups'
import { useIssues } from '@/hooks/useIssues'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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
import { ArrowLeft, GitBranch, Loader2, Plus, X } from 'lucide-react'
import type { Issue } from '@/types/api'

const statusColors = {
  active: 'bg-green-500 dark:bg-green-600',
  paused: 'bg-yellow-500 dark:bg-yellow-600',
  completed: 'bg-blue-500 dark:bg-blue-600',
}

const priorityColors: Record<number, string> = {
  0: 'bg-red-600 dark:bg-red-700',
  1: 'bg-orange-600 dark:bg-orange-700',
  2: 'bg-yellow-600 dark:bg-yellow-700',
  3: 'bg-blue-600 dark:bg-blue-700',
  4: 'bg-gray-600 dark:bg-gray-700',
}

const priorityLabels: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
}

export default function IssueGroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { group, isLoading, isError, error, addIssue, removeIssue, isRemovingIssue } =
    useIssueGroup(id)
  const { issues: allIssues } = useIssues()

  const [selectedIssueId, setSelectedIssueId] = useState<string>('')
  const [removingIssue, setRemovingIssue] = useState<Issue | null>(null)

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600">Error loading group</p>
          <p className="text-sm text-muted-foreground">{error?.message}</p>
          <Button onClick={() => navigate('/groups')} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Groups
          </Button>
        </div>
      </div>
    )
  }

  if (isLoading || !group) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const issueIdsInGroup = new Set(group.issues.map((i) => i.id))
  const availableIssues = allIssues.filter(
    (issue) => !issueIdsInGroup.has(issue.id) && !issue.archived && issue.status !== 'closed'
  )

  const handleAddIssue = () => {
    if (!selectedIssueId || !id) return

    addIssue(
      { groupId: id, data: { issueId: selectedIssueId } },
      {
        onSuccess: () => {
          setSelectedIssueId('')
        },
      }
    )
  }

  const handleRemoveClick = (issue: Issue) => {
    setRemovingIssue(issue)
  }

  const handleRemoveConfirm = () => {
    if (!removingIssue || !id) return

    removeIssue(
      { groupId: id, issueId: removingIssue.id },
      {
        onSuccess: () => {
          setRemovingIssue(null)
        },
      }
    )
  }

  const handleIssueClick = (issueId: string) => {
    navigate(`/issues/${issueId}`)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b p-6" style={{ borderLeftColor: group.color || '#6366f1', borderLeftWidth: '4px' }}>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/groups')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{group.name}</h1>
              <Badge className={`${statusColors[group.status]} text-white border-0`}>
                {group.status}
              </Badge>
            </div>
            {group.description && (
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
            )}
          </div>
        </div>

        {/* Branch Info */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono">{group.workingBranch}</span>
          </div>
          {group.baseBranch !== 'main' && (
            <span className="text-muted-foreground">
              from <span className="font-mono">{group.baseBranch}</span>
            </span>
          )}
        </div>

        {/* Stats */}
        {group.stats && (
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="font-semibold">{group.stats.totalIssues}</span>{' '}
              <span className="text-muted-foreground">Total</span>
            </div>
            <div>
              <span className="font-semibold">{group.stats.openIssues}</span>{' '}
              <span className="text-muted-foreground">Open</span>
            </div>
            <div>
              <span className="font-semibold">{group.stats.inProgressIssues}</span>{' '}
              <span className="text-muted-foreground">In Progress</span>
            </div>
            <div>
              <span className="font-semibold">{group.stats.completedIssues}</span>{' '}
              <span className="text-muted-foreground">Completed</span>
            </div>
            {group.stats.blockedIssues > 0 && (
              <div>
                <span className="font-semibold text-red-600">{group.stats.blockedIssues}</span>{' '}
                <span className="text-muted-foreground">Blocked</span>
              </div>
            )}
            {group.stats.needsReviewIssues > 0 && (
              <div>
                <span className="font-semibold text-yellow-600">{group.stats.needsReviewIssues}</span>{' '}
                <span className="text-muted-foreground">Needs Review</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Issue Section */}
      <div className="border-b p-4">
        <div className="flex gap-2">
          <Select value={selectedIssueId} onValueChange={setSelectedIssueId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select an issue to add..." />
            </SelectTrigger>
            <SelectContent>
              {availableIssues.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">No available issues</div>
              ) : (
                availableIssues.map((issue) => (
                  <SelectItem key={issue.id} value={issue.id}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{issue.id}</span>
                      <span>{issue.title}</span>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button onClick={handleAddIssue} disabled={!selectedIssueId}>
            <Plus className="mr-2 h-4 w-4" />
            Add Issue
          </Button>
        </div>
      </div>

      {/* Issues List */}
      <div className="flex-1 overflow-y-auto p-4">
        {group.issues.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-semibold text-muted-foreground">No issues in this group</p>
              <p className="text-sm text-muted-foreground">Add issues to start organizing</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {group.issues.map((issue) => (
              <Card
                key={issue.id}
                className="group cursor-pointer p-4 transition-all hover:shadow-md"
                onClick={() => handleIssueClick(issue.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-muted-foreground">{issue.id}</span>
                      <Badge variant="outline" className="text-xs">
                        {issue.status.replace('_', ' ')}
                      </Badge>
                      {issue.priority !== undefined && issue.priority <= 3 && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs text-white ${priorityColors[issue.priority]}`}
                        >
                          {priorityLabels[issue.priority]}
                        </span>
                      )}
                    </div>
                    <h3 className="font-medium">{issue.title}</h3>
                    {issue.content && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {issue.content.substring(0, 150)}...
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveClick(issue)
                    }}
                    disabled={isRemovingIssue}
                    className="opacity-0 group-hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Remove Confirmation Dialog */}
      <AlertDialog
        open={!!removingIssue}
        onOpenChange={(open) => !open && setRemovingIssue(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Issue from Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{removingIssue?.title}" from this group? The issue
              itself will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveConfirm}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
