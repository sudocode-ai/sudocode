import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ExecutionConfig } from '@/types/execution'

interface AgentSettingsDialogProps {
  open: boolean
  config: ExecutionConfig
  onConfigChange: (updates: Partial<ExecutionConfig>) => void
  onClose: () => void
}

export function AgentSettingsDialog({
  open,
  config,
  onConfigChange,
  onClose,
}: AgentSettingsDialogProps) {
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => {
          // Stop propagation to prevent parent components (like IssuePanel) from handling the click
          // But don't preventDefault so the dialog can still close
          e.stopPropagation()
        }}
      >
        <DialogHeader>
          <DialogTitle>Advanced Agent Settings</DialogTitle>
          <DialogDescription>
            Configure advanced execution parameters for fine-tuned control.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="timeout">Timeout (ms)</Label>
            <input
              id="timeout"
              type="number"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={config.timeout ?? ''}
              onChange={(e) =>
                onConfigChange({
                  timeout: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              placeholder="No timeout"
            />
            <p className="text-xs text-muted-foreground">
              Maximum execution time in milliseconds. Leave empty for no timeout.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxTokens">Max Tokens</Label>
            <input
              id="maxTokens"
              type="number"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={config.maxTokens ?? ''}
              onChange={(e) =>
                onConfigChange({
                  maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              placeholder="Model default"
            />
            <p className="text-xs text-muted-foreground">
              Maximum number of tokens to generate. Leave empty to use model default.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="temperature">Temperature</Label>
            <input
              id="temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={config.temperature ?? ''}
              onChange={(e) =>
                onConfigChange({
                  temperature: e.target.value ? parseFloat(e.target.value) : undefined,
                })
              }
              placeholder="Model default"
            />
            <p className="text-xs text-muted-foreground">
              Controls randomness (0-2). Lower is more focused, higher is more creative.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
