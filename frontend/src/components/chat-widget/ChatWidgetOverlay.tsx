import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChatWidgetOverlayProps {
  children: ReactNode
  className?: string
}

export function ChatWidgetOverlay({ children, className }: ChatWidgetOverlayProps) {
  return (
    <div
      className={cn(
        'fixed z-[45]',
        'bottom-6 right-6', // Same position as FAB (replaces it)
        'w-[420px]',
        'h-[calc(100vh-7rem)]', // Fixed viewport-based height for proper scrolling
        'flex flex-col overflow-hidden',
        // Slightly elevated background using theme colors
        'bg-white dark:bg-card',
        'border border-border',
        'rounded-lg',
        'shadow-2xl',
        // Animation
        'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2',
        'duration-200',
        className
      )}
      role="dialog"
      aria-label="Assistant chat"
    >
      {children}
    </div>
  )
}
