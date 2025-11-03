/**
 * Tests for useFeedbackPositions hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFeedbackPositions } from '@/hooks/useFeedbackPositions'
import type { IssueFeedback } from '@/types/api'

describe('useFeedbackPositions', () => {
  let mockEditorElement: HTMLDivElement

  beforeEach(() => {
    // Create a mock editor element
    mockEditorElement = document.createElement('div')
    mockEditorElement.style.position = 'relative'
    mockEditorElement.style.height = '500px'
    mockEditorElement.style.overflow = 'auto'
    document.body.appendChild(mockEditorElement)

    // Mock getBoundingClientRect
    vi.spyOn(mockEditorElement, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 500,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
  })

  afterEach(() => {
    document.body.removeChild(mockEditorElement)
    vi.restoreAllMocks()
  })

  it('should return empty map when no feedback provided', async () => {
    const editorRef = { current: mockEditorElement }
    const { result } = renderHook(() => useFeedbackPositions([], editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should return empty map when editor ref is null', async () => {
    const editorRef = { current: null }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should skip feedback without anchors', async () => {
    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'General comment',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should calculate position for feedback with data-feedback-id', async () => {
    // Add element with data-feedback-id
    const markElement = document.createElement('mark')
    markElement.setAttribute('data-feedback-id', 'FB-001')
    markElement.textContent = 'Highlighted text'
    mockEditorElement.appendChild(markElement)

    // Mock offsetTop instead of getBoundingClientRect (new implementation uses offsetTop)
    Object.defineProperty(markElement, 'offsetTop', {
      get: () => 100,
      configurable: true,
    })
    Object.defineProperty(markElement, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-001')).toBe(100) // offsetTop from element
    })
  })

  it('should calculate position for feedback with line number', async () => {
    // Add paragraph elements
    const p1 = document.createElement('p')
    p1.textContent = 'Line 1'
    const p2 = document.createElement('p')
    p2.textContent = 'Line 2'
    p2.setAttribute('data-line-number', '2')
    mockEditorElement.appendChild(p1)
    mockEditorElement.appendChild(p2)

    // Mock offsetTop for p2
    Object.defineProperty(p2, 'offsetTop', {
      get: () => 50,
      configurable: true,
    })
    Object.defineProperty(p2, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-002',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 2,
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-002')).toBe(50) // offsetTop from element
    })
  })

  it('should find closest line number when exact match not found', async () => {
    // Add multiple paragraph elements with sparse line numbers (like in real editor)
    const p1 = document.createElement('p')
    p1.textContent = 'Line 1'
    p1.setAttribute('data-line-number', '1')
    const p2 = document.createElement('p')
    p2.textContent = 'Line 5'
    p2.setAttribute('data-line-number', '5')
    const p3 = document.createElement('p')
    p3.textContent = 'Line 10'
    p3.setAttribute('data-line-number', '10')
    mockEditorElement.appendChild(p1)
    mockEditorElement.appendChild(p2)
    mockEditorElement.appendChild(p3)

    // Mock offsetTop for p2 (will be found as closest to line 7)
    Object.defineProperty(p2, 'offsetTop', {
      get: () => 30,
      configurable: true,
    })
    Object.defineProperty(p2, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-003',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 7, // Should find p2 (line 5 is closest <= 7)
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-003')).toBe(30) // offsetTop from p2 (line 5)
    })
  })

  it('should handle multiple feedback items', async () => {
    const mark1 = document.createElement('mark')
    mark1.setAttribute('data-feedback-id', 'FB-001')
    const mark2 = document.createElement('mark')
    mark2.setAttribute('data-feedback-id', 'FB-002')

    mockEditorElement.appendChild(mark1)
    mockEditorElement.appendChild(mark2)

    // Mock offsetTop for both marks
    Object.defineProperty(mark1, 'offsetTop', {
      get: () => 20,
      configurable: true,
    })
    Object.defineProperty(mark1, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    Object.defineProperty(mark2, 'offsetTop', {
      get: () => 80,
      configurable: true,
    })
    Object.defineProperty(mark2, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test 1',
        anchor: JSON.stringify({ line_number: 1, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'FB-002',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test 2',
        anchor: JSON.stringify({ line_number: 5, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-001')).toBe(20) // offsetTop from element
      expect(result.current.get('FB-002')).toBe(80) // offsetTop from element
    })
  })

  it('should handle invalid anchor JSON gracefully', async () => {
    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: 'invalid json',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should position feedback relative to editor viewport (moves with scroll)', async () => {
    const mark = document.createElement('mark')
    mark.setAttribute('data-feedback-id', 'FB-001')
    mockEditorElement.appendChild(mark)
    mockEditorElement.scrollTop = 100 // Scrolled down 100px

    // Mock offsetTop - remains constant regardless of scroll
    Object.defineProperty(mark, 'offsetTop', {
      get: () => 20,
      configurable: true,
    })
    Object.defineProperty(mark, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({ line_number: 10, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      // Position uses offsetTop which is relative to scroll container
      expect(result.current.get('FB-001')).toBe(20)
    })
  })

  it('should update positions when feedback changes', async () => {
    const mark = document.createElement('mark')
    mark.setAttribute('data-feedback-id', 'FB-001')
    mockEditorElement.appendChild(mark)

    // Mock offsetTop for mark
    Object.defineProperty(mark, 'offsetTop', {
      get: () => 50,
      configurable: true,
    })
    Object.defineProperty(mark, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const editorRef = { current: mockEditorElement }
    const initialFeedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({ line_number: 10, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result, rerender } = renderHook(
      ({ feedback }) => useFeedbackPositions(feedback, editorRef),
      { initialProps: { feedback: initialFeedback } }
    )

    await waitFor(() => {
      expect(result.current.get('FB-001')).toBe(50)
    })

    // Add another feedback item
    const mark2 = document.createElement('mark')
    mark2.setAttribute('data-feedback-id', 'FB-002')
    mockEditorElement.appendChild(mark2)

    // Mock offsetTop for mark2
    Object.defineProperty(mark2, 'offsetTop', {
      get: () => 100,
      configurable: true,
    })
    Object.defineProperty(mark2, 'offsetParent', {
      get: () => mockEditorElement,
      configurable: true,
    })

    const updatedFeedback: IssueFeedback[] = [
      ...initialFeedback,
      {
        id: 'FB-002',
        issue_id: 'ISSUE-001',
        issue_uuid: 'uuid-issue-001',
        spec_id: 'SPEC-001',
        spec_uuid: 'uuid-spec-001',
        feedback_type: 'comment',
        content: 'Test 2',
        anchor: JSON.stringify({ line_number: 20, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    rerender({ feedback: updatedFeedback })

    await waitFor(() => {
      expect(result.current.size).toBe(2)
      expect(result.current.get('FB-001')).toBe(50)
      expect(result.current.get('FB-002')).toBe(100)
    })
  })

  it('should cleanup event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(mockEditorElement, 'removeEventListener')
    const windowRemoveEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const editorRef = { current: mockEditorElement }
    const { unmount } = renderHook(() => useFeedbackPositions([], editorRef))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
