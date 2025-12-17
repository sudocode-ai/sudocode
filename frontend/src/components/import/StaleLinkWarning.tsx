/**
 * StaleLinkWarning - Show when external entity no longer exists
 *
 * Displays a warning banner when the external link is marked as stale
 * (external entity was deleted), with options to unlink or dismiss.
 */

import { AlertTriangle, Unlink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ProviderIcon, getProviderDisplayName } from './ProviderIcon'
import type { ExternalLink } from '@sudocode-ai/types'

export interface StaleLinkWarningProps {
  /** The stale external link */
  link: ExternalLink
  /** Callback when user chooses to unlink */
  onUnlink: () => void
  /** Callback when user dismisses the warning */
  onDismiss: () => void
  /** Whether unlink operation is in progress */
  isUnlinking?: boolean
}

/**
 * Warning shown when external entity no longer exists
 */
export function StaleLinkWarning({
  link,
  onUnlink,
  onDismiss,
  isUnlinking = false,
}: StaleLinkWarningProps) {
  const providerName = getProviderDisplayName(link.provider)

  // Get stale reason if available
  const staleReason = link.metadata?.stale_reason as string | undefined
  const staleAt = link.metadata?.stale_at as string | undefined

  let message = 'The external entity linked to this item no longer exists.'
  if (staleReason === 'external_entity_not_found') {
    message = `The ${providerName} entity (${link.external_id}) was not found. It may have been deleted.`
  } else if (staleReason === 'fetch_failed_404') {
    message = `Could not fetch the ${providerName} entity (${link.external_id}). It may have been deleted or made private.`
  }

  return (
    <Card className="border-yellow-500/50 bg-yellow-500/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
        <div className="flex-1">
          <div className="flex items-center gap-2 font-medium text-yellow-900 dark:text-yellow-100">
            <ProviderIcon provider={link.provider} size="sm" />
            External Link Stale
          </div>
          <p className="mt-2 text-sm text-yellow-800 dark:text-yellow-200">{message}</p>
          {staleAt && (
            <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
              Detected {new Date(staleAt).toLocaleString()}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onUnlink}
              disabled={isUnlinking}
              className="border-yellow-600/50 bg-yellow-500/20 text-yellow-900 hover:bg-yellow-500/30 dark:text-yellow-100"
            >
              <Unlink className="mr-2 h-3.5 w-3.5" />
              {isUnlinking ? 'Unlinking...' : 'Remove Link'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              disabled={isUnlinking}
              className="text-yellow-800 hover:bg-yellow-500/20 hover:text-yellow-900 dark:text-yellow-200 dark:hover:text-yellow-100"
            >
              <X className="mr-2 h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
