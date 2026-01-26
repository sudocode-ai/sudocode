/**
 * StackReviewPanel - Full-page diff stack review experience
 * Displays stack metadata, checkpoint list, consolidated diffs, and review actions
 */

import { useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  GitCommit,
  Plus,
  Minus,
  FileText,
  Check,
  X,
  MessageSquare,
  Layers,
  Loader2,
  ChevronRight,
  Clock,
  GitBranch,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStackReview } from '@/hooks/useCheckpointDAG'
import {
  REVIEW_STATUS_STYLES,
  REVIEW_STATUS_LABELS,
  type DiffStackReviewStatus,
  type CheckpointInStack,
} from '@/types/checkpoint'

// =============================================================================
// Types
// =============================================================================

export interface StackReviewPanelProps {
  /** Stack ID to review */
  stackId: string
  /** Callback when review is completed (approved/rejected) */
  onReviewComplete?: () => void
  /** Callback to navigate back */
  onBack?: () => void
  /** Custom class name */
  className?: string
}

// =============================================================================
// Status Badge Component
// =============================================================================

interface StatusBadgeProps {
  status: DiffStackReviewStatus
  size?: 'sm' | 'md'
}

function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const styles = REVIEW_STATUS_STYLES[status]
  const label = REVIEW_STATUS_LABELS[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        styles.background,
        styles.text
      )}
    >
      {label}
    </span>
  )
}

// =============================================================================
// Checkpoint Sidebar Item
// =============================================================================

interface CheckpointSidebarItemProps {
  entry: CheckpointInStack
  isSelected: boolean
  onClick: () => void
}

function CheckpointSidebarItem({ entry, isSelected, onClick }: CheckpointSidebarItemProps) {
  const checkpoint = entry.checkpoint
  if (!checkpoint) return null

  const shortSha = checkpoint.commitSha.slice(0, 7)
  const message = checkpoint.message || 'No message'
  const displayMessage = message.length > 40 ? `${message.slice(0, 40)}...` : message

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-md p-3 transition-colors',
        isSelected
          ? 'bg-primary/10 border border-primary'
          : 'bg-muted/50 border border-transparent hover:bg-muted'
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <GitCommit className="h-3 w-3 text-muted-foreground" />
        <code className="text-xs font-mono text-muted-foreground">{shortSha}</code>
        <span className="text-xs text-muted-foreground">#{entry.position + 1}</span>
      </div>
      <p className="text-sm truncate" title={message}>
        {displayMessage}
      </p>
    </button>
  )
}

// =============================================================================
// Review Action Dialog
// =============================================================================

interface ReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: 'approve' | 'reject' | 'abandon' | null
  onConfirm: (notes: string) => void
  isLoading: boolean
}

function ReviewDialog({ open, onOpenChange, action, onConfirm, isLoading }: ReviewDialogProps) {
  const [notes, setNotes] = useState('')

  const handleConfirm = useCallback(() => {
    onConfirm(notes)
    setNotes('')
  }, [notes, onConfirm])

  const titles: Record<string, string> = {
    approve: 'Approve Stack',
    reject: 'Reject Stack',
    abandon: 'Abandon Stack',
  }

  const descriptions: Record<string, string> = {
    approve: 'This stack will be marked as approved and ready for merging.',
    reject: 'This stack will be marked as rejected and returned for rework.',
    abandon: 'This stack will be marked as abandoned and closed.',
  }

  const buttonLabels: Record<string, string> = {
    approve: 'Approve',
    reject: 'Reject',
    abandon: 'Abandon',
  }

  const buttonVariants: Record<string, 'default' | 'destructive' | 'secondary'> = {
    approve: 'default',
    reject: 'destructive',
    abandon: 'secondary',
  }

  if (!action) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[action]}</DialogTitle>
          <DialogDescription>{descriptions[action]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="review-notes">Notes (optional)</Label>
            <Textarea
              id="review-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about your review decision..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant={buttonVariants[action]} onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              buttonLabels[action]
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function StackReviewPanel({
  stackId,
  onReviewComplete,
  onBack,
  className,
}: StackReviewPanelProps) {
  // Fetch stack data
  const {
    stack,
    checkpoints,
    isLoading,
    isError,
    error,
    approve,
    reject,
    abandon,
    isReviewing,
  } = useStackReview(stackId)

  // Selected checkpoint for viewing
  const [selectedIndex, setSelectedIndex] = useState<number>(0)

  // Review dialog state
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'abandon' | null>(null)

  // Get selected checkpoint entry
  const selectedEntry = useMemo(() => {
    return checkpoints[selectedIndex] || null
  }, [checkpoints, selectedIndex])

  // Handle review action
  const handleReviewAction = useCallback(
    async (notes: string) => {
      try {
        if (reviewAction === 'approve') {
          await approve(notes)
        } else if (reviewAction === 'reject') {
          await reject(notes)
        } else if (reviewAction === 'abandon') {
          await abandon(notes)
        }
        setReviewAction(null)
        onReviewComplete?.()
      } catch {
        // Error handled by hook
      }
    },
    [reviewAction, approve, reject, abandon, onReviewComplete]
  )

  // Calculate totals - stats would need separate query
  // TODO: Add checkpoint stats fetching when API is ready
  const totalStats = useMemo(() => {
    return { files: checkpoints.length, additions: 0, deletions: 0 }
  }, [checkpoints])

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Error state
  if (isError || !stack) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-4', className)}>
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">
          {error?.message || 'Failed to load stack'}
        </p>
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            Go Back
          </Button>
        )}
      </div>
    )
  }

  const canReview = stack.reviewStatus === 'pending'

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="border-b bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold truncate">
                {stack.name || `Stack ${stack.id.slice(0, 8)}`}
              </h1>
              <StatusBadge status={stack.reviewStatus} />
            </div>
            {stack.description && (
              <p className="text-sm text-muted-foreground mb-2">{stack.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {stack.targetBranch}
              </span>
              <span className="flex items-center gap-1">
                <GitCommit className="h-3 w-3" />
                {checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {totalStats.files} file{totalStats.files !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1 text-green-600">
                <Plus className="h-3 w-3" />
                {totalStats.additions}
              </span>
              <span className="flex items-center gap-1 text-red-600">
                <Minus className="h-3 w-3" />
                {totalStats.deletions}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(stack.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canReview && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReviewAction('reject')}
                  disabled={isReviewing}
                >
                  <X className="mr-1 h-4 w-4" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => setReviewAction('approve')}
                  disabled={isReviewing}
                >
                  <Check className="mr-1 h-4 w-4" />
                  Approve
                </Button>
              </>
            )}
            {stack.reviewStatus === 'approved' && (
              <Button size="sm" variant="secondary" disabled>
                <Check className="mr-1 h-4 w-4" />
                Approved - Ready to Merge
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Checkpoint List */}
        <div className="w-80 border-r bg-muted/30">
          <div className="p-3 border-b">
            <h2 className="text-sm font-medium">Checkpoints</h2>
          </div>
          <ScrollArea className="h-[calc(100%-3rem)]">
            <div className="p-3 space-y-2">
              {checkpoints.map((entry, index) => (
                <CheckpointSidebarItem
                  key={entry.checkpointId}
                  entry={entry}
                  isSelected={selectedIndex === index}
                  onClick={() => setSelectedIndex(index)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main Area - Diff Viewer */}
        <div className="flex-1 overflow-auto">
          {selectedEntry?.checkpoint ? (
            <div className="p-4 space-y-4">
              {/* Selected Checkpoint Header */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitCommit className="h-4 w-4" />
                    <code className="font-mono text-sm">
                      {selectedEntry.checkpoint.commitSha.slice(0, 7)}
                    </code>
                    <span className="text-muted-foreground font-normal">
                      #{selectedEntry.position + 1}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">{selectedEntry.checkpoint.message || 'No message'}</p>
                  {/* TODO: Add checkpoint stats when API returns stats with checkpoints */}
                </CardContent>
              </Card>

              {/* Diff Content Placeholder */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Changes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border bg-muted/30 p-8 text-center">
                    <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Diff viewer integration pending.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      File changes will be displayed here once the checkpoint diff API is connected.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Navigation */}
              <div className="flex justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
                  disabled={selectedIndex === 0}
                >
                  Previous Checkpoint
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedIndex(Math.min(checkpoints.length - 1, selectedIndex + 1))}
                  disabled={selectedIndex === checkpoints.length - 1}
                >
                  Next Checkpoint
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <p>Select a checkpoint to view its changes</p>
            </div>
          )}
        </div>
      </div>

      {/* Review Notes (if any) */}
      {stack.reviewNotes && (
        <div className="border-t bg-muted/30 p-4">
          <div className="flex items-start gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Review Notes</p>
              <p className="text-sm">{stack.reviewNotes}</p>
            </div>
          </div>
        </div>
      )}

      {/* Review Dialog */}
      <ReviewDialog
        open={reviewAction !== null}
        onOpenChange={(open) => !open && setReviewAction(null)}
        action={reviewAction}
        onConfirm={handleReviewAction}
        isLoading={isReviewing}
      />
    </div>
  )
}

export default StackReviewPanel
