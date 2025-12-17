import { Github, Box, Cloud } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProviderIconProps {
  provider: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/**
 * Display provider icon based on provider name
 * Falls back to a generic icon for unknown providers
 */
export function ProviderIcon({ provider, className, size = 'md' }: ProviderIconProps) {
  const sizeClass = sizeClasses[size]

  switch (provider.toLowerCase()) {
    case 'github':
      return <Github className={cn(sizeClass, className)} />
    case 'jira':
      // Jira doesn't have a lucide icon, use a styled box
      return (
        <div
          className={cn(
            sizeClass,
            'flex items-center justify-center rounded bg-blue-500 text-white',
            className
          )}
        >
          <span className="text-[0.6em] font-bold">J</span>
        </div>
      )
    case 'linear':
      // Linear uses a distinctive purple/violet color
      return (
        <div
          className={cn(
            sizeClass,
            'flex items-center justify-center rounded bg-violet-500 text-white',
            className
          )}
        >
          <span className="text-[0.6em] font-bold">L</span>
        </div>
      )
    case 'beads':
      return <Box className={cn(sizeClass, className)} />
    case 'notion':
      return (
        <div
          className={cn(
            sizeClass,
            'flex items-center justify-center rounded bg-foreground text-background',
            className
          )}
        >
          <span className="text-[0.6em] font-bold">N</span>
        </div>
      )
    default:
      // Generic cloud/database icon for unknown providers
      return <Cloud className={cn(sizeClass, 'text-muted-foreground', className)} />
  }
}

/**
 * Get display name for a provider
 */
export function getProviderDisplayName(provider: string): string {
  const displayNames: Record<string, string> = {
    github: 'GitHub',
    jira: 'Jira',
    linear: 'Linear',
    beads: 'Beads',
    notion: 'Notion',
  }

  return displayNames[provider.toLowerCase()] || provider
}
