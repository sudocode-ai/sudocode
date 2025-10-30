import { useMemo } from 'react'
import { FeedbackCard } from './FeedbackCard'
import { useCollisionFreePositions } from '@/hooks/useCollisionFreePositions'
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
 * - Anchored comments are positioned with collision detection to prevent overlaps
 * - Visual connectors show the relationship between displaced feedback and their anchor points
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

  // Apply collision detection to prevent overlapping feedback cards
  // Using conservative height estimate: header (40px) + content (60px collapsed) + footer (30px) = 130px
  const collisionFreePositions = useCollisionFreePositions({
    positions,
    cardHeight: 130, // Conservative height estimate (collapsed state)
    minSpacing: 12, // Minimum gap between cards
  })

  // Identify clusters of nearby feedback (within 3 lines of each other)
  const feedbackClusters = useMemo(() => {
    const clusters: string[][] = []
    const sortedFeedback = anchoredComments
      .map((fb) => ({
        id: fb.id,
        position: positions.get(fb.id),
      }))
      .filter((item) => item.position !== undefined)
      .sort((a, b) => a.position! - b.position!)

    let currentCluster: string[] = []
    let lastPosition: number | undefined

    sortedFeedback.forEach(({ id, position }) => {
      if (lastPosition === undefined || Math.abs(position! - lastPosition) < 60) {
        // Within ~3 lines (20px per line)
        currentCluster.push(id)
      } else {
        if (currentCluster.length > 1) {
          clusters.push(currentCluster)
        }
        currentCluster = [id]
      }
      lastPosition = position
    })

    if (currentCluster.length > 1) {
      clusters.push(currentCluster)
    }

    return clusters
  }, [anchoredComments, positions])

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

      {/* Anchored comments - absolutely positioned with collision detection */}
      <div className="relative flex-1 overflow-hidden">
        {/* SVG layer for connectors and cluster indicators */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 1 }}>
          {/* Draw cluster brackets for nearby feedback */}
          {feedbackClusters.map((cluster, clusterIndex) => {
            const clusterPositions = cluster
              .map((id) => collisionFreePositions.get(id))
              .filter((p) => p !== undefined)

            if (clusterPositions.length < 2) return null

            const firstPos = clusterPositions[0]!
            const lastPos = clusterPositions[clusterPositions.length - 1]!

            const x = 4
            const startY = firstPos.idealTop
            const endY = lastPos.idealTop + 20 // Approximate to bottom of last item's anchor

            return (
              <g key={`cluster-${clusterIndex}`}>
                {/* Vertical bracket line */}
                <line
                  x1={x}
                  y1={startY}
                  x2={x}
                  y2={endY}
                  className="stroke-muted-foreground/30"
                  strokeWidth="2"
                />
                {/* Top bracket */}
                <line
                  x1={x}
                  y1={startY}
                  x2={x + 8}
                  y2={startY}
                  className="stroke-muted-foreground/30"
                  strokeWidth="2"
                />
                {/* Bottom bracket */}
                <line
                  x1={x}
                  y1={endY}
                  x2={x + 8}
                  y2={endY}
                  className="stroke-muted-foreground/30"
                  strokeWidth="2"
                />
              </g>
            )
          })}

          {/* Draw connector lines for displaced feedback */}
          {anchoredComments.map((fb) => {
            const position = collisionFreePositions.get(fb.id)
            if (!position) return null

            const { idealTop, actualTop } = position
            const isDisplaced = Math.abs(actualTop - idealTop) > 2 // Allow 2px tolerance

            if (!isDisplaced) return null

            // Draw a connector line from ideal position to actual position
            const leftMargin = 8 // px-2 = 8px
            const startX = leftMargin
            const startY = idealTop
            const endX = leftMargin
            const endY = actualTop

            return (
              <g key={`connector-${fb.id}`}>
                {/* Dot at anchor point */}
                <circle cx={startX + 4} cy={startY} r="3" className="fill-primary/60" />
                {/* Curved connector line */}
                <path
                  d={`M ${startX + 4} ${startY} Q ${startX + 20} ${(startY + endY) / 2}, ${endX + 4} ${endY}`}
                  className="stroke-primary/40"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray="3,3"
                />
              </g>
            )
          })}
        </svg>

        {/* Feedback cards */}
        {anchoredComments.map((fb) => {
          const position = collisionFreePositions.get(fb.id)

          // Don't render if position is not yet calculated
          if (!position) return null

          // Check if this feedback is in a cluster (nearby other feedback)
          const isInCluster = feedbackClusters.some((cluster) => cluster.includes(fb.id))

          return (
            <div
              key={fb.id}
              className="absolute w-full px-2"
              style={{ top: `${position.actualTop}px`, zIndex: 10 }}
            >
              <FeedbackCard
                feedback={fb}
                onClick={() => onFeedbackClick?.(fb)}
                onDismiss={onDismiss ? () => onDismiss(fb.id) : undefined}
                onDelete={onDelete ? () => onDelete(fb.id) : undefined}
                maxHeight={200} // Max height before scrolling
                isCompact={isInCluster} // Compact mode for clustered feedback
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
