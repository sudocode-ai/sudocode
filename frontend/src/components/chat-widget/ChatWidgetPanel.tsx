import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChatWidgetPanelProps {
  children: ReactNode
  onClose: () => void
  className?: string
}

export function ChatWidgetPanel({ children, onClose, className }: ChatWidgetPanelProps) {
  // Prevent body scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 transition-opacity animate-in fade-in-0 duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50',
          'flex w-full max-w-md flex-col',
          'border-l border-border bg-background',
          'shadow-lg',
          // Animation
          'animate-in slide-in-from-right duration-300',
          className
        )}
        role="dialog"
        aria-label="Assistant panel"
      >
        {children}
      </div>
    </>
  )
}
