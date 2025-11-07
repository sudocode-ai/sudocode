/**
 * ActionReviewModal Component
 *
 * Modal for reviewing and approving/rejecting project agent actions
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  GitBranch,
  FileText,
  Link,
  Settings,
  PlayCircle,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ProjectAgentAction {
  id: string
  project_agent_execution_id: string
  action_type: string
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed'
  priority?: 'high' | 'medium' | 'low'
  target_id?: string
  target_type?: 'spec' | 'issue' | 'execution'
  payload_json: string
  justification: string
  created_at: string
  approved_at?: string | null
  rejected_at?: string | null
  completed_at?: string | null
  error_message?: string | null
}

interface ActionReviewModalProps {
  /**
   * Action to review
   */
  action: ProjectAgentAction | null

  /**
   * Whether modal is open
   */
  open: boolean

  /**
   * Callback when modal should close
   */
  onClose: () => void

  /**
   * Callback when action is approved
   */
  onApprove?: (actionId: string) => void

  /**
   * Callback when action is rejected
   */
  onReject?: (actionId: string, reason: string) => void
}

/**
 * Get icon for action type
 */
function getActionIcon(actionType: string) {
  const iconMap: Record<string, any> = {
    create_issues_from_spec: FileText,
    start_execution: PlayCircle,
    pause_execution: Clock,
    resume_execution: PlayCircle,
    add_feedback: FileText,
    modify_spec: Settings,
    create_relationship: Link,
    update_issue_status: GitBranch,
  }
  const Icon = iconMap[actionType] || Settings
  return <Icon className="h-5 w-5" />
}

/**
 * Get human-readable action type label
 */
function getActionLabel(actionType: string): string {
  const labelMap: Record<string, string> = {
    create_issues_from_spec: 'Create Issues from Spec',
    start_execution: 'Start Execution',
    pause_execution: 'Pause Execution',
    resume_execution: 'Resume Execution',
    add_feedback: 'Add Feedback',
    modify_spec: 'Modify Spec',
    create_relationship: 'Create Relationship',
    update_issue_status: 'Update Issue Status',
  }
  return labelMap[actionType] || actionType
}

/**
 * Get priority badge color
 */
function getPriorityColor(priority?: string) {
  switch (priority) {
    case 'high':
      return 'destructive'
    case 'medium':
      return 'default'
    case 'low':
      return 'secondary'
    default:
      return 'outline'
  }
}

/**
 * ActionReviewModal Component
 *
 * @example
 * ```tsx
 * <ActionReviewModal
 *   action={action}
 *   open={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onApprove={(id) => console.log('Approved:', id)}
 *   onReject={(id, reason) => console.log('Rejected:', id, reason)}
 * />
 * ```
 */
export function ActionReviewModal({
  action,
  open,
  onClose,
  onApprove,
  onReject,
}: ActionReviewModalProps) {
  const [loading, setLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const { toast } = useToast()

  // Reset reject reason when modal closes
  useEffect(() => {
    if (!open) {
      setRejectReason('')
    }
  }, [open])

  if (!action) {
    return null
  }

  const handleApprove = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/project-agent/actions/${action.id}/approve`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to approve action')
      }

      toast({
        title: 'Action Approved',
        description: 'The action has been approved and will be executed.',
      })

      onApprove?.(action.id)
      onClose()
    } catch (err) {
      toast({
        title: 'Approval Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/project-agent/actions/${action.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: rejectReason || 'No reason provided' }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to reject action')
      }

      toast({
        title: 'Action Rejected',
        description: 'The action has been rejected.',
      })

      onReject?.(action.id, rejectReason)
      onClose()
    } catch (err) {
      toast({
        title: 'Rejection Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  let payload: any = {}
  try {
    payload = JSON.parse(action.payload_json)
  } catch {
    payload = {}
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getActionIcon(action.action_type)}
            Review Action
          </DialogTitle>
          <DialogDescription>
            Review this proposed action from the project agent
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Action Type & Priority */}
            <div className="flex items-center gap-2">
              <Badge variant="outline">{getActionLabel(action.action_type)}</Badge>
              {action.priority && (
                <Badge variant={getPriorityColor(action.priority)}>
                  {action.priority} priority
                </Badge>
              )}
              <Badge variant="secondary">{action.status}</Badge>
            </div>

            {/* Target Info */}
            {action.target_id && (
              <div className="text-sm">
                <span className="text-muted-foreground">Target: </span>
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  {action.target_type}/{action.target_id}
                </code>
              </div>
            )}

            {/* Justification */}
            <div>
              <Label>Justification</Label>
              <div className="mt-1 p-3 bg-muted rounded-md text-sm">
                {action.justification}
              </div>
            </div>

            {/* Payload Details */}
            <div>
              <Label>Action Details</Label>
              <div className="mt-1 p-3 bg-muted rounded-md">
                <pre className="text-xs overflow-x-auto">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            </div>

            {/* Metadata */}
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Created: {new Date(action.created_at).toLocaleString()}</div>
              <div>Action ID: {action.id}</div>
            </div>

            {/* Warning for destructive actions */}
            {['modify_spec', 'update_issue_status'].includes(action.action_type) && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Note:</strong> This action will modify existing data. Review carefully
                  before approving.
                </div>
              </div>
            )}

            {/* Rejection Reason (only shown when rejecting) */}
            {action.status === 'proposed' && (
              <div>
                <Label htmlFor="reject-reason">Rejection Reason (optional)</Label>
                <Textarea
                  id="reject-reason"
                  placeholder="Why are you rejecting this action?"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="mt-1"
                  rows={3}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          {action.status === 'proposed' && (
            <>
              <Button variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={loading}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button onClick={handleApprove} disabled={loading}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Approve
              </Button>
            </>
          )}
          {action.status !== 'proposed' && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
