/**
 * SyncIndicator - Shows integration sync status on issue/spec cards
 * Displays a badge indicating the entity is synced with external integrations
 */

import { Link } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ExternalLink } from '@sudocode-ai/types'

const variantStyles = {
  issue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  spec: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
}

export interface SyncIndicatorProps {
  /** External links showing sync status */
  externalLinks: ExternalLink[]
  /** Color variant - matches entity type */
  variant?: 'issue' | 'spec'
  /** Optional className */
  className?: string
}

export function SyncIndicator({ externalLinks, variant = 'issue', className }: SyncIndicatorProps) {
  if (!externalLinks || externalLinks.length === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full p-1',
              variantStyles[variant],
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
