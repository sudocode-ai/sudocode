import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Layers,
  GitMerge,
  Check,
  X,
  RotateCcw,
  Loader2,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { useIssueCheckpoints, useReviewCheckpoint } from '@/hooks/useIssueCheckpoints'
import { usePromote } from '@/hooks/usePromote'
import { PromoteDialog } from './PromoteDialog'
import type { Issue } from '@/types/api'
import { formatDistanceToNow } from 'date-fns'

interface CheckpointSectionProps {
  issue: Issue
  /** Issues that block this one (must be promoted first) */
  blockedBy?: string[]
  /** Dependent issues that can be included in stack promotion */
  dependentIssues?: string[]
}

/**
 * Get review status badge styling
 */
function getReviewStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        variant: 'default' as const,
        className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      }
    case 'pending':
      return {
        label: 'Pending',
        variant: 'secondary' as const,
        className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      }
    case 'rejected':
      return {
        label: 'Rejected',
        variant: 'destructive' as const,
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      }
    case 'merged':
      return {
        label: 'Merged',
        variant: 'default' as const,
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      }
    default:
      return {
        label: status,
        variant: 'outline' as const,
        className: '',
      }
  }
}

export function CheckpointSection({
  issue,
  blockedBy = [],
  dependentIssues = [],
}: CheckpointSectionProps) {
  const { data, isLoading, refetch, isRefetching } = useIssueCheckpoints(issue.id)
  const reviewMutation = useReviewCheckpoint()
  const {
    isPromoteDialogOpen,
    setIsPromoteDialogOpen,
    performPromote,
    promoteResult,
    isPromoting,
    closePromoteDialog,
  } = usePromote()

  const checkpoint = data?.current || null
  const checkpoints = data?.checkpoints || []

  const handleApprove = () => {
    reviewMutation.mutate({
      issueId: issue.id,
      action: 'approve',
    })
  }

  const handleReject = () => {
    reviewMutation.mutate({
      issueId: issue.id,
      action: 'request_changes',
    })
  }

  const handleResetReview = () => {
    reviewMutation.mutate({
      issueId: issue.id,
      action: 'reset',
    })
  }

  const handlePromote = (options: Parameters<typeof performPromote>[1]) => {
    performPromote(issue.id, options)
  }

  // Determine if promote is available
  const canPromote = checkpoint && checkpoint.review_status === 'approved'
  const isReviewing = reviewMutation.isPending

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Layers className="h-4 w-4" />
            Checkpoint
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4" />
              Checkpoint
              {checkpoints.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({checkpoints.length})
                </span>
              )}
            </CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => refetch()}
                  disabled={isRefetching}
                >
                  <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!checkpoint ? (
            <div className="flex items-start gap-2 rounded-md border border-dashed p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="text-sm">
                <p className="font-medium">No checkpoints yet</p>
                <p className="text-muted-foreground">
                  Run an execution and checkpoint it to save changes for review.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Checkpoint Info */}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge className={getReviewStatusBadge(checkpoint.review_status).className}>
                      {getReviewStatusBadge(checkpoint.review_status).label}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Commit:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {checkpoint.commit_sha?.substring(0, 7)}
                    </code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Changes:</span>
                    <span>
                      {checkpoint.changed_files} file{checkpoint.changed_files !== 1 ? 's' : ''}{' '}
                      <span className="text-green-600">+{checkpoint.additions}</span>{' '}
                      <span className="text-red-600">-{checkpoint.deletions}</span>
                    </span>
                  </div>
                  {checkpoint.message && (
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground">Message:</p>
                      <p className="mt-0.5 truncate text-xs">{checkpoint.message}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-1 pt-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(checkpoint.checkpointed_at), { addSuffix: true })}
                  </div>
                </div>
              </div>

              {/* Review Controls */}
              <div className="flex flex-wrap items-center gap-2">
                {checkpoint.review_status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApprove}
                      disabled={isReviewing}
                      className="flex-1"
                    >
                      {isReviewing ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleReject}
                      disabled={isReviewing}
                      className="flex-1"
                    >
                      {isReviewing ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <X className="mr-1 h-3 w-3" />
                      )}
                      Reject
                    </Button>
                  </>
                )}
                {checkpoint.review_status === 'approved' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleResetReview}
                        disabled={isReviewing}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Reset Review
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Set review status back to pending</TooltipContent>
                  </Tooltip>
                )}
                {checkpoint.review_status === 'rejected' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApprove}
                      disabled={isReviewing}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleResetReview}
                      disabled={isReviewing}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Reset
                    </Button>
                  </>
                )}
              </div>

              {/* Promote Button */}
              <div className="border-t pt-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        className="w-full"
                        onClick={() => setIsPromoteDialogOpen(true)}
                        disabled={!canPromote || checkpoint.review_status === 'merged'}
                      >
                        <GitMerge className="mr-2 h-4 w-4" />
                        {checkpoint.review_status === 'merged'
                          ? 'Already Merged'
                          : 'Promote'}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  {!canPromote && checkpoint.review_status !== 'merged' && (
                    <TooltipContent>
                      {checkpoint.review_status === 'pending'
                        ? 'Approve checkpoint before promoting'
                        : 'Checkpoint was rejected - approve first'}
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Promote Dialog */}
      <PromoteDialog
        issue={issue}
        checkpoint={checkpoint}
        isOpen={isPromoteDialogOpen}
        onClose={closePromoteDialog}
        onPromote={handlePromote}
        isPromoting={isPromoting}
        promoteResult={promoteResult}
        blockedBy={blockedBy}
        dependentIssues={dependentIssues}
      />
    </TooltipProvider>
  )
}
