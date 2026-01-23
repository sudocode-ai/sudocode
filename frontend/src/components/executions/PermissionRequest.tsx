/**
 * PermissionRequest Component
 *
 * Inline permission request component for ACP interactive mode.
 * Renders with an orange pulsing dot and supports keyboard navigation.
 *
 * @module components/executions/PermissionRequest
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PermissionRequest as PermissionRequestType,
  PermissionOption,
} from '@/types/permissions'

export interface PermissionRequestProps {
  /**
   * The permission request to display
   */
  request: PermissionRequestType

  /**
   * Callback when user responds to the permission request
   */
  onRespond: (requestId: string, optionId: string) => void

  /**
   * Callback when user wants to skip all remaining permissions
   * If provided, shows a "Skip All" button that restarts execution with auto-approve
   */
  onSkipAll?: () => void

  /**
   * Whether skip-all action is in progress
   */
  isSkippingAll?: boolean

  /**
   * Optional class name
   */
  className?: string

  /**
   * Whether to auto-focus on mount (default: true)
   */
  autoFocus?: boolean
}

/**
 * Get display label for permission option kind
 */
function getKindLabel(kind: PermissionOption['kind']): string {
  switch (kind) {
    case 'allow_once':
      return 'Allow'
    case 'allow_always':
      return 'Always'
    case 'deny_once':
      return 'Deny'
    case 'deny_always':
      return 'Never'
    default:
      return kind
  }
}

/**
 * Get button style classes based on option kind
 */
function getOptionStyles(kind: PermissionOption['kind'], isSelected: boolean): string {
  const base =
    'px-1.5 py-0.5 text-xs font-medium rounded border transition-all focus:outline-none focus:ring-2 focus:ring-offset-1'

  if (isSelected) {
    switch (kind) {
      case 'allow_once':
      case 'allow_always':
        return `${base} bg-green-600 text-white border-green-600 focus:ring-green-500`
      case 'deny_once':
      case 'deny_always':
        return `${base} bg-red-600 text-white border-red-600 focus:ring-red-500`
      default:
        return `${base} bg-primary text-primary-foreground border-primary focus:ring-primary`
    }
  }

  switch (kind) {
    case 'allow_once':
    case 'allow_always':
      return `${base} bg-green-50 text-green-700 border-green-300 hover:bg-green-100 focus:ring-green-500 dark:bg-green-950 dark:text-green-300 dark:border-green-700 dark:hover:bg-green-900`
    case 'deny_once':
    case 'deny_always':
      return `${base} bg-red-50 text-red-700 border-red-300 hover:bg-red-100 focus:ring-red-500 dark:bg-red-950 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900`
    default:
      return `${base} bg-muted text-muted-foreground border-border hover:bg-muted/80 focus:ring-primary`
  }
}

/**
 * Format tool input for display
 */
function formatToolInput(rawInput: unknown): string | null {
  if (!rawInput) return null

  try {
    const parsed = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput
    if (!parsed || typeof parsed !== 'object') {
      return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput)
    }

    // For Bash, show the command
    if (parsed.command) {
      const cmd = parsed.command as string
      return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd
    }

    // For file operations, show the path
    if (parsed.file_path) {
      return parsed.file_path as string
    }

    // For Read, show the path
    if (parsed.path) {
      return parsed.path as string
    }

    return JSON.stringify(parsed).slice(0, 80)
  } catch {
    return typeof rawInput === 'string' ? rawInput.slice(0, 80) : null
  }
}

/**
 * PermissionRequest Component
 *
 * Displays a permission request inline with the agent trajectory.
 * Uses an orange pulsing dot to indicate a pending action.
 * Supports keyboard navigation (arrow keys + Enter) and click.
 *
 * @example
 * ```tsx
 * <PermissionRequest
 *   request={permissionRequest}
 *   onRespond={(requestId, optionId) => {
 *     respondToPermission(requestId, optionId)
 *   }}
 * />
 * ```
 */
export function PermissionRequest({
  request,
  onRespond,
  onSkipAll,
  isSkippingAll = false,
  className = '',
  autoFocus = true,
}: PermissionRequestProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const { requestId, toolCall, options, responded, selectedOptionId } = request

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (responded) return

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1))
          break
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0))
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (options[selectedIndex]) {
            onRespond(requestId, options[selectedIndex].optionId)
          }
          break
      }
    },
    [responded, options, selectedIndex, onRespond, requestId]
  )

  // Focus selected button when selection changes
  useEffect(() => {
    if (!responded && buttonRefs.current[selectedIndex]) {
      buttonRefs.current[selectedIndex]?.focus()
    }
  }, [selectedIndex, responded])

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && !responded && buttonRefs.current[0]) {
      buttonRefs.current[0]?.focus()
    }
  }, [autoFocus, responded])

  const toolInput = formatToolInput(toolCall.rawInput)

  if (responded) {
    // Show responded state
    const selectedOption = options.find((o) => o.optionId === selectedOptionId)
    return (
      <div className={`group ${className}`}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 select-none text-green-600">⏺</span>
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{toolCall.title}</span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                {selectedOption?.name ?? selectedOptionId}
              </span>
            </div>
            {toolInput && (
              <div className="mt-0.5 flex items-start gap-2">
                <span className="select-none text-muted-foreground">∟</span>
                <span className="text-xs text-muted-foreground">{toolInput}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Show "skipping" state when Skip All is in progress
  if (isSkippingAll) {
    return (
      <div className={`group ${className}`}>
        <div className="flex items-start gap-2">
          {/* Amber dot with pulse animation for skipping state */}
          <span className="mt-0.5 animate-pulse select-none text-amber-500">⏺</span>
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{toolCall.title}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                Restarting with auto-approve...
              </span>
            </div>
            {toolInput && (
              <div className="mt-0.5 flex items-start gap-2">
                <span className="select-none text-muted-foreground">∟</span>
                <span className="text-xs text-muted-foreground">{toolInput}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`group ${className}`}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label={`Permission request for ${toolCall.title}`}
    >
      <div className="flex items-start gap-2">
        {/* Orange pulsing dot for pending permission */}
        <span className="mt-0.5 animate-pulse select-none text-orange-500">⏺</span>
        <div className="min-w-0 flex-1 py-0.5">
          {/* Tool call title and input */}
          <div className="flex items-center gap-2">
            <span className="font-semibold">{toolCall.title}</span>
            <span className="text-xs text-orange-600 dark:text-orange-400">
              awaiting permission
            </span>
          </div>
          {toolInput && (
            <div className="mt-0.5 flex items-start gap-2">
              <span className="select-none text-muted-foreground">∟</span>
              <span className="text-xs text-muted-foreground">{toolInput}</span>
            </div>
          )}

          {/* Permission options */}
          <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Permission options">
            {options.map((option, index) => (
              <button
                key={option.optionId}
                ref={(el) => {
                  buttonRefs.current[index] = el
                }}
                type="button"
                className={getOptionStyles(option.kind, selectedIndex === index)}
                onClick={() => onRespond(requestId, option.optionId)}
                onFocus={() => setSelectedIndex(index)}
                aria-pressed={selectedIndex === index}
                tabIndex={selectedIndex === index ? 0 : -1}
              >
                {option.name || getKindLabel(option.kind)}
              </button>
            ))}

            {/* Skip All button - shows if onSkipAll callback is provided */}
            {onSkipAll && (
              <>
                <span className="text-muted-foreground">|</span>
                <button
                  type="button"
                  onClick={onSkipAll}
                  className="px-1.5 py-0.5 text-xs font-medium rounded border transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 focus:ring-amber-500 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700 dark:hover:bg-amber-900"
                  title="Restart execution with all permissions auto-approved"
                >
                  Skip All
                </button>
              </>
            )}
          </div>

          {/* Keyboard hints */}
          <div className="mt-1 text-xs text-muted-foreground">
            Use <kbd className="rounded border bg-muted px-1">←</kbd>{' '}
            <kbd className="rounded border bg-muted px-1">→</kbd> to navigate,{' '}
            <kbd className="rounded border bg-muted px-1">Enter</kbd> to select
          </div>
        </div>
      </div>
    </div>
  )
}
