import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTheme } from '@/contexts/ThemeContext'
import { Sun, Moon, Play, Square, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import axios from 'axios'
import { Button } from '@/components/ui/button'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface VersionInfo {
  cli: string
  server: string
  frontend: string
}

interface SchedulerStatus {
  enabled: boolean
  activeExecutions: number
  maxConcurrency: number
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null)
  const [schedulerLoading, setSchedulerLoading] = useState(false)

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const fetchSchedulerStatus = async () => {
    try {
      const response = await axios.get('/api/scheduler/status')
      if (response.data.success) {
        setSchedulerStatus(response.data.data)
      }
    } catch (error) {
      console.error('Failed to fetch scheduler status:', error)
    }
  }

  const toggleScheduler = async () => {
    if (!schedulerStatus) return

    setSchedulerLoading(true)
    try {
      const endpoint = schedulerStatus.enabled ? '/api/scheduler/stop' : '/api/scheduler/start'
      const response = await axios.post(endpoint)

      if (response.data.success) {
        // Refresh status
        await fetchSchedulerStatus()
      }
    } catch (error) {
      console.error('Failed to toggle scheduler:', error)
    } finally {
      setSchedulerLoading(false)
    }
  }

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const response = await axios.get<VersionInfo>('/api/version')
        setVersions(response.data)
      } catch (error) {
        console.error('Failed to fetch version information:', error)
      }
    }

    if (isOpen) {
      fetchVersions()
      fetchSchedulerStatus()
    }
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Scheduler Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Autonomous Execution
              </h3>
              <Button
                onClick={toggleScheduler}
                disabled={schedulerLoading || !schedulerStatus}
                variant={schedulerStatus?.enabled ? "destructive" : "default"}
                size="sm"
              >
                {schedulerLoading ? (
                  <span>Loading...</span>
                ) : schedulerStatus?.enabled ? (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start
                  </>
                )}
              </Button>
            </div>

            {schedulerStatus && (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={cn(
                    "font-medium",
                    schedulerStatus.enabled ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                  )}>
                    {schedulerStatus.enabled ? "Running" : "Stopped"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Active Executions</span>
                  <span className="font-mono">
                    {schedulerStatus.activeExecutions} / {schedulerStatus.maxConcurrency}
                  </span>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              The scheduler automatically executes ready issues based on priority and dependencies.
            </p>
          </div>

          {/* Theme Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Appearance</h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Theme</span>
              <button
                onClick={toggleTheme}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  'bg-accent text-foreground hover:bg-accent/80'
                )}
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="h-4 w-4" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4" />
                    <span>Dark Mode</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Version Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Version</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">CLI</span>
                <span className="text-sm text-foreground font-mono">
                  {versions?.cli ?? 'Loading...'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Server</span>
                <span className="text-sm text-foreground font-mono">
                  {versions?.server ?? 'Loading...'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Frontend</span>
                <span className="text-sm text-foreground font-mono">
                  {versions?.frontend ?? 'Loading...'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
