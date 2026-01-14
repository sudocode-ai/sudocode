import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

/**
 * Settings for the Nexus view visualization
 */
export interface NexusSettings {
  /** Include symbol nodes (functions, classes, etc.) */
  includeSymbols: boolean
}

/**
 * Default settings for Nexus view
 */
export const DEFAULT_NEXUS_SETTINGS: NexusSettings = {
  includeSymbols: true,
}

interface NexusSettingsDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Current settings */
  settings: NexusSettings
  /** Callback when settings change */
  onSettingsChange: (settings: NexusSettings) => void
}

/**
 * Dialog for configuring Nexus view settings
 */
export function NexusSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: NexusSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nexus View Settings</DialogTitle>
          <DialogDescription>
            Configure how the code visualization is displayed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Symbols Toggle */}
          <div className="flex items-center justify-between space-x-4">
            <div className="flex-1 space-y-1">
              <Label htmlFor="include-symbols" className="text-sm font-medium">
                Show Symbols
              </Label>
              <p className="text-xs text-muted-foreground">
                Display functions, classes, and other code symbols on the map.
              </p>
            </div>
            <Switch
              id="include-symbols"
              checked={settings.includeSymbols}
              onCheckedChange={(checked) =>
                onSettingsChange({ ...settings, includeSymbols: checked })
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
