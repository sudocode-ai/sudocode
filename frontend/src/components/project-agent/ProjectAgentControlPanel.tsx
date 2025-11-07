/**
 * ProjectAgentControlPanel Component
 *
 * Control panel for managing the project agent:
 * - Start/stop project agent
 * - View status and metrics
 * - Configure settings
 * - Monitor activity
 */

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Play,
  Square,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Settings,
  Eye
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ProjectAgentStatus {
  status: 'running' | 'stopped' | 'error'
  execution_id: string | null
  uptime_seconds: number
  mode: 'monitoring' | 'planning' | 'full' | null
  worktree_path: string | null
  activity: {
    last_event_processed: string | null
    events_processed: number
    actions_proposed: number
    actions_approved: number
  }
  monitoring: {
    watching_executions: string[]
    next_check: string | null
  }
}

interface ProjectAgentControlPanelProps {
  /**
   * Custom class name
   */
  className?: string
}

/**
 * ProjectAgentControlPanel Component
 *
 * @example
 * ```tsx
 * <ProjectAgentControlPanel />
 * ```
 */
export function ProjectAgentControlPanel({ className = '' }: ProjectAgentControlPanelProps) {
  const [status, setStatus] = useState<ProjectAgentStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  // Fetch project agent status
  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/project-agent/status')
      if (!response.ok) {
        throw new Error('Failed to fetch project agent status')
      }
      const data = await response.json()
      setStatus(data.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Error fetching project agent status:', err)
    }
  }

  // Start project agent
  const handleStart = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/project-agent/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            mode: 'monitoring',
            autoApprove: {
              enabled: false,
              allowedActions: [],
            },
            monitoring: {
              watchExecutions: true,
              checkInterval: 60000,
            },
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to start project agent')
      }

      toast({
        title: 'Project Agent Started',
        description: 'Project agent is now monitoring your project.',
      })

      await fetchStatus()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      toast({
        title: 'Failed to Start',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Stop project agent
  const handleStop = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/project-agent/stop', {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to stop project agent')
      }

      toast({
        title: 'Project Agent Stopped',
        description: 'Project agent has been stopped.',
      })

      await fetchStatus()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      toast({
        title: 'Failed to Stop',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Format uptime
  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  // Poll status every 5 seconds when running
  useEffect(() => {
    fetchStatus()

    const interval = setInterval(() => {
      if (status?.status === 'running') {
        fetchStatus()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [status?.status])

  const isRunning = status?.status === 'running'
  const isStopped = status?.status === 'stopped'

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Project Agent
            </CardTitle>
            <CardDescription>
              Autonomous project monitoring and management
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Badge variant="default" className="flex items-center gap-1">
                <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                Running
              </Badge>
            )}
            {isStopped && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <div className="h-2 w-2 bg-gray-400 rounded-full" />
                Stopped
              </Badge>
            )}
            {status?.status === 'error' && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Error
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Status Details */}
        {status && isRunning && (
          <div className="space-y-3">
            {/* Uptime */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                Uptime
              </div>
              <span className="font-mono">{formatUptime(status.uptime_seconds)}</span>
            </div>

            {/* Mode */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Eye className="h-4 w-4" />
                Mode
              </div>
              <Badge variant="outline">{status.mode || 'monitoring'}</Badge>
            </div>

            {/* Activity Metrics */}
            <div className="border-t pt-3 space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground">Activity</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-2xl font-bold">{status.activity.events_processed}</div>
                  <div className="text-xs text-muted-foreground">Events</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{status.activity.actions_proposed}</div>
                  <div className="text-xs text-muted-foreground">Proposed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{status.activity.actions_approved}</div>
                  <div className="text-xs text-muted-foreground">Approved</div>
                </div>
              </div>
            </div>

            {/* Last Activity */}
            {status.activity.last_event_processed && (
              <div className="text-xs text-muted-foreground">
                Last activity: {new Date(status.activity.last_event_processed).toLocaleString()}
              </div>
            )}

            {/* Execution ID */}
            {status.execution_id && (
              <div className="text-xs font-mono text-muted-foreground">
                ID: {status.execution_id}
              </div>
            )}
          </div>
        )}

        {/* Stopped State */}
        {isStopped && (
          <div className="text-center py-6 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Project agent is not running</p>
            <p className="text-xs mt-1">
              Start the agent to begin monitoring your project
            </p>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          {isStopped && (
            <Button
              onClick={handleStart}
              disabled={loading}
              className="flex-1"
            >
              {loading ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Agent
                </>
              )}
            </Button>
          )}

          {isRunning && (
            <Button
              onClick={handleStop}
              disabled={loading}
              variant="destructive"
              className="flex-1"
            >
              {loading ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Stopping...
                </>
              ) : (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Stop Agent
                </>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={fetchStatus}
            disabled={loading}
          >
            <Activity className="h-4 w-4" />
          </Button>

          {/* TODO: Settings button for future configuration UI */}
          {/* <Button
            variant="outline"
            size="icon"
            disabled
          >
            <Settings className="h-4 w-4" />
          </Button> */}
        </div>

        {/* Info Text */}
        <div className="text-xs text-muted-foreground border-t pt-3">
          <p>
            The project agent monitors your specs, issues, and executions,
            proposing helpful actions to keep your project moving forward.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
