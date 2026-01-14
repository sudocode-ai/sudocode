import { useMemo } from 'react'
import { PlayCircle, CheckCircle2, XCircle, Clock, PauseCircle, Plus } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Execution, ExecutionStatus } from '@/types/execution'

interface ExecutionSelectorProps {
  executions: Execution[]
  value: string | null
  onChange: (executionId: string | null) => void
  className?: string
}

const NEW_EXECUTION_VALUE = '__new__'

const statusConfig: Record<
  ExecutionStatus,
  { icon: typeof PlayCircle; color: string; label: string }
> = {
  preparing: { icon: Clock, color: 'text-yellow-500', label: 'Preparing' },
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  running: { icon: PlayCircle, color: 'text-green-500', label: 'Running' },
  paused: { icon: PauseCircle, color: 'text-orange-500', label: 'Paused' },
  waiting: { icon: Clock, color: 'text-blue-500', label: 'Waiting' },
  completed: { icon: CheckCircle2, color: 'text-blue-500', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-500', label: 'Failed' },
  cancelled: { icon: XCircle, color: 'text-muted-foreground', label: 'Cancelled' },
  stopped: { icon: XCircle, color: 'text-muted-foreground', label: 'Stopped' },
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function getAgentLabel(agentType: string): string {
  const labels: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
  }
  return labels[agentType] || agentType
}

export function ExecutionSelector({
  executions,
  value,
  onChange,
  className,
}: ExecutionSelectorProps) {
  // Group executions by status
  const grouped = useMemo(() => {
    const activeStatuses: ExecutionStatus[] = ['running', 'pending', 'preparing', 'paused', 'waiting']
    const active = executions.filter((e) => activeStatuses.includes(e.status))
    const recent = executions
      .filter((e) => !activeStatuses.includes(e.status))
      .slice(0, 10) // Limit to 10 recent

    return { active, recent }
  }, [executions])

  const handleChange = (newValue: string) => {
    if (newValue === NEW_EXECUTION_VALUE) {
      onChange(null)
    } else {
      onChange(newValue)
    }
  }

  // Use NEW_EXECUTION_VALUE when no value is selected (shows config panel)
  const selectValue = value || NEW_EXECUTION_VALUE

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <SelectTrigger className={cn('h-8 text-xs', className)}>
        <SelectValue placeholder="New execution">
          {value ? (
            <ExecutionOption execution={executions.find((e) => e.id === value)} compact />
          ) : (
            <span className="flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              <span>New</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* New execution option */}
        <SelectItem value={NEW_EXECUTION_VALUE}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-3 w-3" />
            <span>New execution</span>
          </span>
        </SelectItem>

        {/* Active executions */}
        {grouped.active.length > 0 && (
          <SelectGroup>
            <SelectLabel>Active</SelectLabel>
            {grouped.active.map((execution) => (
              <SelectItem key={execution.id} value={execution.id}>
                <ExecutionOption execution={execution} />
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {/* Recent executions */}
        {grouped.recent.length > 0 && (
          <SelectGroup>
            <SelectLabel>Recent</SelectLabel>
            {grouped.recent.map((execution) => (
              <SelectItem key={execution.id} value={execution.id}>
                <ExecutionOption execution={execution} />
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

function ExecutionOption({
  execution,
  compact = false,
}: {
  execution?: Execution
  compact?: boolean
}) {
  if (!execution) return null

  const config = statusConfig[execution.status]
  const Icon = config.icon

  return (
    <span className="flex items-center gap-1.5">
      <Icon className={cn('h-3 w-3 shrink-0', config.color)} />
      <span className="truncate">
        {compact ? (
          getAgentLabel(execution.agent_type)
        ) : (
          <>
            {getAgentLabel(execution.agent_type)}
            <span className="ml-1 text-muted-foreground">
              {formatTimeAgo(execution.created_at)}
            </span>
          </>
        )}
      </span>
    </span>
  )
}
