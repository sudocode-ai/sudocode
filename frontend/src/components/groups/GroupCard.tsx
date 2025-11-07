import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { IssueGroup } from '@/types/api'
import { GitBranch, Pause, Play, CheckCircle2, Clock } from 'lucide-react'

interface GroupCardProps {
  group: IssueGroup
  onEdit?: (group: IssueGroup) => void
  onPause?: (group: IssueGroup) => void
  onResume?: (group: IssueGroup) => void
  onComplete?: (group: IssueGroup) => void
}

const statusIcons = {
  active: <Play className="h-3 w-3" />,
  paused: <Pause className="h-3 w-3" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
}

const statusColors = {
  active: 'bg-green-500 dark:bg-green-600',
  paused: 'bg-yellow-500 dark:bg-yellow-600',
  completed: 'bg-blue-500 dark:bg-blue-600',
}

const statusLabels = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
}

export function GroupCard({ group, onEdit, onPause, onResume, onComplete }: GroupCardProps) {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(`/groups/${group.id}`)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit?.(group)
  }

  const handlePause = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPause?.(group)
  }

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation()
    onResume?.(group)
  }

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onComplete?.(group)
  }

  return (
    <Card
      className="group relative cursor-pointer overflow-hidden border-l-4 p-4 transition-all hover:shadow-md"
      style={{ borderLeftColor: group.color || '#6366f1' }}
      onClick={handleClick}
    >
      {/* Color stripe at the top */}
      <div
        className="absolute left-0 top-0 h-1 w-full"
        style={{ backgroundColor: group.color || '#6366f1' }}
      />

      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate">{group.name}</h3>
            <p className="text-xs text-muted-foreground">{group.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`${statusColors[group.status]} text-white border-0`}
            >
              <span className="flex items-center gap-1">
                {statusIcons[group.status]}
                {statusLabels[group.status]}
              </span>
            </Badge>
          </div>
        </div>

        {/* Description */}
        {group.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{group.description}</p>
        )}

        {/* Branch Info */}
        <div className="flex flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span className="font-mono">{group.workingBranch}</span>
          </div>
          {group.baseBranch !== 'main' && (
            <span className="text-muted-foreground">
              from <span className="font-mono">{group.baseBranch}</span>
            </span>
          )}
        </div>

        {/* Pause Reason */}
        {group.status === 'paused' && group.pauseReason && (
          <div className="flex items-start gap-1 text-xs text-yellow-600 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-950/30 p-2 rounded">
            <Pause className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{group.pauseReason}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="outline" size="sm" onClick={handleEdit}>
            Edit
          </Button>
          {group.status === 'active' && (
            <>
              <Button variant="outline" size="sm" onClick={handlePause}>
                <Pause className="h-3 w-3 mr-1" />
                Pause
              </Button>
              <Button variant="outline" size="sm" onClick={handleComplete}>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Complete
              </Button>
            </>
          )}
          {group.status === 'paused' && (
            <Button variant="outline" size="sm" onClick={handleResume}>
              <Play className="h-3 w-3 mr-1" />
              Resume
            </Button>
          )}
        </div>

        {/* Timestamps */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>Updated {new Date(group.updated_at).toLocaleDateString()}</span>
          </div>
          {group.closed_at && (
            <span>Closed {new Date(group.closed_at).toLocaleDateString()}</span>
          )}
        </div>
      </div>
    </Card>
  )
}
