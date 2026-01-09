import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  Clock,
  PauseCircle,
} from 'lucide-react'
import type { Execution } from '@/types/execution'

interface ExecutionStatusBadgeProps {
  status: Execution['status']
  className?: string
}

export function ExecutionStatusBadge({ status, className }: ExecutionStatusBadgeProps) {
  switch (status) {
    case 'preparing':
      return (
        <Badge variant="secondary" className={`flex items-center gap-1 ${className ?? ''}`}>
          <Clock className="h-3 w-3" />
          Preparing
        </Badge>
      )
    case 'pending':
      return (
        <Badge variant="secondary" className={`flex items-center gap-1 ${className ?? ''}`}>
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      )
    case 'running':
      return (
        <Badge variant="default" className={`flex items-center gap-1 ${className ?? ''}`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </Badge>
      )
    case 'paused':
      return (
        <Badge variant="outline" className={`flex items-center gap-1 ${className ?? ''}`}>
          <PauseCircle className="h-3 w-3" />
          Paused
        </Badge>
      )
    case 'completed':
      return (
        <Badge variant="default" className={`flex items-center gap-1 bg-green-600 ${className ?? ''}`}>
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="destructive" className={`flex items-center gap-1 ${className ?? ''}`}>
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      )
    case 'cancelled':
      return (
        <Badge variant="secondary" className={`flex items-center gap-1 ${className ?? ''}`}>
          <X className="h-3 w-3" />
          Cancelled
        </Badge>
      )
    case 'stopped':
      return (
        <Badge variant="secondary" className={`flex items-center gap-1 ${className ?? ''}`}>
          <X className="h-3 w-3" />
          Stopped
        </Badge>
      )
    case 'conflicted':
      return (
        <Badge variant="destructive" className={`flex items-center gap-1 bg-orange-500 ${className ?? ''}`}>
          <AlertTriangle className="h-3 w-3" />
          Conflicted
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary" className={`flex items-center gap-1 ${className ?? ''}`}>
          <AlertCircle className="h-3 w-3" />
          {String(status).charAt(0).toUpperCase() + String(status).slice(1)}
        </Badge>
      )
  }
}
