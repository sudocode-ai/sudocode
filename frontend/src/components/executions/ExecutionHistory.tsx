import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2, Clock, StopCircle } from 'lucide-react'
import { executionsApi } from '@/lib/api'
import type { Execution, ExecutionStatus } from '@/types/execution'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

interface ExecutionHistoryProps {
  issueId: string
}

const STATUS_CONFIG: Record<
  ExecutionStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    icon: React.ReactNode
  }
> = {
  running: {
    label: 'Running',
    variant: 'default',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  completed: {
    label: 'Completed',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircle className="h-3 w-3" />,
  },
  stopped: {
    label: 'Stopped',
    variant: 'secondary',
    icon: <StopCircle className="h-3 w-3" />,
  },
}

function formatTimestamp(dateString: string | Date): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function truncateId(id: string, length = 8): string {
  return id.substring(0, length)
}

export function ExecutionHistory({ issueId }: ExecutionHistoryProps) {
  const navigate = useNavigate()
  const [executions, setExecutions] = useState<Execution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchExecutions = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await executionsApi.list(issueId)
        // Sort by created date, newest first
        const sorted = data.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        setExecutions(sorted)
      } catch (err) {
        console.error('Failed to fetch executions:', err)
        setError('Failed to load execution history')
      } finally {
        setLoading(false)
      }
    }

    fetchExecutions()
  }, [issueId])

  const handleExecutionClick = (executionId: string) => {
    navigate(`/executions/${executionId}`)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Execution History</h3>
        <div className="py-4 text-center text-sm text-muted-foreground">Loading executions...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Execution History</h3>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    )
  }

  if (executions.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Execution History</h3>
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No executions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Click "Run Agent" to start your first execution
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-medium text-muted-foreground">Execution History</h3>
        <Badge variant="secondary">{executions.length}</Badge>
      </div>

      <div className="space-y-2">
        {executions.map((execution) => {
          const statusConfig = STATUS_CONFIG[execution.status] || {
            label: execution.status,
            variant: 'outline' as const,
            icon: <Clock className="h-3 w-3" />,
          }
          const timestamp = execution.completedAt || execution.startedAt || execution.createdAt

          return (
            <Card
              key={execution.id}
              className="cursor-pointer p-3 transition-colors hover:bg-accent"
              onClick={() => handleExecutionClick(execution.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs text-muted-foreground">
                      {truncateId(execution.id)}
                    </code>
                    <Badge variant={statusConfig.variant} className="gap-1">
                      {statusConfig.icon}
                      {statusConfig.label}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{execution.model}</span>
                    <span>•</span>
                    <span className="capitalize">{execution.mode}</span>
                    <span>•</span>
                    <span>{formatTimestamp(timestamp)}</span>
                  </div>

                  {execution.error && (
                    <div className="line-clamp-1 text-xs text-destructive">
                      Error: {execution.error}
                    </div>
                  )}

                  {execution.filesChanged && execution.filesChanged.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {execution.filesChanged.length} file(s) changed
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
