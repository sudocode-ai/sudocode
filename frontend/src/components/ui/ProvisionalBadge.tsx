/**
 * ProvisionalBadge Component
 *
 * Visual indicator for provisional vs committed state in CRDT-synchronized entities.
 * Shows whether data is in provisional/temp state or committed to the database.
 */

import { Badge } from '@/components/ui/badge'
import { Loader2, FileCheck, FilePenLine } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ProvisionalState = 'provisional' | 'committed' | 'syncing' | 'modified'

interface ProvisionalBadgeProps {
  /**
   * State of the entity
   * - provisional: Entity has uncommitted changes in CRDT
   * - committed: Entity is committed to database
   * - syncing: Entity is being synchronized
   * - modified: Entity has been modified (generic state)
   */
  state: ProvisionalState

  /**
   * Agent or user who made the modification (optional)
   */
  modifiedBy?: string

  /**
   * Show label text (default: true)
   */
  showLabel?: boolean

  /**
   * Custom class name
   */
  className?: string

  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg'
}

/**
 * ProvisionalBadge Component
 *
 * @example
 * ```tsx
 * // Provisional state
 * <ProvisionalBadge state="provisional" modifiedBy="agent-123" />
 *
 * // Committed state
 * <ProvisionalBadge state="committed" />
 *
 * // Syncing state
 * <ProvisionalBadge state="syncing" showLabel={false} />
 *
 * // Small size
 * <ProvisionalBadge state="provisional" size="sm" />
 * ```
 */
export function ProvisionalBadge({
  state,
  modifiedBy,
  showLabel = true,
  className,
  size = 'md',
}: ProvisionalBadgeProps) {
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-1 gap-1.5',
    lg: 'text-sm px-2.5 py-1.5 gap-2',
  }

  const iconSizes = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3 w-3',
    lg: 'h-3.5 w-3.5',
  }

  // State-specific styling
  const stateConfig = {
    provisional: {
      variant: 'outline' as const,
      className: 'border-orange-500 text-orange-700 dark:text-orange-400 border-dashed',
      icon: <FilePenLine className={iconSizes[size]} />,
      label: 'Provisional',
    },
    committed: {
      variant: 'outline' as const,
      className: 'border-green-600 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950',
      icon: <FileCheck className={iconSizes[size]} />,
      label: 'Committed',
    },
    syncing: {
      variant: 'outline' as const,
      className: 'border-blue-500 text-blue-700 dark:text-blue-400',
      icon: <Loader2 className={cn(iconSizes[size], 'animate-spin')} />,
      label: 'Syncing',
    },
    modified: {
      variant: 'secondary' as const,
      className: 'border-yellow-500 text-yellow-700 dark:text-yellow-400',
      icon: <FilePenLine className={iconSizes[size]} />,
      label: 'Modified',
    },
  }

  const config = stateConfig[state]

  return (
    <Badge
      variant={config.variant}
      className={cn(
        'flex items-center font-normal',
        sizeClasses[size],
        config.className,
        className
      )}
    >
      {config.icon}
      {showLabel && (
        <span>
          {config.label}
          {modifiedBy && (
            <span className="ml-1 opacity-75">
              by {modifiedBy}
            </span>
          )}
        </span>
      )}
    </Badge>
  )
}

/**
 * Inline provisional status indicator (minimal)
 * Shows a small colored dot with optional label
 */
export function InlineProvisionalStatus({
  state,
  className,
}: {
  state: ProvisionalState
  className?: string
}) {
  const statusConfig = {
    provisional: {
      color: 'bg-orange-500',
      label: 'Provisional',
    },
    committed: {
      color: 'bg-green-600',
      label: 'Committed',
    },
    syncing: {
      color: 'bg-blue-500 animate-pulse',
      label: 'Syncing',
    },
    modified: {
      color: 'bg-yellow-500',
      label: 'Modified',
    },
  }

  const config = statusConfig[state]

  return (
    <div className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <div className={cn('h-2 w-2 rounded-full', config.color)} />
      <span>{config.label}</span>
    </div>
  )
}
