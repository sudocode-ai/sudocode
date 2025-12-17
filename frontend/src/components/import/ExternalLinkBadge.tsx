/**
 * ExternalLinkBadge - Display external link info with refresh capability
 *
 * Shows provider icon, external URL link, last synced timestamp,
 * and a refresh button to sync from external source.
 */

import { formatDistanceToNow } from 'date-fns'
import { ExternalLink as ExternalLinkIcon, RefreshCw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ProviderIcon, getProviderDisplayName } from './ProviderIcon'
import type { ExternalLink } from '@sudocode-ai/types'

export interface ExternalLinkBadgeProps {
  /** The external link to display */
  link: ExternalLink
  /** Callback when refresh button is clicked */
  onRefresh: () => void
  /** Whether refresh is in progress */
  isRefreshing?: boolean
  /** Optional className */
  className?: string
}

/**
 * Display external link info on entity detail page with refresh capability
 */
export function ExternalLinkBadge({
  link,
  onRefresh,
  isRefreshing = false,
  className,
}: ExternalLinkBadgeProps) {
  const providerName = getProviderDisplayName(link.provider)

  // Format the last synced timestamp
  const lastSynced = link.last_synced_at
    ? formatDistanceToNow(
        new Date(link.last_synced_at.endsWith('Z') ? link.last_synced_at : link.last_synced_at + 'Z'),
        { addSuffix: true }
      )
    : null

  // Check if link is stale
  const isStale = link.metadata?.stale === true

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2',
        isStale && 'border-yellow-500/50 bg-yellow-500/10',
        className
      )}
    >
      {/* Provider icon and name */}
      <div className="flex items-center gap-1.5">
        <ProviderIcon provider={link.provider} size="sm" />
        <span className="text-sm font-medium">{providerName}</span>
      </div>

      {/* External ID / URL */}
      <Badge variant="secondary" className="font-mono text-xs">
        {link.external_id}
      </Badge>

      {/* External URL link */}
      {link.external_url && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={link.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Open in {providerName}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Last synced timestamp */}
      {lastSynced && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{lastSynced}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Last synced: {new Date(link.last_synced_at!).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Refresh button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isRefreshing ? 'Refreshing...' : 'Refresh from source'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
