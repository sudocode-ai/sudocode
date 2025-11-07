/**
 * NotificationCenter Component
 *
 * Displays pending project agent actions requiring review
 */

import { useState, useEffect } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Bell, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { ActionReviewModal } from './ActionReviewModal'

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
}

interface NotificationCenterProps {
  /**
   * Custom class name
   */
  className?: string
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
 * Format time ago
 */
function timeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * NotificationCenter Component
 *
 * @example
 * ```tsx
 * <NotificationCenter />
 * ```
 */
export function NotificationCenter({ className = '' }: NotificationCenterProps) {
  const [actions, setActions] = useState<ProjectAgentAction[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedAction, setSelectedAction] = useState<ProjectAgentAction | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // Fetch pending actions
  const fetchActions = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/project-agent/actions?status=proposed&limit=20')
      if (!response.ok) {
        throw new Error('Failed to fetch actions')
      }
      const data = await response.json()
      setActions(data.data?.actions || [])
    } catch (err) {
      console.error('Error fetching actions:', err)
    } finally {
      setLoading(false)
    }
  }

  // Poll for updates every 10 seconds
  useEffect(() => {
    fetchActions()

    const interval = setInterval(fetchActions, 10000)
    return () => clearInterval(interval)
  }, [])

  // Open action review modal
  const handleActionClick = (action: ProjectAgentAction) => {
    setSelectedAction(action)
    setModalOpen(true)
  }

  // Handle action approved
  const handleActionApproved = () => {
    fetchActions()
  }

  // Handle action rejected
  const handleActionRejected = () => {
    fetchActions()
  }

  const pendingCount = actions.length

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`relative ${className}`}
          >
            <Bell className="h-5 w-5" />
            {pendingCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {pendingCount > 9 ? '9+' : pendingCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-96 p-0" align="end">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-semibold">Action Approvals</h3>
            {pendingCount > 0 && (
              <Badge variant="secondary">{pendingCount} pending</Badge>
            )}
          </div>

          <ScrollArea className="h-[400px]">
            {loading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Clock className="h-5 w-5 animate-spin mr-2" />
                Loading...
              </div>
            )}

            {!loading && pendingCount === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm">No pending actions</p>
                <p className="text-xs mt-1">
                  You're all caught up!
                </p>
              </div>
            )}

            {!loading && actions.length > 0 && (
              <div className="divide-y">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleActionClick(action)}
                    className="w-full text-left px-4 py-3 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Priority Indicator */}
                      <div className="mt-1">
                        {action.priority === 'high' && (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                        {action.priority === 'medium' && (
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                        )}
                        {!action.priority || action.priority === 'low' ? (
                          <AlertCircle className="h-4 w-4 text-blue-500" />
                        ) : null}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium truncate">
                            {getActionLabel(action.action_type)}
                          </span>
                          {action.priority && (
                            <Badge
                              variant={
                                action.priority === 'high'
                                  ? 'destructive'
                                  : action.priority === 'medium'
                                  ? 'default'
                                  : 'secondary'
                              }
                              className="text-xs"
                            >
                              {action.priority}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {action.justification}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          {action.target_id && (
                            <code className="text-xs bg-muted px-1 py-0.5 rounded">
                              {action.target_type}/{action.target_id.slice(0, 8)}...
                            </code>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {timeAgo(action.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          {pendingCount > 0 && (
            <div className="border-t px-4 py-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchActions}
                disabled={loading}
                className="text-xs"
              >
                Refresh
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Action Review Modal */}
      <ActionReviewModal
        action={selectedAction}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onApprove={handleActionApproved}
        onReject={handleActionRejected}
      />
    </>
  )
}
