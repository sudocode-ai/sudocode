/**
 * RefreshConflictDialog - Show when refresh has conflicts with local changes
 *
 * Displays a dialog showing field-level changes between local and remote
 * versions, with options to keep local changes or overwrite with remote.
 */

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertTriangle, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FieldChange {
  field: string
  localValue: string
  remoteValue: string
}

export interface RefreshConflictDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Field-level changes between local and remote */
  changes: FieldChange[]
  /** Callback when user chooses to keep local changes */
  onKeepLocal: () => void
  /** Callback when user chooses to overwrite with remote changes */
  onOverwrite: () => void
  /** Callback when dialog is cancelled */
  onCancel: () => void
  /** Whether overwrite operation is in progress */
  isOverwriting?: boolean
}

/**
 * Truncate text for preview display
 */
function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * Count lines changed between two strings
 */
function countLinesChanged(local: string, remote: string): number {
  const localLines = local.split('\n').length
  const remoteLines = remote.split('\n').length
  return Math.abs(localLines - remoteLines) + Math.min(localLines, remoteLines)
}

/**
 * Individual change item component
 */
function ChangeItem({ change }: { change: FieldChange }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isContentField = change.field === 'content'
  const linesChanged = isContentField ? countLinesChanged(change.localValue, change.remoteValue) : 0

  return (
    <div className="rounded-lg border bg-card p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize">{change.field}</span>
          {isContentField && (
            <Badge variant="secondary" className="text-xs">
              ~{linesChanged} lines
            </Badge>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {!isExpanded && (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="line-through">{truncateText(change.localValue, 50)}</span>
          <ArrowRight className="h-3 w-3 flex-shrink-0" />
          <span className="text-foreground">{truncateText(change.remoteValue, 50)}</span>
        </div>
      )}

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* Local (current) value */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Local (will be lost)
            </div>
            <ScrollArea className={cn('rounded border bg-muted/50 p-2', isContentField && 'h-32')}>
              <pre className="whitespace-pre-wrap font-mono text-xs">{change.localValue || '(empty)'}</pre>
            </ScrollArea>
          </div>

          {/* Remote (incoming) value */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Remote (will be applied)
            </div>
            <ScrollArea className={cn('rounded border bg-muted/50 p-2', isContentField && 'h-32')}>
              <pre className="whitespace-pre-wrap font-mono text-xs">{change.remoteValue || '(empty)'}</pre>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Show when refresh has conflicts with local changes
 */
export function RefreshConflictDialog({
  open,
  changes,
  onKeepLocal,
  onOverwrite,
  onCancel,
  isOverwriting = false,
}: RefreshConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Refresh Conflict
          </DialogTitle>
          <DialogDescription>
            Local changes detected since last sync. Refreshing will overwrite these changes:
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] pr-4">
          <div className="space-y-3">
            {changes.map((change) => (
              <ChangeItem key={change.field} change={change} />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={isOverwriting}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onKeepLocal} disabled={isOverwriting}>
            Keep Local
          </Button>
          <Button variant="destructive" onClick={onOverwrite} disabled={isOverwriting}>
            {isOverwriting ? 'Overwriting...' : 'Overwrite with Remote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
