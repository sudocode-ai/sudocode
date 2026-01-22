import { Badge } from '@/components/ui/badge'
import { Circle, Clock, CheckCircle2, XCircle, AlertCircle, Play } from 'lucide-react'
import type { Issue, IssueStatus } from '@/types/api'
import type { Execution, ExecutionStatus } from '@/types/execution'

// Priority badge colors - matching IssueCard pattern
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

// Status configuration
const statusConfig: Record<IssueStatus, { label: string; color: string; icon: React.ElementType }> =
  {
    open: { label: 'Open', color: 'text-gray-500', icon: Circle },
    in_progress: { label: 'In Progress', color: 'text-blue-500', icon: Clock },
    blocked: { label: 'Blocked', color: 'text-red-500', icon: XCircle },
    needs_review: { label: 'Needs Review', color: 'text-yellow-500', icon: AlertCircle },
    closed: { label: 'Closed', color: 'text-green-500', icon: CheckCircle2 },
  }

// Execution status configuration
const executionStatusConfig: Record<ExecutionStatus, { label: string; color: string }> = {
  pending: {
    label: 'Pending',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  preparing: {
    label: 'Preparing',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  running: {
    label: 'Running',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  paused: {
    label: 'Paused',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  },
  completed: {
    label: 'Completed',
    color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  stopped: {
    label: 'Stopped',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
}

interface IssueHoverContentProps {
  issue: Issue | undefined
  executions: Execution[]
  isLoading: boolean
  isError: boolean
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="flex gap-2">
        <div className="h-5 w-16 rounded bg-muted" />
        <div className="h-5 w-12 rounded bg-muted" />
      </div>
      <div className="h-3 w-1/2 rounded bg-muted" />
    </div>
  )
}

export function IssueHoverContent({
  issue,
  executions,
  isLoading,
  isError,
}: IssueHoverContentProps) {
  if (isLoading) {
    return <LoadingSkeleton />
  }

  if (isError || !issue) {
    return <div className="text-sm text-muted-foreground">Failed to load issue details</div>
  }

  const status = statusConfig[issue.status] || statusConfig.open
  const StatusIcon = status.icon
  const runningExecutions = executions.filter((e) => e.status === 'running')

  return (
    <div className="space-y-3">
      {/* Title */}
      <h4 className="line-clamp-2 text-sm font-semibold leading-tight">{issue.title}</h4>

      {/* Status and Priority */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status Badge */}
        <div className={`flex items-center gap-1 text-xs ${status.color}`}>
          <StatusIcon className="h-3 w-3" />
          <span>{status.label}</span>
        </div>

        {/* Priority Badge */}
        {issue.priority !== undefined && issue.priority <= 3 && (
          <span
            className={`rounded-full px-2 py-0 text-xs text-white ${priorityColors[issue.priority]}`}
          >
            {priorityLabels[issue.priority]}
          </span>
        )}
      </div>

      {/* Running Executions */}
      {runningExecutions.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-blue-500">
          <Play className="h-3 w-3 animate-pulse" />
          <span>
            {runningExecutions.length} running execution{runningExecutions.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Recent Executions */}
      {executions.length > 0 && (
        <div className="border-t pt-2">
          <div className="mb-1.5 text-xs text-muted-foreground">Recent executions</div>
          <div className="space-y-1">
            {executions.slice(0, 3).map((exec) => {
              const execStatus = executionStatusConfig[exec.status] || executionStatusConfig.pending
              return (
                <div key={exec.id} className="flex items-center justify-between text-xs">
                  <span className="max-w-[120px] truncate text-muted-foreground">{exec.id}</span>
                  <Badge
                    variant="outline"
                    className={`px-1.5 py-0 text-[10px] ${execStatus.color}`}
                  >
                    {execStatus.label}
                  </Badge>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
