import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// Mock useProject hook
let mockProjectId: string | null = 'test-project-id'

vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({
    currentProjectId: mockProjectId,
  }),
}))

describe('useProjectRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={['/p/test-project-id/specs']}>
      {children}
    </MemoryRouter>
  )

  it('should build project-scoped paths', () => {
    const { result } = renderHook(() => useProjectRoutes(), { wrapper })

    expect(result.current.paths.issues()).toBe('/p/test-project-id/issues')
    expect(result.current.paths.issue('i-123')).toBe('/p/test-project-id/issues/i-123')
    expect(result.current.paths.specs()).toBe('/p/test-project-id/specs')
    expect(result.current.paths.spec('s-456')).toBe('/p/test-project-id/specs/s-456')
    expect(result.current.paths.workflows()).toBe('/p/test-project-id/workflows')
    expect(result.current.paths.workflow('w-789')).toBe('/p/test-project-id/workflows/w-789')
  })

  it('should return stable paths object reference across renders', () => {
    const { result, rerender } = renderHook(() => useProjectRoutes(), { wrapper })

    const initialPaths = result.current.paths

    // Re-render multiple times
    rerender()
    rerender()
    rerender()

    // paths object should be the same reference (memoized)
    expect(result.current.paths).toBe(initialPaths)
  })

  it('should return stable go object reference across renders', () => {
    const { result, rerender } = renderHook(() => useProjectRoutes(), { wrapper })

    const initialGo = result.current.go

    // Re-render multiple times
    rerender()
    rerender()
    rerender()

    // go object should be the same reference (memoized)
    expect(result.current.go).toBe(initialGo)
  })

  it('should return stable buildPath function reference across renders', () => {
    const { result, rerender } = renderHook(() => useProjectRoutes(), { wrapper })

    const initialBuildPath = result.current.buildPath

    // Re-render multiple times
    rerender()
    rerender()
    rerender()

    // buildPath function should be the same reference (memoized via useCallback)
    expect(result.current.buildPath).toBe(initialBuildPath)
  })

  it('should update paths when projectId changes', () => {
    const { result, rerender } = renderHook(() => useProjectRoutes(), { wrapper })

    const initialPaths = result.current.paths
    expect(result.current.paths.specs()).toBe('/p/test-project-id/specs')

    // Change project ID
    mockProjectId = 'new-project-id'
    rerender()

    // paths object should be a new reference (projectId changed)
    expect(result.current.paths).not.toBe(initialPaths)
    expect(result.current.paths.specs()).toBe('/p/new-project-id/specs')
  })
})

describe('useProjectRoutes - Memoization for WebSocket hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectId = 'test-project-id'
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={['/p/test-project-id/specs']}>
      {children}
    </MemoryRouter>
  )

  it('should not cause dependent useEffect to re-run on parent re-render', () => {
    // This test verifies that using paths in a useCallback/useEffect dependency
    // array won't cause unnecessary re-runs when the parent component re-renders
    let effectRunCount = 0

    const useTestHook = () => {
      const { paths } = useProjectRoutes()

      React.useEffect(() => {
        effectRunCount++
      }, [paths])

      return { paths }
    }

    const { rerender } = renderHook(() => useTestHook(), { wrapper })

    // Initial render should trigger effect once
    expect(effectRunCount).toBe(1)

    // Re-renders should NOT trigger effect again (paths is stable)
    rerender()
    rerender()
    rerender()

    expect(effectRunCount).toBe(1)
  })
})
