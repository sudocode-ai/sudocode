import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertCircle,
  Loader2,
  GitMerge,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react'
import type { Issue } from '@/types/api'
import type { Checkpoint, PromoteOptions, PromoteResult } from '@/types/execution'

export interface PromoteDialogProps {
  issue: Issue | null
  checkpoint: Checkpoint | null
  isOpen: boolean
  onClose: () => void
  onPromote: (options: PromoteOptions) => void
  isPromoting?: boolean
  promoteResult?: PromoteResult | null
  /** List of issue IDs that block this issue */
  blockedBy?: string[]
  /** Dependent issues that can be included in stack promotion */
  dependentIssues?: string[]
}

/**
 * Get review status badge color
 */
function getReviewStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return { label: 'Approved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30' }
    case 'pending':
      return { label: 'Pending Review', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' }
    case 'rejected':
      return { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30' }
    case 'merged':
      return { label: 'Merged', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30' }
    default:
      return { label: status, color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30' }
  }
}

export function PromoteDialog({
  issue,
  checkpoint,
  isOpen,
  onClose,
  onPromote,
  isPromoting = false,
  promoteResult,
  blockedBy = [],
  dependentIssues = [],
}: PromoteDialogProps) {
  const [strategy, setStrategy] = useState<'squash' | 'merge'>('squash')
  const [message, setMessage] = useState('')
  const [includeStack, setIncludeStack] = useState(false)
  const [forcePromote, setForcePromote] = useState(false)

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen && issue && checkpoint) {
      // Generate default message from issue info
      const defaultMessage = `Merge ${issue.id}: ${issue.title}`
      setMessage(defaultMessage)
      setStrategy('squash')
      setIncludeStack(false)
      setForcePromote(false)
    }
  }, [isOpen, issue, checkpoint])

  const handlePromote = () => {
    onPromote({
      strategy,
      message: message.trim() || undefined,
      include_stack: includeStack,
      force: forcePromote,
    })
  }

  // Determine if promote is blocked
  const isBlocked = blockedBy.length > 0
  const requiresApproval = checkpoint?.review_status !== 'approved' && checkpoint?.review_status !== 'merged'
  const canPromote = !isBlocked && (!requiresApproval || forcePromote) && checkpoint

  // Success state
  if (promoteResult?.success) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              Successfully Promoted
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Merge commit:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {promoteResult.merge_commit?.substring(0, 7)}
                  </code>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Files changed:</span>
                  <span className="font-medium">{promoteResult.files_changed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lines:</span>
                  <span>
                    <span className="font-medium text-green-600">+{promoteResult.additions}</span>{' '}
                    <span className="font-medium text-red-600">-{promoteResult.deletions}</span>
                  </span>
                </div>
                {promoteResult.promoted_issues && promoteResult.promoted_issues.length > 1 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Issues promoted:</span>
                    <span className="font-medium">{promoteResult.promoted_issues.length}</span>
                  </div>
                )}
              </div>
            </div>

            {promoteResult.cascade && promoteResult.cascade.affected_streams.length > 0 && (
              <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Cascade rebase triggered
                </p>
                <p className="mt-1 text-xs text-blue-800 dark:text-blue-200">
                  {promoteResult.cascade.affected_streams.length} dependent stream(s) rebased
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Error/blocked state
  if (promoteResult && !promoteResult.success) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Promote Failed
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {promoteResult.blocked_by && promoteResult.blocked_by.length > 0 ? (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                <p className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-100">
                  Blocked by unmerged issues:
                </p>
                <ul className="space-y-1 text-sm">
                  {promoteResult.blocked_by.map((id, i) => (
                    <li key={i} className="font-mono text-xs text-amber-800 dark:text-amber-200">
                      - {id}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Promote these issues first, or use stack promotion.
                </p>
              </div>
            ) : promoteResult.requires_approval ? (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                      Approval required
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Checkpoint must be approved before promotion.
                    </p>
                  </div>
                </div>
              </div>
            ) : promoteResult.conflicts && promoteResult.conflicts.length > 0 ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <p className="mb-2 text-sm font-medium">Conflicts detected in:</p>
                <ul className="space-y-1 text-sm">
                  {promoteResult.conflicts.map((conflict, i) => (
                    <li key={i} className="font-mono text-xs">
                      - {conflict.path}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Resolve conflicts before promoting.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <p className="text-sm">{promoteResult.error || 'Unknown error occurred'}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <GitMerge className="h-5 w-5" />
                Promote to Base Branch
              </DialogTitle>
              <DialogDescription>Merge issue checkpoint to the base branch</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Issue Info */}
            {issue && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Issue:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{issue.id}</code>
                    <span className="text-muted-foreground">-</span>
                    <span className="truncate">{issue.title}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Checkpoint Info */}
            {checkpoint ? (
              <div className="rounded-lg border p-3">
                <h3 className="mb-2 text-sm font-medium">Current Checkpoint</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge className={getReviewStatusBadge(checkpoint.review_status).color}>
                      {getReviewStatusBadge(checkpoint.review_status).label}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Commit:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {checkpoint.commit_sha?.substring(0, 7)}
                    </code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Changes:</span>
                    <span>
                      {checkpoint.changed_files} file{checkpoint.changed_files !== 1 ? 's' : ''}{' '}
                      <span className="text-green-600">+{checkpoint.additions}</span>{' '}
                      <span className="text-red-600">-{checkpoint.deletions}</span>
                    </span>
                  </div>
                  {checkpoint.message && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Message:</span>
                      <span className="max-w-[300px] truncate">{checkpoint.message}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      No checkpoint found
                    </p>
                    <p className="mt-1 text-amber-800 dark:text-amber-200">
                      Create a checkpoint from an execution before promoting.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Blocked Warning */}
            {isBlocked && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      Blocked by dependencies
                    </p>
                    <p className="mt-1 text-amber-800 dark:text-amber-200">
                      These issues must be promoted first:
                    </p>
                    <ul className="mt-2 space-y-1">
                      {blockedBy.map((id) => (
                        <li key={id} className="font-mono text-xs">
                          - {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Approval Warning */}
            {requiresApproval && checkpoint && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      Checkpoint not approved
                    </p>
                    <p className="mt-1 text-amber-800 dark:text-amber-200">
                      {checkpoint.review_status === 'rejected'
                        ? 'Checkpoint was rejected. Address feedback before promoting.'
                        : 'Checkpoint is awaiting approval.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Merge Strategy */}
            {checkpoint && (
              <div className="space-y-3">
                <Label>Merge Strategy</Label>
                <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as 'squash' | 'merge')}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="squash" id="squash" />
                    <Label htmlFor="squash" className="font-normal">
                      Squash (recommended) - Combine all commits into one
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="merge" id="merge" />
                    <Label htmlFor="merge" className="font-normal">
                      Merge commit - Preserve full commit history
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Commit Message */}
            {checkpoint && (
              <div className="space-y-2">
                <Label htmlFor="promote-message">Commit Message</Label>
                <Textarea
                  id="promote-message"
                  placeholder="Enter merge commit message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                />
              </div>
            )}

            {/* Options */}
            {checkpoint && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">Options</h3>
                <div className="space-y-2">
                  {dependentIssues.length > 0 && (
                    <>
                      <Label
                        htmlFor="include-stack"
                        className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                      >
                        <Checkbox
                          id="include-stack"
                          checked={includeStack}
                          onCheckedChange={(checked) => setIncludeStack(checked === true)}
                        />
                        <span>Include dependent issues ({dependentIssues.join(', ')})</span>
                      </Label>
                      <p className="ml-6 text-xs text-muted-foreground">
                        Promote this issue and all dependent issues together
                      </p>
                    </>
                  )}
                  {requiresApproval && (
                    <>
                      <Label
                        htmlFor="force-promote"
                        className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                      >
                        <Checkbox
                          id="force-promote"
                          checked={forcePromote}
                          onCheckedChange={(checked) => setForcePromote(checked === true)}
                        />
                        <span>Force promote without approval</span>
                      </Label>
                      <p className="ml-6 text-xs text-muted-foreground">
                        Skip the approval requirement (not recommended)
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPromoting}>
            Cancel
          </Button>
          <Button onClick={handlePromote} disabled={isPromoting || !canPromote}>
            {isPromoting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Promoting...
              </>
            ) : (
              'Promote'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
