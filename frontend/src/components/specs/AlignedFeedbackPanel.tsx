import { useMemo } from 'react'
import { FeedbackCard } from './FeedbackCard'
import type { IssueFeedback, FeedbackAnchor } from '@/types/api'

interface AlignedFeedbackPanelProps {
  feedback: IssueFeedback[]
  positions: Map<string, number>
  onFeedbackClick?: (feedback: IssueFeedback) => void
  onDismiss?: (id: string) => void
  onDelete?: (id: string) => void
  className?: string
}

/**
 * Parse anchor from string to FeedbackAnchor object
 */
function parseAnchor(anchor: string | undefined): FeedbackAnchor | null {
  if (!anchor) return null
  try {
    return JSON.parse(anchor) as FeedbackAnchor
  } catch {
    return null
  }
}

/**
 * Feedback panel that displays comments aligned with their document positions
 *
 * - General comments (no anchor) are shown in a sticky section at the top
 * - Anchored comments are positioned absolutely to align with their document locations
 */
export function AlignedFeedbackPanel({
  feedback,
  positions,
  onFeedbackClick,
  onDismiss,
  onDelete,
  className = '',
}: AlignedFeedbackPanelProps) {
  // Separate general comments from anchored comments
  const { generalComments, anchoredComments } = useMemo(() => {
    const general: IssueFeedback[] = []
    const anchored: IssueFeedback[] = []

    feedback.forEach((fb) => {
      const anchor = parseAnchor(fb.anchor)

      // A comment is "general" if it has no anchor or no line number
      if (!anchor || !anchor.line_number) {
        general.push(fb)
      } else {
        anchored.push(fb)
      }
    })

    return { generalComments: general, anchoredComments: anchored }
  }, [feedback])

  return (
    <div className={`flex h-full w-80 flex-col border-l bg-background ${className}`}>
      {/* General comments section - sticky at top */}
      {generalComments.length > 0 && (
        <section className="sticky top-0 z-10 border-b bg-muted/30 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <span>💭</span>
            <span>General Comments</span>
            <span className="text-xs font-normal text-muted-foreground">
              ({generalComments.length})
            </span>
          </h3>
          <div className="space-y-2">
            {generalComments.map((fb) => (
              <FeedbackCard
                key={fb.id}
                feedback={fb}
                onClick={() => onFeedbackClick?.(fb)}
                onDismiss={onDismiss ? () => onDismiss(fb.id) : undefined}
                onDelete={onDelete ? () => onDelete(fb.id) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {/* Anchored comments - absolutely positioned to align with document */}
      <div className="relative flex-1 overflow-hidden">
        {anchoredComments.map((fb) => {
          const top = positions.get(fb.id)

          // Don't render if position is not yet calculated
          if (top === undefined) return null

          return (
            <div
              key={fb.id}
              className="absolute w-full px-2 transition-all duration-200 ease-out"
              style={{ top: `${top}px` }}
            >
              <FeedbackCard
                feedback={fb}
                onClick={() => onFeedbackClick?.(fb)}
                onDismiss={onDismiss ? () => onDismiss(fb.id) : undefined}
                onDelete={onDelete ? () => onDelete(fb.id) : undefined}
              />
            </div>
          )
        })}
      </div>

      {/* Empty state */}
      {feedback.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          No feedback yet
        </div>
      )}
    </div>
  )
}
