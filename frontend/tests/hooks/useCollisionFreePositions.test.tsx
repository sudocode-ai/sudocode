import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCollisionFreePositions } from '@/hooks/useCollisionFreePositions'

describe('useCollisionFreePositions', () => {
  it('should return positions unchanged when no collisions', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 200],
      ['fb3', 400],
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')
    const fb2 = result.current.get('fb2')
    const fb3 = result.current.get('fb3')

    expect(fb1?.idealTop).toBe(0)
    expect(fb1?.actualTop).toBe(0)

    expect(fb2?.idealTop).toBe(200)
    expect(fb2?.actualTop).toBe(200)

    expect(fb3?.idealTop).toBe(400)
    expect(fb3?.actualTop).toBe(400)
  })

  it('should resolve collisions by pushing items down', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 50], // Collides with fb1 (0-100)
      ['fb3', 80], // Collides with both
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')
    const fb2 = result.current.get('fb2')
    const fb3 = result.current.get('fb3')

    // fb1 stays at ideal position
    expect(fb1?.idealTop).toBe(0)
    expect(fb1?.actualTop).toBe(0)

    // fb2 pushed down below fb1 (0 + 100 + 8)
    expect(fb2?.idealTop).toBe(50)
    expect(fb2?.actualTop).toBe(108)

    // fb3 pushed down below fb2 (108 + 100 + 8)
    expect(fb3?.idealTop).toBe(80)
    expect(fb3?.actualTop).toBe(216)
  })

  it('should handle multiple overlapping items', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 10],
      ['fb3', 20],
      ['fb4', 30],
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')
    const fb2 = result.current.get('fb2')
    const fb3 = result.current.get('fb3')
    const fb4 = result.current.get('fb4')

    // All items should be spaced without overlaps
    expect(fb1?.actualTop).toBe(0)
    expect(fb2?.actualTop).toBe(108) // 0 + 100 + 8
    expect(fb3?.actualTop).toBe(216) // 108 + 100 + 8
    expect(fb4?.actualTop).toBe(324) // 216 + 100 + 8
  })

  it('should preserve order based on ideal position', () => {
    const positions = new Map([
      ['fb1', 100],
      ['fb2', 50], // Earlier than fb1
      ['fb3', 150],
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')
    const fb2 = result.current.get('fb2')
    const fb3 = result.current.get('fb3')

    // fb2 should be placed first (lowest idealTop)
    expect(fb2?.actualTop).toBe(50)

    // fb1 should be pushed down if it collides with fb2
    expect(fb1?.actualTop).toBe(158) // 50 + 100 + 8

    // fb3 should be pushed down if it collides
    expect(fb3?.actualTop).toBe(266) // 158 + 100 + 8
  })

  it('should handle items that just barely fit without collision', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 108], // Exactly 100 + 8 away
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')
    const fb2 = result.current.get('fb2')

    // Both should stay at ideal positions (no collision)
    expect(fb1?.actualTop).toBe(0)
    expect(fb2?.actualTop).toBe(108)
  })

  it('should handle items that just barely collide', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 107], // Just 1px short of clearance
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')
    const fb2 = result.current.get('fb2')

    expect(fb1?.actualTop).toBe(0)
    // fb2 should be pushed down
    expect(fb2?.actualTop).toBe(108)
  })

  it('should respect custom card height', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 100], // Close to fb1
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 200, minSpacing: 8 })
    )

    const fb2 = result.current.get('fb2')

    // With 200px height, fb2 should be pushed further down
    expect(fb2?.actualTop).toBe(208) // 0 + 200 + 8
  })

  it('should respect custom min spacing', () => {
    const positions = new Map([
      ['fb1', 0],
      ['fb2', 50],
    ])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 20 })
    )

    const fb2 = result.current.get('fb2')

    // With 20px spacing, fb2 should have more gap
    expect(fb2?.actualTop).toBe(120) // 0 + 100 + 20
  })

  it('should handle empty positions map', () => {
    const positions = new Map<string, number>()

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    expect(result.current.size).toBe(0)
  })

  it('should handle single item', () => {
    const positions = new Map([['fb1', 100]])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 100, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')

    expect(fb1?.idealTop).toBe(100)
    expect(fb1?.actualTop).toBe(100)
  })

  it('should include height in position info', () => {
    const positions = new Map([['fb1', 0]])

    const { result } = renderHook(() =>
      useCollisionFreePositions({ positions, cardHeight: 150, minSpacing: 8 })
    )

    const fb1 = result.current.get('fb1')

    expect(fb1?.height).toBe(150)
  })
})
