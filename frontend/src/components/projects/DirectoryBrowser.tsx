import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Folder, FolderOpen, ChevronUp, ChevronRight, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DirectoryBrowserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  title?: string
  description?: string
}

export function DirectoryBrowser({
  open,
  onOpenChange,
  onSelect,
  title = 'Select Directory',
  description = 'Browse and select a directory.',
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [manualPath, setManualPath] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['browse-directory', currentPath],
    queryFn: () => projectsApi.browse(currentPath),
    enabled: open,
  })

  // Update manual path input when navigating
  useEffect(() => {
    if (data?.currentPath) {
      setManualPath(data.currentPath)
    }
  }, [data?.currentPath])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setCurrentPath(undefined)
      setSelectedPath(null)
      setManualPath('')
    }
  }, [open])

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
    setSelectedPath(null)
  }

  const handleSelect = (path: string) => {
    setSelectedPath(path)
    setManualPath(path)
  }

  const handleConfirm = () => {
    const pathToUse = manualPath.trim() || selectedPath
    if (pathToUse) {
      onSelect(pathToUse)
      onOpenChange(false)
    }
  }

  const handleManualPathSubmit = () => {
    if (manualPath.trim()) {
      setCurrentPath(manualPath.trim())
      setSelectedPath(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="w-full space-y-3 overflow-hidden">
          {/* Manual path input */}
          <div className="flex gap-2">
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/path/to/directory"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleManualPathSubmit()
                }
              }}
            />
            <Button variant="outline" size="sm" onClick={handleManualPathSubmit}>
              Go
            </Button>
          </div>

          {/* Directory listing */}
          <div className="w-full overflow-hidden rounded-md border">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex h-64 items-center justify-center text-sm text-destructive">
                Failed to load directory
              </div>
            ) : (
              <ScrollArea className="h-64 w-full">
                <div className="w-full p-2">
                  {/* Parent directory */}
                  {data?.parentPath && (
                    <button
                      onClick={() => handleNavigate(data.parentPath!)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">..</span>
                    </button>
                  )}

                  {/* Directory entries */}
                  {data?.entries.map((entry) => (
                    <div
                      key={entry.path}
                      className={cn(
                        'grid grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50',
                        selectedPath === entry.path && 'bg-accent'
                      )}
                    >
                      <button
                        onClick={() => handleSelect(entry.path)}
                        className="flex min-w-0 items-center gap-2 overflow-hidden text-left"
                      >
                        {entry.hasSudocode ? (
                          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{entry.name}</span>
                        {entry.hasSudocode && (
                          <Check className="h-3 w-3 shrink-0 text-primary" />
                        )}
                      </button>
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => handleNavigate(entry.path)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  ))}

                  {data?.entries.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No subdirectories
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Current selection indicator */}
          {selectedPath && (
            <p className="truncate text-xs text-muted-foreground">
              Selected: <span className="font-medium">{selectedPath}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!manualPath.trim() && !selectedPath}>
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
