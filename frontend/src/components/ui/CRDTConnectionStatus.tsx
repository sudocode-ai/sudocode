/**
 * CRDT Connection Status Indicator
 *
 * Global status indicator for CRDT coordinator connection.
 * Shows connection state and provides visual feedback.
 */

import { useCRDT } from '@/contexts/CRDTContext'
import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CRDTConnectionStatusProps {
  className?: string
  showLabel?: boolean
}

/**
 * CRDT Connection Status Component
 *
 * Displays current CRDT coordinator connection status with visual indicator.
 *
 * @example
 * ```tsx
 * // With label
 * <CRDTConnectionStatus showLabel />
 *
 * // Icon only
 * <CRDTConnectionStatus />
 * ```
 */
export function CRDTConnectionStatus({
  className,
  showLabel = false,
}: CRDTConnectionStatusProps) {
  const { connected } = useCRDT()

  if (!showLabel && connected) {
    // Don't show anything if connected and no label requested
    // (only show warnings/errors)
    return null
  }

  return (
    <Badge
      variant={connected ? 'default' : 'outline'}
      className={cn(
        'flex items-center gap-1.5 text-xs',
        connected
          ? 'bg-green-600 hover:bg-green-700'
          : 'border-yellow-600 text-yellow-600',
        className
      )}
    >
      {connected ? (
        <>
          <Wifi className="h-3 w-3" />
          {showLabel && 'CRDT Connected'}
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          {showLabel && 'CRDT Offline'}
        </>
      )}
    </Badge>
  )
}

/**
 * Inline CRDT status for embedding in other components
 */
export function InlineCRDTStatus() {
  const { connected } = useCRDT()

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {connected ? (
        <>
          <div className="h-2 w-2 rounded-full bg-green-600 animate-pulse" />
          <span>Live sync active</span>
        </>
      ) : (
        <>
          <div className="h-2 w-2 rounded-full bg-yellow-600" />
          <span>Local mode</span>
        </>
      )}
    </div>
  )
}
