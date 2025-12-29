import { BotMessageSquare, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ChatWidgetFABProps {
  onClick: () => void
  isOpen: boolean
  isRunning?: boolean
  hasNotification?: boolean
}

export function ChatWidgetFAB({
  onClick,
  isOpen,
  isRunning = false,
  hasNotification = false,
}: ChatWidgetFABProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'fixed bottom-6 right-6 z-40',
            'h-12 w-12 rounded-full p-0',
            // Neutral, subtle background with depth
            'bg-gradient-to-b from-muted/90 to-muted',
            'text-muted-foreground',
            // Skeuomorphic shadows - outer shadow + subtle inner highlight
            'shadow-[0_4px_12px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]',
            // Border for definition
            'border border-border/50',
            // Hover: lift effect with enhanced shadow
            'hover:shadow-[0_6px_16px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.15)]',
            'hover:border-border hover:text-foreground',
            'hover:-translate-y-0.5',
            // Active: pressed effect
            'active:translate-y-0 active:shadow-[0_2px_8px_rgba(0,0,0,0.12),inset_0_1px_2px_rgba(0,0,0,0.1)]',
            // Smooth transitions
            'transition-all duration-200 ease-out',
            // Focus ring
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isOpen && 'scale-95 opacity-75'
          )}
          aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
        >
          <div className="relative flex items-center justify-center">
            {isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <BotMessageSquare className="h-5 w-5" />
            )}

            {/* Notification dot for unseen executions */}
            {hasNotification && (
              <span
                className={cn(
                  'absolute -right-0.5 -top-2',
                  'h-3 w-3 rounded-full',
                  'bg-blue-500',
                  'shadow-[0_0_4px_rgba(59,130,246,0.5)]',
                  'animate-pulse',
                  // White border for visibility
                  'border-2 border-background'
                )}
              />
            )}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="mr-2">
        <p>
          {isOpen ? 'Close' : 'Open'} Assistant{' '}
          <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+J
          </kbd>
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
