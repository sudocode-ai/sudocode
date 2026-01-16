import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ExecutionView,
  type ExecutionHeaderData,
  type ExecutionActionHandlers,
} from '@/components/executions/ExecutionView'
import { ExecutionStatusBadge } from '@/components/executions/ExecutionStatusBadge'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowLeft, Info, MoreVertical, Trash2, FolderOpen, X, Loader2, Network } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MacroAgentSessionInfo } from '@/components/macro-agent'
import type { Execution } from '@/types/execution'

const truncateId = (id: string, length = 8) => id.substring(0, length)

export default function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const [status, setStatus] = useState<Execution['status'] | null>(null)
  const [headerData, setHeaderData] = useState<ExecutionHeaderData | null>(null)
  const [actionHandlers, setActionHandlers] = useState<ExecutionActionHandlers | null>(null)

  const handleHeaderDataChange = useCallback(
    (data: ExecutionHeaderData, handlers: ExecutionActionHandlers) => {
      setHeaderData(data)
      setActionHandlers(handlers)
    },
    []
  )

  if (!id) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <h2 className="mb-2 text-2xl font-bold">Invalid Execution</h2>
          <p className="mb-4 text-muted-foreground">No execution ID provided.</p>
          <Button onClick={() => navigate(paths.issues())}>Back to Issues</Button>
        </div>
      </div>
    )
  }

  const rootExecution = headerData?.rootExecution
  const lastExecution = headerData?.lastExecution

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-lg font-semibold">Execution {truncateId(id)}</h1>
          {rootExecution?.agent_type === 'macro-agent' && (
            <Badge variant="outline" className="bg-purple-100/50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
              <Network className="mr-1 h-3 w-3" />
              macro-agent
            </Badge>
          )}
          {status && <ExecutionStatusBadge status={status} />}
        </div>

        {/* Right side: Info, Cancel, Menu */}
        <div className="flex items-center gap-2">
          {/* Cancel Button - shown when execution can be cancelled */}
          {headerData?.canCancel && actionHandlers && (
            <Button
              variant="destructive"
              size="xs"
              onClick={actionHandlers.onCancel}
              disabled={headerData.cancelling}
            >
              {headerData.cancelling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </>
              )}
            </Button>
          )}

          {/* Info Popover */}
          {headerData && rootExecution && lastExecution && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="space-y-3">
                  <h4 className="font-medium">Execution Details</h4>
                  <div className="space-y-2 text-sm">
                    {rootExecution.issue_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Issue</span>
                        <span className="font-mono">{rootExecution.issue_id}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Mode</span>
                      <span className="capitalize">{rootExecution.mode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Model</span>
                      <span>{rootExecution.model}</span>
                    </div>
                    {rootExecution.target_branch && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Base Branch</span>
                        <span className="font-mono">{rootExecution.target_branch}</span>
                      </div>
                    )}
                    {rootExecution.branch_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Branch</span>
                        <span className="font-mono">{rootExecution.branch_name}</span>
                      </div>
                    )}
                    {rootExecution.worktree_path && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Worktree</span>
                        <span className="max-w-[180px] truncate font-mono text-xs">
                          {rootExecution.worktree_path}
                        </span>
                      </div>
                    )}
                    {lastExecution.session_id && (
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground">Session</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {lastExecution.session_id}
                        </code>
                      </div>
                    )}
                    {rootExecution.created_at && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Started</span>
                        <span>
                          {new Date(rootExecution.created_at).toLocaleString('en-US', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                    )}
                    {lastExecution.completed_at && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Completed</span>
                        <span>
                          {new Date(lastExecution.completed_at).toLocaleString('en-US', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Macro-Agent Session Info */}
                  {rootExecution.agent_type === 'macro-agent' && (
                    <>
                      <Separator />
                      <MacroAgentSessionInfo
                        executionId={rootExecution.id}
                        dashboardPath={paths.macroAgent()}
                      />
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Actions Dropdown Menu */}
          {actionHandlers && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Open in IDE - only for worktree executions */}
                {headerData?.worktreeExists && rootExecution?.worktree_path && (
                  <>
                    <DropdownMenuItem onClick={actionHandlers.onOpenInIDE}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Open in IDE
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={actionHandlers.onDelete}
                  disabled={headerData?.deletingExecution}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Execution
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Main content - scrollable area with padding bottom for sticky panel */}
      <div className="flex-1 overflow-auto">
        <ExecutionView
          executionId={id}
          onStatusChange={setStatus}
          onHeaderDataChange={handleHeaderDataChange}
        />
      </div>
    </div>
  )
}
