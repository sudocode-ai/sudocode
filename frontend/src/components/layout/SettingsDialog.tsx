import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTheme } from '@/contexts/ThemeContext'
import { Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import axios from 'axios'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface VersionInfo {
  cli: string
  server: string
  frontend: string
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const [versions, setVersions] = useState<VersionInfo | null>(null)

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
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
    }
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
