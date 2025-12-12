/**
 * SyncIndicator - Shows integration sync status on issue/spec cards
 * Displays a badge indicating the entity is synced with external integrations
 */

import { Link } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ExternalLink } from '@sudocode-ai/types'

export interface SyncIndicatorProps {
  /** External links showing sync status */
  externalLinks: ExternalLink[]
  /** Optional className */
  className?: string
}

export function SyncIndicator({ externalLinks, className }: SyncIndicatorProps) {
  if (!externalLinks || externalLinks.length === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full bg-blue-100 p-1 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
              className
            )}
          >
            <Link className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            {externalLinks.map((link) => (
              <p key={`${link.provider}-${link.external_id}`} className="text-muted-foreground">
                <span className="font-medium">{link.provider}:</span> {link.external_id}
              </p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
