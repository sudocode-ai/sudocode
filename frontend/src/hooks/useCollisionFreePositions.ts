import { useMemo } from 'react'

export interface FeedbackPosition {
  id: string
  idealTop: number // Where the feedback should be (line position)
  actualTop: number // Where it's actually placed (after collision resolution)
  height: number // Card height
}

interface CollisionFreePositionsOptions {
  positions: Map<string, number>
  cardHeight?: number // Default height of a feedback card
  minSpacing?: number // Minimum space between cards
}

/**
 * Hook for resolving overlapping feedback positions using collision detection
 *
 * Algorithm:
 * 1. Sort feedback by ideal vertical position
 * 2. For each item, check if it overlaps with previously placed items
 * 3. If overlap detected, push item down until it fits
 * 4. Maintain minimum spacing between items
 *
 * @returns Map of feedback ID to position info (ideal and actual positions)
 */
export function useCollisionFreePositions({
  positions,
  cardHeight = 120, // Approximate height of a FeedbackCard
  minSpacing = 8, // Minimum gap between cards
}: CollisionFreePositionsOptions): Map<string, FeedbackPosition> {
  return useMemo(() => {
    const result = new Map<string, FeedbackPosition>()

    // Convert positions map to array and sort by vertical position
    const items = Array.from(positions.entries())
      .map(([id, idealTop]) => ({
        id,
        idealTop,
      }))
      .sort((a, b) => a.idealTop - b.idealTop)

    // Track placed items for collision detection
    const placedItems: FeedbackPosition[] = []

    for (const item of items) {
      let actualTop = item.idealTop
      let hasCollision = true

      // Keep pushing down until no collision
      while (hasCollision) {
        hasCollision = false

        for (const placed of placedItems) {
          const placedBottom = placed.actualTop + placed.height + minSpacing
          const currentBottom = actualTop + cardHeight

          // Check if current item overlaps with placed item
          if (
            actualTop < placedBottom &&
            currentBottom > placed.actualTop
          ) {
            // Move current item below the placed item
            actualTop = placedBottom
            hasCollision = true
            break
          }
        }
      }

      const position: FeedbackPosition = {
        id: item.id,
        idealTop: item.idealTop,
        actualTop,
        height: cardHeight,
      }

      placedItems.push(position)
      result.set(item.id, position)
    }

    return result
  }, [positions, cardHeight, minSpacing])
}
