import { useMemo, useRef } from 'react'
import { FeedbackCard } from './FeedbackCard'
import { useCollisionFreePositions } from '@/hooks/useCollisionFreePositions'
import type { IssueFeedback, FeedbackAnchor } from '@/types/api'

interface AlignedFeedbackPanelProps {
  feedback: IssueFeedback[]
  positions: Map<string, number>
  onFeedbackClick?: (feedback: IssueFeedback) => void
  onDismiss?: (id: string) => void
  onDelete?: (id: string) => void
  addFeedbackButton?: React.ReactNode
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
 * - Anchored comments are positioned with collision detection to prevent overlaps
 * - Visual connectors show the relationship between displaced feedback and their anchor points
 */
export function AlignedFeedbackPanel({
  feedback,
  positions,
  onFeedbackClick,
  onDismiss,
  onDelete,
  addFeedbackButton,
  className = '',
}: AlignedFeedbackPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Prepare positions for all feedback, treating general comments as position 0
  const allFeedbackPositions = useMemo(() => {
    const posMap = new Map<string, number>()
    const minTopOffset = 16 // Minimum 16px from top (pt-4)

    feedback.forEach((fb) => {
      const anchor = parseAnchor(fb.anchor)

      // General comments (no anchor) go to position with min offset
      if (!anchor || !anchor.line_number) {
        posMap.set(fb.id, minTopOffset)
      } else {
        // Anchored comments require an explicit position
        const pos = positions.get(fb.id)
        if (pos !== undefined) {
          // Ensure minimum top position
          posMap.set(fb.id, Math.max(pos, minTopOffset))
        }
        // If no position, don't add to map (feedback won't render)
      }
    })

    return posMap
  }, [feedback, positions])

  // Apply collision detection to prevent overlapping feedback cards
  // Using conservative height estimate: header (40px) + content (60px collapsed) + footer (30px) = 130px
  const collisionFreePositions = useCollisionFreePositions({
    positions: allFeedbackPositions,
    cardHeight: 130, // Conservative height estimate (collapsed state)
    minSpacing: 0, // Minimum gap between cards (reduced for more compact layout)
  })

  return (
    <div
      className={`flex h-full w-80 flex-col bg-background md:w-96 lg:w-[28rem] xl:w-[32rem] ${className}`}
    >
      {/* Add Feedback Button */}
      {addFeedbackButton && <div className="p-2">{addFeedbackButton}</div>}

      {/* All feedback - absolutely positioned with collision detection */}
      <div className="relative min-h-full flex-1">
        <div ref={panelRef} className="relative w-full pt-4">
          {/* Feedback cards */}
          {feedback.map((fb) => {
            const position = collisionFreePositions.get(fb.id)

            // Don't render if position is not yet calculated
            if (!position) return null

            return (
              <div
                key={fb.id}
                className="absolute w-full px-1"
                style={{ top: `${position.actualTop}px`, zIndex: 10 }}
              >
                <FeedbackCard
                  feedback={fb}
                  onClick={() => onFeedbackClick?.(fb)}
                  onDismiss={onDismiss ? () => onDismiss(fb.id) : undefined}
                  onDelete={onDelete ? () => onDelete(fb.id) : undefined}
                  maxHeight={200} // Max height before scrolling
                  isCompact={false}
                />
              </div>
            )
          })}

          {/* Spacer to ensure panel height matches content */}
          {feedback.length > 0 && (
            <div
              style={{
                height: `${Math.max(...Array.from(collisionFreePositions.values()).map((p) => p.actualTop + p.height)) + 100}px`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
